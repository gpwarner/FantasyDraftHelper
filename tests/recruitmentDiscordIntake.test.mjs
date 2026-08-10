import assert from "node:assert/strict";
import test from "node:test";

import {
  addToRecruitmentCommand,
  formatRecruitmentDiscordDiagnostic,
  handleAddToRecruitmentInteraction,
  normalizeRecruitmentDiscordPost,
} from "../dist/intake/recruitmentDiscordIntake.js";
import {
  recruitmentDiscordGroupPosts,
} from "./fixtures/recruitmentDiscordPosts.mjs";

function createTargetMessage(content) {
  return {
    id: "message-id",
    guildId: "guild-id",
    channelId: "channel-id",
    url:
      "https://discord.com/channels/guild-id/channel-id/message-id",
    content: content ??
      "Class/Spec: Arcane Mage\nRaider.IO: https://raider.io/characters/us/area-52/Examplemage",
    author: {
      id: "author-id",
      username: "candidate_user",
      displayName: "Candidate User",
    },
    member: {
      displayName: "Candidate Display",
    },
    attachments: new Map([
      [
        "attachment-id",
        {
          id: "attachment-id",
          name: "logs.png",
          url: "https://cdn.discordapp.com/logs.png",
          contentType: "image/png",
          description: null,
          size: 1234,
        },
      ],
    ]),
    embeds: [
      {
        toJSON: () => ({
          title: "Warcraft Logs",
          url: "https://www.warcraftlogs.com/character/example",
        }),
      },
    ],
  };
}

function createInteraction(userId, content) {
  const calls = {
    replies: [],
    deferred: [],
    edits: [],
  };

  return {
    calls,
    commandName: "Add to Recruitment",
    user: {
      id: userId,
    },
    createdAt:
      new Date("2026-08-10T12:00:00.000Z"),
    targetMessage: createTargetMessage(content),
    isMessageContextMenuCommand: () => true,
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    isRepliable: () => true,
    reply: async (options) => {
      calls.replies.push(options);
    },
    deferReply: async (options) => {
      calls.deferred.push(options);
    },
    editReply: async (options) => {
      calls.edits.push(options);
    },
  };
}

function createIntakeStore(existing) {
  const records = [];

  return {
    records,
    getImport: () => existing,
    recordImport: async (record) => {
      records.push(record);
    },
  };
}

test(
  "registers a global message command for guild and user installs",
  () => {
    const command =
      addToRecruitmentCommand.toJSON();

    assert.deepEqual(
      {
        name: command.name,
        type: command.type,
        integrationTypes:
          command.integration_types,
        contexts: command.contexts,
      },
      {
        name: "Add to Recruitment",
        type: 3,
        integrationTypes: [0, 1],
        contexts: [0],
      },
    );
  },
);

test(
  "requires manual character entry when no identity is present",
  async () => {
    const interaction = createInteraction(
      "officer-id",
      "Class/Spec: Arcane Mage\nAvailability: Any evening EST",
    );

    await handleAddToRecruitmentInteraction(interaction, {
      authorizedOfficerIds: ["officer-id"],
      intakeStore: createIntakeStore(),
      importCandidates: async () => [],
    });

    const row = interaction.calls.edits[0].components[0].toJSON();
    const addButton = row.components.find(
      (component) => component.label === "Add Candidate",
    );
    const entryButton = row.components.find(
      (component) => component.label === "Enter Character Info",
    );

    assert.equal(addButton.disabled, true);
    assert.ok(entryButton);
  },
);

test(
  "renders one package confirmation without group identity selectors",
  async () => {
    const interaction = createInteraction(
      "officer-id",
      recruitmentDiscordGroupPosts[0],
    );

    await handleAddToRecruitmentInteraction(interaction, {
      authorizedOfficerIds: ["officer-id"],
      intakeStore: createIntakeStore(),
      importCandidates: async () => [],
      importPackage: async () => {
        throw new Error("Package confirmation was not expected yet.");
      },
    });

    const components = interaction.calls.edits[0].components.map(
      (row) => row.toJSON(),
    );
    assert.equal(components.length, 1);
    assert.equal(
      components[0].components.find(
        (component) => component.label === "Add Package",
      ).disabled,
      false,
    );
    assert.match(interaction.calls.edits[0].content, /Raider 1/);
    assert.match(interaction.calls.edits[0].content, /Raider 2/);
  },
);

test(
  "confirms a group as one package import",
  async () => {
    const contextInteraction = createInteraction(
      "officer-id",
      recruitmentDiscordGroupPosts[0],
    );
    const intakeStore = createIntakeStore();
    let packageIntake;
    let individualImportCalled = false;
    const dependencies = {
      authorizedOfficerIds: ["officer-id"],
      intakeStore,
      importCandidates: async () => {
        individualImportCalled = true;
        return [];
      },
      importPackage: async (intake) => {
        packageIntake = intake;
        return {
          characterName: "Package: Mistyexample + Bladeexample",
          realm: "Package",
          region: "Multiple",
          outputMessageUrl:
            "https://discord.com/channels/internal/output/package",
          overallStatus: "MANUAL_REVIEW",
        };
      },
    };

    await handleAddToRecruitmentInteraction(
      contextInteraction,
      dependencies,
    );
    const row = contextInteraction.calls.edits[0].components[0].toJSON();
    const customId = row.components.find(
      (component) => component.label === "Add Package",
    ).custom_id;
    const calls = { updates: [], edits: [] };
    const buttonInteraction = {
      customId,
      user: { id: "officer-id" },
      isMessageContextMenuCommand: () => false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      isRepliable: () => true,
      update: async (options) => calls.updates.push(options),
      editReply: async (options) => calls.edits.push(options),
      reply: async () => undefined,
    };

    await handleAddToRecruitmentInteraction(
      buttonInteraction,
      dependencies,
    );

    assert.equal(individualImportCalled, false);
    assert.equal(packageIntake.parsed.postType, "GROUP");
    assert.equal(intakeStore.records[0].candidates.length, 1);
    assert.match(calls.edits[0].content, /Recruitment package.*added/);
  },
);

