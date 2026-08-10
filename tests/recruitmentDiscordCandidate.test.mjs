import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createRecruitmentDiscordCandidate,
} from "../dist/intake/createRecruitmentDiscordCandidate.js";
import {
  parseRecruitmentDiscordPost,
} from "../dist/intake/parseRecruitmentDiscordPost.js";
import {
  RecruitmentDiscordIntakeStore,
} from "../dist/intake/recruitmentDiscordIntakeStore.js";
import {
  processRecruitmentDiscordCandidates,
  processRecruitmentDiscordPackage,
} from "../dist/intake/processRecruitmentDiscordCandidates.js";
import {
  recruitmentDiscordGroupPosts,
  recruitmentDiscordPosts,
} from "./fixtures/recruitmentDiscordPosts.mjs";

function createIntake(content) {
  return {
    sourceType: "RECRUITMENT_DISCORD",
    submittedByDiscordUserId: "officer-id",
    sourceGuildId: "source-guild",
    sourceChannelId: "source-channel",
    sourceMessageId: "source-message",
    sourceMessageUrl:
      "https://discord.com/channels/source-guild/source-channel/source-message",
    sourceAuthorId: "author-id",
    sourceAuthorUsername: "author",
    sourceAuthorDisplayName: "Author",
    content,
    parsed: parseRecruitmentDiscordPost(content),
    attachments: [],
    embeds: [],
    submittedAt: "2026-08-10T12:00:00.000Z",
  };
}

test(
  "creates a source-neutral candidate from a selected group member",
  () => {
    const intake = createIntake(recruitmentDiscordGroupPosts[0]);
    const member = intake.parsed.group.members[0];
    const identity = member.identityCandidates.find(
      (candidateIdentity) =>
        candidateIdentity.characterName === "Leafexample",
    );
    const candidate = createRecruitmentDiscordCandidate({
      intake,
      identity,
      memberNumber: 1,
    });

    assert.equal(candidate.source.type, "RECRUITMENT_DISCORD");
    assert.equal(candidate.character.name, "Leafexample");
    assert.equal(candidate.character.className, undefined);
    assert.equal(candidate.character.role, "HEALING");
    assert.match(candidate.links.raiderIo, /Leafexample$/);
    assert.doesNotMatch(candidate.links.raiderIo, /Bladeexample/);
    assert.equal(
      candidate.raidProgression["Recruitment Discord"],
      "8/9 Midnight S1; AOTC recent expansions",
    );

    const mixedRoleMember = intake.parsed.group.members[1];
    const mixedRoleCandidate = createRecruitmentDiscordCandidate({
      intake,
      identity: mixedRoleMember.identityCandidates[0],
      memberNumber: 2,
    });
    assert.equal(mixedRoleCandidate.character.role, undefined);
  },
);

test(
  "processes a group as one manual-review output and assignment",
  async () => {
    const intake = createIntake(recruitmentDiscordGroupPosts[0]);
    const sent = [];
    const assigned = [];
    const outputMessage = {
      id: "package-output",
      url: "https://discord.com/channels/internal/output/package-output",
      guildId: "internal",
      edit: async () => undefined,
      delete: async () => undefined,
    };

    const result = await processRecruitmentDiscordPackage(intake, {
      roster: { mode: "all", roles: [], specs: [] },
      officerThreadManager: {
        assignCandidate: async (options) => {
          assigned.push(options);
          return { outcome: "ASSIGNED" };
        },
      },
      sendToOutputChannel: async (content) => {
        sent.push(content);
        return outputMessage;
      },
    });

    assert.equal(sent.length, 1);
    assert.equal(assigned.length, 1);
    assert.equal(assigned[0].candidateStatus, "MANUAL_REVIEW");
    assert.equal(result.overallStatus, "MANUAL_REVIEW");
    assert.match(sent[0], /Package deal/);
    assert.match(sent[0], /Raider 1/);
    assert.match(sent[0], /Raider 2/);
    assert.match(sent[0], /Mistyexample/);
    assert.match(sent[0], /Bladeexample/);
  },
);

test(
  "confirmed candidates use evaluation output and officer assignment",
  async () => {
    const intake = createIntake(
      "Class/Spec: Arcane Mage\nCurrent Progress: 5/9M\nContact Preference Discord: example_user\nRaider.IO: https://raider.io/characters/us/area-52/Examplemage\nAvailability: M-Th 8pm-11pm EST",
    );
    const sent = [];
    const assigned = [];
    const outputMessage = {
      id: "output-message",
      url: "https://discord.com/channels/internal/output/output-message",
      guildId: "internal",
      edit: async () => undefined,
      delete: async () => undefined,
    };

    const results = await processRecruitmentDiscordCandidates(
      [{
        intake,
        identity: intake.parsed.identityCandidates[0],
      }],
      {
        roster: { mode: "all", roles: [], specs: [] },
        officerThreadManager: {
          assignCandidate: async (options) => {
            assigned.push(options);
            return { outcome: "ASSIGNED" };
          },
        },
        sendToOutputChannel: async (content) => {
          sent.push(content);
          return outputMessage;
        },
        getPerformance: async () => ({
          metric: "dps",
          overall: 75,
          bestPerformanceAverage: 75,
          medianPerformanceAverage: 70,
          inferredSpec: "Arcane",
          bosses: [{
            bossName: "Example Boss",
            percentile: 75,
          }],
        }),
      },
    );

    assert.equal(results[0].overallStatus, "MANUAL_REVIEW");
    assert.equal(assigned.length, 1);
    assert.equal(assigned[0].candidateName, "Examplemage");
    assert.match(sent[0], /Source:\*\* Recruitment Discord/);
    assert.match(sent[0], /WCL Overall \(DPS\):\*\* 75\.0/);
  },
);

test(
  "infers an unambiguous DPS class and preserves manual overrides",
  () => {
    const intake = createIntake(recruitmentDiscordPosts[2]);
    const candidate = createRecruitmentDiscordCandidate({
      intake,
      identity: intake.parsed.identityCandidates[0],
      classNameOverride: "Mage",
      specOverride: "Arcane",
    });

    assert.equal(candidate.character.className, "Mage");
    assert.equal(candidate.character.spec, "Arcane");
    assert.equal(candidate.character.role, "DPS");
  },
);

test(
  "persists source-message duplicate records across store instances",
  async () => {
    const directory = await mkdtemp(
      join(tmpdir(), "rg-recruitment-intake-"),
    );
    const statePath = join(directory, "intakes.json");

    try {
      const store = new RecruitmentDiscordIntakeStore(statePath);
      await store.initialize();
      await store.recordImport({
        sourceGuildId: "guild",
        sourceChannelId: "channel",
        sourceMessageId: "message",
        sourceMessageUrl: "https://discord.com/channels/guild/channel/message",
        submittedByDiscordUserId: "officer",
        importedAt: "2026-08-10T12:00:00.000Z",
        candidates: [{
          characterName: "Example",
          realm: "Area 52",
          region: "US",
          outputMessageUrl: "https://discord.com/channels/internal/output/result",
          overallStatus: "MANUAL_REVIEW",
        }],
      });

      const reloaded = new RecruitmentDiscordIntakeStore(statePath);
      await reloaded.initialize();
      assert.equal(
        reloaded.getImport("guild", "channel", "message")
          .candidates[0].characterName,
        "Example",
      );
      await assert.rejects(
        store.recordImport({
          ...store.getImport("guild", "channel", "message"),
        }),
        /already been imported/,
      );
      const persisted = await readFile(statePath, "utf8");
      assert.doesNotThrow(() => JSON.parse(persisted));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