test(
  "returns the persisted candidate instead of importing a source twice",
  async () => {
    const interaction = createInteraction("officer-id");
    let imported = false;
    const existing = {
      candidates: [{
        characterName: "Existingmage",
        realm: "Area 52",
        region: "US",
        outputMessageUrl:
          "https://discord.com/channels/internal/output/existing",
        overallStatus: "PASS",
      }],
    };

    await handleAddToRecruitmentInteraction(interaction, {
      authorizedOfficerIds: ["officer-id"],
      intakeStore: createIntakeStore(existing),
      importCandidates: async () => {
        imported = true;
        return [];
      },
    });

    assert.equal(imported, false);
    assert.match(
      interaction.calls.edits[0].content,
      /already in the recruitment system/,
    );
    assert.match(interaction.calls.edits[0].content, /Existingmage/);
  },
);

test(
  "normalizes only the selected Recruitment Discord message",
  () => {
    const intake =
      normalizeRecruitmentDiscordPost(
        createTargetMessage(),
        "officer-id",
        new Date(
          "2026-08-10T12:00:00.000Z",
        ),
      );

    assert.equal(
      intake.sourceType,
      "RECRUITMENT_DISCORD",
    );
    assert.equal(
      intake.submittedByDiscordUserId,
      "officer-id",
    );
    assert.equal(
      intake.sourceGuildId,
      "guild-id",
    );
    assert.equal(
      intake.sourceChannelId,
      "channel-id",
    );
    assert.equal(
      intake.sourceMessageId,
      "message-id",
    );
    assert.equal(
      intake.sourceAuthorDisplayName,
      "Candidate Display",
    );
    assert.equal(intake.attachments.length, 1);
    assert.equal(intake.embeds.length, 1);

    const diagnostic =
      formatRecruitmentDiscordDiagnostic(
        intake,
      );

    assert.match(
      diagnostic,
      /Recruitment Discord intake received/,
    );
    assert.match(
      diagnostic,
      /guild-id\/channel-id\/message-id/,
    );
  },
);

test(
  "rejects unauthorized users without creating a pending intake",
  async () => {
    const interaction =
      createInteraction("unauthorized-id");
    let published = false;

    assert.equal(
      await handleAddToRecruitmentInteraction(
        interaction,
        {
          authorizedOfficerIds: [
            "officer-id",
          ],
          intakeStore: createIntakeStore(),
          importCandidates: async () => {
            published = true;
            return [];
          },
        },
      ),
      true,
    );

    assert.equal(published, false);
    assert.equal(
      interaction.calls.replies.length,
      1,
    );
    assert.match(
      interaction.calls.replies[0].content,
      /not authorized/,
    );
    assert.equal(
      interaction.calls.deferred.length,
      0,
    );
  },
);

test(
  "shows authorized users an ephemeral confirmation before importing",
  async () => {
    const interaction =
      createInteraction("officer-id");
    let imported = false;

    assert.equal(
      await handleAddToRecruitmentInteraction(
        interaction,
        {
          authorizedOfficerIds: [
            "officer-id",
          ],
          intakeStore: createIntakeStore(),
          importCandidates: async () => {
            imported = true;
            return [];
          },
        },
      ),
      true,
    );

    assert.equal(
      imported,
      false,
    );
    assert.equal(
      interaction.calls.deferred.length,
      1,
    );
    assert.equal(
      interaction.calls.edits.length,
      1,
    );
    assert.match(
      interaction.calls.edits[0].content,
      /Confirm Candidate/,
    );
    assert.equal(
      interaction.calls.edits[0].components.length,
      1,
    );
  },
);

test(
  "imports only after the recruiter confirms",
  async () => {
    const contextInteraction = createInteraction("officer-id");
    const intakeStore = createIntakeStore();
    let confirmedCandidates;
    const dependencies = {
      authorizedOfficerIds: ["officer-id"],
      intakeStore,
      importCandidates: async (candidates) => {
        confirmedCandidates = candidates;
        return [{
          characterName: "Examplemage",
          realm: "Area 52",
          region: "US",
          outputMessageUrl:
            "https://discord.com/channels/internal/output/candidate",
          overallStatus: "MANUAL_REVIEW",
        }];
      },
    };

    await handleAddToRecruitmentInteraction(
      contextInteraction,
      dependencies,
    );

    const componentJson =
      contextInteraction.calls.edits[0].components[0].toJSON();
    const confirmCustomId = componentJson.components.find(
      (component) => component.label === "Add Candidate",
    ).custom_id;
    const calls = { updates: [], edits: [] };
    const buttonInteraction = {
      customId: confirmCustomId,
      user: { id: "officer-id" },
      isMessageContextMenuCommand: () => false,
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      isRepliable: () => true,
      update: async (options) => calls.updates.push(options),
      editReply: async (options) => calls.edits.push(options),
      reply: async () => undefined,
    };

    assert.equal(
      await handleAddToRecruitmentInteraction(
        buttonInteraction,
        dependencies,
      ),
      true,
    );
    assert.equal(confirmedCandidates.length, 1);
    assert.equal(
      confirmedCandidates[0].identity.characterName,
      "Examplemage",
    );
    assert.equal(intakeStore.records.length, 1);
    assert.match(calls.edits[0].content, /Candidate.*added/);
  },
);
