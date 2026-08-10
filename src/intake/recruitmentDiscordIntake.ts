import {
  ActionRowBuilder,
  ApplicationCommandType,
  ApplicationIntegrationType,
  ButtonBuilder,
  ButtonStyle,
  ContextMenuCommandBuilder,
  InteractionContextType,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  type APIEmbed,
  type Interaction,
  type Message,
} from "discord.js";

import { randomUUID } from "node:crypto";

import {
  parseRecruitmentDiscordPost,
  type ParsedRecruitmentDiscordPost,
  type RecruitmentIdentityCandidate,
} from "./parseRecruitmentDiscordPost.js";

import type {
  ConfirmedRecruitmentDiscordCandidate,
} from "./createRecruitmentDiscordCandidate.js";

import {
  inferRecruitmentCharacterMetadata,
} from "./createRecruitmentDiscordCandidate.js";

import type {
  RecruitmentDiscordImportedCandidate,
  RecruitmentDiscordIntakeStore,
} from "./recruitmentDiscordIntakeStore.js";

import {
  createRecruitmentDiscordSourceKey,
} from "./recruitmentDiscordIntakeStore.js";

export const addToRecruitmentCommandName =
  "Add to Recruitment";

export const addToRecruitmentCommand =
  new ContextMenuCommandBuilder()
    .setName(addToRecruitmentCommandName)
    .setType(ApplicationCommandType.Message)
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall,
    )
    .setContexts(
      InteractionContextType.Guild,
    );

export interface RecruitmentDiscordAttachment {
  id: string;
  name: string;
  url: string;
  contentType?: string;
  description?: string;
  size: number;
}

export interface RecruitmentDiscordIntake {
  sourceType: "RECRUITMENT_DISCORD";
  submittedByDiscordUserId: string;
  sourceGuildId?: string;
  sourceChannelId: string;
  sourceMessageId: string;
  sourceMessageUrl: string;
  sourceAuthorId: string;
  sourceAuthorUsername: string;
  sourceAuthorDisplayName: string;
  content: string;
  parsed: ParsedRecruitmentDiscordPost;
  attachments: RecruitmentDiscordAttachment[];
  embeds: APIEmbed[];
  submittedAt: string;
}

export interface RecruitmentDiscordIntakeDependencies {
  authorizedOfficerIds: readonly string[];
  intakeStore: RecruitmentDiscordIntakeStore;
  importCandidates: (
    candidates: ConfirmedRecruitmentDiscordCandidate[],
  ) => Promise<RecruitmentDiscordImportedCandidate[]>;
  importPackage: (
    intake: RecruitmentDiscordIntake,
  ) => Promise<RecruitmentDiscordImportedCandidate>;
}

interface PendingCandidateTarget {
  key: string;
  label: string;
  memberNumber?: number;
  classSpecRaw?: string;
  progressionRaw?: string;
  availability?: string;
  identities: RecruitmentIdentityCandidate[];
  selectedIdentity?: RecruitmentIdentityCandidate;
  classNameOverride?: string;
  specOverride?: string;
}

interface PendingRecruitmentDiscordIntake {
  id: string;
  ownerDiscordUserId: string;
  intake: RecruitmentDiscordIntake;
  targets: PendingCandidateTarget[];
  expiresAt: number;
}

const interactionPrefix = "recruit-intake";
const pendingLifetimeMilliseconds = 30 * 60 * 1_000;
const pendingIntakes = new Map<
  string,
  PendingRecruitmentDiscordIntake
>();
const activeImportSourceKeys = new Set<string>();

export function normalizeRecruitmentDiscordPost(
  message: Message,
  submittedByDiscordUserId: string,
  submittedAt: Date,
): RecruitmentDiscordIntake {
  return {
    sourceType: "RECRUITMENT_DISCORD",
    submittedByDiscordUserId,
    sourceGuildId:
      message.guildId ?? undefined,
    sourceChannelId: message.channelId,
    sourceMessageId: message.id,
    sourceMessageUrl: message.url,
    sourceAuthorId: message.author.id,
    sourceAuthorUsername:
      message.author.username,
    sourceAuthorDisplayName:
      message.member?.displayName ??
      message.author.displayName,
    content: message.content,
    parsed:
      parseRecruitmentDiscordPost(
        message.content,
      ),
    attachments: [
      ...message.attachments.values(),
    ].map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      url: attachment.url,
      ...(attachment.contentType
        ? {
            contentType:
              attachment.contentType,
          }
        : {}),
      ...(attachment.description
        ? {
            description:
              attachment.description,
          }
        : {}),
      size: attachment.size,
    })),
    embeds: message.embeds.map(
      (embed) => embed.toJSON(),
    ),
    submittedAt: submittedAt.toISOString(),
  };
}

function formatInlineText(
  value: string,
  maximumLength = 160,
): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, maximumLength);
}

function formatQuotedPreview(
  content: string,
): string {
  const preview = content
    .trim()
    .slice(0, 350);

  if (!preview) {
    return "> *(No message text)*";
  }

  return preview
    .split(/\r?\n/)
    .map((line) => `> ${line || " "}`)
    .join("\n");
}

export function formatRecruitmentDiscordDiagnostic(
  intake: RecruitmentDiscordIntake,
): string {
  const parsed = intake.parsed;
  const parserStatus =
    parsed.postType === "GROUP"
      ? `Group post found; ${parsed.group?.members.length ?? 0} raiders parsed independently`
      : parsed.identityStatus ===
      "READY_FOR_CONFIRMATION"
      ? "One character identity found; confirmation required"
      : parsed.identityStatus ===
          "MULTIPLE_IDENTITIES"
        ? "Multiple character identities found; recruiter selection required"
        : "No safe character identity found; manual entry required";
  const identityLines =
    parsed.identityCandidates
      .slice(0, 5)
      .map(
        (identity) =>
          [
            "-",
            `${identity.characterName}-${identity.realm}`,
            `(${identity.region};`,
            `${identity.sources.join(", ")})`,
          ].join(" "),
      );
  const attachmentLines =
    intake.attachments
      .slice(0, 3)
      .map(
        (attachment) =>
          `- ${formatInlineText(attachment.name)}: ${attachment.url}`,
      );
  const groupLines = parsed.group
    ? [
        `**Declared group size:** ${parsed.group.declaredCount ?? "Not found"}`,
        `**Guild type:** ${formatInlineText(parsed.group.guildType ?? "Not found")}`,
        "**Group members:**",
        ...parsed.group.members.map((member) => {
          const identities = member.identityCandidates
            .map(
              (identity) =>
                `${identity.characterName}-${identity.realm}`,
            )
            .join(", ");

          return [
            `- Raider ${member.memberNumber}:`,
            formatInlineText(member.classSpec ?? "class/spec not found", 80),
            `| ${member.progression.join(", ") || "progress not found"}`,
            `| ${formatInlineText(identities || "identity not found", 120)}`,
          ].join(" ");
        }),
      ]
    : [
        `**Class/spec:** ${formatInlineText(parsed.fields.classSpec ?? "Not found")}`,
        `**Progression:** ${parsed.progression.join(", ") || "Not found"}`,
        `**Availability:** ${formatInlineText(parsed.fields.availability ?? "Not found")}`,
      ];

  const diagnostic = [
    "## Recruitment Discord intake received",
    `**Source:** Recruitment Discord`,
    `**Submitted by:** <@${intake.submittedByDiscordUserId}>`,
    `**Original post:** [View Message](${intake.sourceMessageUrl})`,
    [
      "**Source author:**",
      formatInlineText(
        intake.sourceAuthorDisplayName,
      ),
      `(@${formatInlineText(intake.sourceAuthorUsername)};`,
      `${intake.sourceAuthorId})`,
    ].join(" "),
    `**Source identity:** ${intake.sourceGuildId ?? "unknown guild"}/${intake.sourceChannelId}/${intake.sourceMessageId}`,
    `**Submitted at:** ${intake.submittedAt}`,
    "",
    `**Post type:** ${parsed.postType === "GROUP" ? "Group" : "Individual"}`,
    `**Parser status:** ${parserStatus}`,
    `**Contact:** ${formatInlineText(parsed.contact.raw ?? "Not found")}`,
    ...groupLines,
    `**Identity candidates:** ${parsed.identityCandidates.length}`,
    ...identityLines,
    [
      "**Links:**",
      `${parsed.links.raiderIo.length} Raider.IO,`,
      `${parsed.links.warcraftLogs.length} Warcraft Logs,`,
      `${parsed.links.armory.length} Armory`,
    ].join(" "),
    "",
    "**Message content:**",
    formatQuotedPreview(intake.content),
    "",
    `**Attachments:** ${intake.attachments.length}`,
    ...attachmentLines,
    `**Embeds:** ${intake.embeds.length}`,
    "",
    "*Diagnostic representation of the parsed intake.*",
  ].join("\n");

  if (diagnostic.length <= 2_000) {
    return diagnostic;
  }

  return [
    diagnostic.slice(0, 1_950),
    "… *(diagnostic truncated)*",
  ].join("\n");
}

function createPendingTargets(
  intake: RecruitmentDiscordIntake,
): PendingCandidateTarget[] {
  if (intake.parsed.group) {
    return intake.parsed.group.members.map((member) => {
      const inferred = inferRecruitmentCharacterMetadata(member.classSpec);

      return {
        key: String(member.memberNumber),
        label: `Raider ${member.memberNumber}`,
        memberNumber: member.memberNumber,
        classSpecRaw: member.classSpec,
        progressionRaw: member.progressionRaw,
        availability: member.availability,
        identities: member.identityCandidates,
        classNameOverride: inferred.className,
        specOverride: inferred.spec,
        ...(member.identityCandidates.length === 1
          ? { selectedIdentity: member.identityCandidates[0] }
          : {}),
      };
    });
  }

  const inferred = inferRecruitmentCharacterMetadata(
    intake.parsed.fields.classSpec,
  );

  return [{
    key: "candidate",
    label: "Candidate",
    classSpecRaw: intake.parsed.fields.classSpec,
    progressionRaw: intake.parsed.fields.progression,
    availability: intake.parsed.fields.availability,
    identities: intake.parsed.identityCandidates,
    classNameOverride: inferred.className,
    specOverride: inferred.spec,
    ...(intake.parsed.identityCandidates.length === 1
      ? { selectedIdentity: intake.parsed.identityCandidates[0] }
      : {}),
  }];
}

function createPendingIntake(
  intake: RecruitmentDiscordIntake,
): PendingRecruitmentDiscordIntake {
  return {
    id: randomUUID(),
    ownerDiscordUserId: intake.submittedByDiscordUserId,
    intake,
    targets: createPendingTargets(intake),
    expiresAt: Date.now() + pendingLifetimeMilliseconds,
  };
}

function createInteractionId(
  action: string,
  pendingId: string,
  targetKey?: string,
): string {
  return [interactionPrefix, action, pendingId, targetKey]
    .filter(Boolean)
    .join(":");
}

function parseInteractionId(
  customId: string,
): { action: string; pendingId: string; targetKey?: string } | undefined {
  const [prefix, action, pendingId, targetKey] = customId.split(":");

  return prefix === interactionPrefix && action && pendingId
    ? { action, pendingId, targetKey }
    : undefined;
}

function getPendingForInteraction(
  interaction: Interaction,
  pendingId: string,
): PendingRecruitmentDiscordIntake | undefined {
  const now = Date.now();

  for (const [id, pending] of pendingIntakes) {
    if (pending.expiresAt <= now) {
      pendingIntakes.delete(id);
    }
  }

  const pending = pendingIntakes.get(pendingId);

  return pending?.ownerDiscordUserId === interaction.user.id
    ? pending
    : undefined;
}

function formatIdentity(identity: RecruitmentIdentityCandidate): string {
  return `${identity.characterName}-${identity.realm} (${identity.region})`;
}

function renderConfirmation(
  pending: PendingRecruitmentDiscordIntake,
): {
  content: string;
  components: Array<ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>>;
} {
  const isGroup = pending.intake.parsed.postType === "GROUP";
  const allSelected = isGroup || pending.targets.every(
    (target) => target.selectedIdentity,
  );
  const lines = [
    `## Confirm ${isGroup ? "Recruitment Group" : "Candidate"}`,
    `[View original post](${pending.intake.sourceMessageUrl})`,
    `**Contact:** ${formatInlineText(pending.intake.parsed.contact.raw ?? "Not found")}`,
    "",
    ...pending.targets.map((target) => [
      `**${target.label}:** ${isGroup
        ? target.identities.map(formatIdentity).join(", ") || "No character identity found"
        : target.selectedIdentity
          ? formatIdentity(target.selectedIdentity)
          : "Choose or enter a character"}`,
      `Class/spec: ${formatInlineText(target.classSpecRaw ?? "Not found", 100)}`,
      `Progression: ${formatInlineText(target.progressionRaw ?? "Not found", 100)}`,
      `Availability: ${formatInlineText(target.availability ?? "Not found", 120)}`,
    ].join("\n")),
    "",
    isGroup
      ? "Confirm to add this package as one manual-review recruitment case."
      : allSelected
      ? "Confirm to evaluate and add the selected candidate(s) to the recruitment workflow."
      : "Select or enter one character for each raider before confirming.",
  ];
  const components: Array<ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>> = [];

  for (const target of isGroup ? [] : pending.targets) {
    if (target.identities.length <= 1 || components.length >= 4) {
      continue;
    }

    const menu = new StringSelectMenuBuilder()
      .setCustomId(createInteractionId("select", pending.id, target.key))
      .setPlaceholder(`Choose ${target.label.toLowerCase()}`)
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(target.identities.slice(0, 25).map(
        (identity, index) => new StringSelectMenuOptionBuilder()
          .setLabel(`${identity.characterName}-${identity.realm}`.slice(0, 100))
          .setDescription(`${identity.region} · ${identity.sources.join(", ")}`.slice(0, 100))
          .setValue(String(index))
          .setDefault(target.selectedIdentity === identity),
      ));

    components.push(
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu),
    );
  }

  const actionButtons = [
    new ButtonBuilder()
        .setCustomId(createInteractionId("confirm", pending.id))
        .setLabel(isGroup ? "Add Package" : "Add Candidate")
        .setStyle(ButtonStyle.Success)
        .setDisabled(!allSelected),
    ...(!isGroup
      ? [new ButtonBuilder()
        .setCustomId(createInteractionId("edit", pending.id))
        .setLabel(allSelected
              ? "Edit"
              : "Enter Character Info")
        .setStyle(ButtonStyle.Secondary)]
      : []),
    new ButtonBuilder()
        .setCustomId(createInteractionId("cancel", pending.id))
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Danger),
  ];

  components.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(...actionButtons),
  );

  return { content: lines.join("\n").slice(0, 2_000), components };
}

function createTextInputRow(
  customId: string,
  label: string,
  required: boolean,
  value?: string,
): ActionRowBuilder<TextInputBuilder> {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label.slice(0, 45))
    .setStyle(TextInputStyle.Short)
    .setRequired(required)
    .setMaxLength(100);

  if (value) {
    input.setValue(value.slice(0, 100));
  }

  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

function createEditModal(
  pending: PendingRecruitmentDiscordIntake,
): ModalBuilder | undefined {
  const isGroup = pending.intake.parsed.postType === "GROUP";
  const modal = new ModalBuilder()
    .setCustomId(createInteractionId("modal", pending.id))
    .setTitle(isGroup ? "Edit Group Identities" : "Edit Candidate");

  if (isGroup) {
    if (pending.targets.length > 5) {
      return undefined;
    }

    modal.addComponents(...pending.targets.map((target) =>
      createTextInputRow(
        `identity-${target.key}`,
        `${target.label}: Name | Realm | Region`,
        true,
        target.selectedIdentity
          ? [target.selectedIdentity.characterName, target.selectedIdentity.realm, target.selectedIdentity.region].join(" | ")
          : undefined,
      ),
    ));
    return modal;
  }

  const target = pending.targets[0];
  const identity = target.selectedIdentity;
  modal.addComponents(
    createTextInputRow("character-name", "Character name", true, identity?.characterName),
    createTextInputRow("realm", "Realm", true, identity?.realm),
    createTextInputRow("region", "Region (US, EU, KR, TW, or CN)", true, identity?.region ?? "US"),
    createTextInputRow("class-name", "Class (optional)", false, target.classNameOverride),
    createTextInputRow("spec-name", "Specialization (optional)", false, target.specOverride),
  );
  return modal;
}

function parseManualIdentity(value: string): RecruitmentIdentityCandidate | undefined {
  const parts = value.split(/\s*(?:\||,)\s*/).map((part) => part.trim());

  if (parts.length !== 3 || parts.some((part) => !part)) {
    return undefined;
  }

  const [characterName, realm, rawRegion] = parts;
  const region = rawRegion.toUpperCase();

  if (!/^(?:US|EU|KR|TW|CN)$/.test(region)) {
    return undefined;
  }

  return {
    characterName,
    realm,
    realmSlug: realm.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    region,
    sources: [],
  };
}

function formatExistingImport(
  candidates: readonly RecruitmentDiscordImportedCandidate[],
): string {
  return [
    "This post is already in the recruitment system.",
    "",
    ...candidates.map((candidate) =>
      `- [${candidate.characterName}-${candidate.realm}](${candidate.outputMessageUrl}) · ${candidate.overallStatus.replaceAll("_", " ")}`,
    ),
  ].join("\n");
}

export async function handleAddToRecruitmentInteraction(
  interaction: Interaction,
  dependencies:
    RecruitmentDiscordIntakeDependencies,
): Promise<boolean> {
  const componentId =
    (interaction.isButton() ||
      interaction.isStringSelectMenu() ||
      interaction.isModalSubmit())
      ? parseInteractionId(interaction.customId)
      : undefined;
  const isContextCommand =
    interaction.isMessageContextMenuCommand() &&
    interaction.commandName === addToRecruitmentCommandName;

  if (!isContextCommand && !componentId) {
    return false;
  }

  if (
    !dependencies.authorizedOfficerIds.includes(
      interaction.user.id,
    )
  ) {
    if (!interaction.isRepliable()) {
      return true;
    }

    await interaction.reply({
      content:
        "You are not authorized to add candidates to this recruitment system.",
      flags: MessageFlags.Ephemeral,
      allowedMentions: {
        parse: [],
      },
    });

    return true;
  }

  if (componentId) {
    const pending = getPendingForInteraction(interaction, componentId.pendingId);

    if (!pending) {
      if (interaction.isRepliable()) {
        await interaction.reply({
          content:
            "This candidate confirmation expired or belongs to another recruiter. Run Add to Recruitment again.",
          flags: MessageFlags.Ephemeral,
        });
      }
      return true;
    }

    if (interaction.isStringSelectMenu() && componentId.action === "select") {
      const target = pending.targets.find(
        (candidateTarget) => candidateTarget.key === componentId.targetKey,
      );
      const identity = target?.identities[
        Number.parseInt(interaction.values[0] ?? "", 10)
      ];

      if (target && identity) {
        target.selectedIdentity = identity;
      }

      await interaction.update(renderConfirmation(pending));
      return true;
    }

    if (interaction.isButton() && componentId.action === "cancel") {
      pendingIntakes.delete(pending.id);
      await interaction.update({
        content: "Candidate import canceled. Nothing was added.",
        components: [],
      });
      return true;
    }

    if (interaction.isButton() && componentId.action === "edit") {
      const modal = createEditModal(pending);

      if (modal) {
        await interaction.showModal(modal);
      } else {
        await interaction.reply({
          content:
            "This group is too large for one Discord edit form. Split it into smaller candidate imports for now.",
          flags: MessageFlags.Ephemeral,
        });
      }
      return true;
    }

    if (interaction.isModalSubmit() && componentId.action === "modal") {
      if (pending.intake.parsed.postType === "GROUP") {
        for (const target of pending.targets) {
          const identity = parseManualIdentity(
            interaction.fields.getTextInputValue(`identity-${target.key}`),
          );

          if (!identity) {
            await interaction.reply({
              content:
                `${target.label} must use Name | Realm | Region, for example Example | Area 52 | US.`,
              flags: MessageFlags.Ephemeral,
            });
            return true;
          }

          target.selectedIdentity = identity;
        }
      } else {
        const target = pending.targets[0];
        const identity = parseManualIdentity([
          interaction.fields.getTextInputValue("character-name"),
          interaction.fields.getTextInputValue("realm"),
          interaction.fields.getTextInputValue("region"),
        ].join(" | "));

        if (!identity) {
          await interaction.reply({
            content:
              "Enter a character name, realm, and a valid region: US, EU, KR, TW, or CN.",
            flags: MessageFlags.Ephemeral,
          });
          return true;
        }

        target.selectedIdentity = identity;
        target.classNameOverride =
          interaction.fields.getTextInputValue("class-name").trim() || undefined;
        target.specOverride =
          interaction.fields.getTextInputValue("spec-name").trim() || undefined;
      }

      if (interaction.isFromMessage()) {
        await interaction.update(renderConfirmation(pending));
      } else {
        await interaction.reply({
          ...renderConfirmation(pending),
          flags: MessageFlags.Ephemeral,
        });
      }
      return true;
    }

    if (interaction.isButton() && componentId.action === "confirm") {
      const selectedTargets = pending.targets.filter(
        (target): target is PendingCandidateTarget & {
          selectedIdentity: RecruitmentIdentityCandidate;
        } => Boolean(target.selectedIdentity),
      );

      const isGroup = pending.intake.parsed.postType === "GROUP";

      if (!isGroup && selectedTargets.length !== pending.targets.length) {
        await interaction.update(renderConfirmation(pending));
        return true;
      }

      const sourceKey = createRecruitmentDiscordSourceKey(
        pending.intake.sourceGuildId,
        pending.intake.sourceChannelId,
        pending.intake.sourceMessageId,
      );

      if (activeImportSourceKeys.has(sourceKey)) {
        await interaction.reply({
          content:
            "This post is already being imported. Wait for the first confirmation to finish.",
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }

      activeImportSourceKeys.add(sourceKey);

      try {
        await interaction.update({
          content: "Evaluating candidate information...",
          components: [],
        });

        const existing = dependencies.intakeStore.getImport(
          pending.intake.sourceGuildId,
          pending.intake.sourceChannelId,
          pending.intake.sourceMessageId,
        );

        if (existing) {
          pendingIntakes.delete(pending.id);
          await interaction.editReply({
            content: formatExistingImport(existing.candidates),
            components: [],
          });
          return true;
        }

        const imported = isGroup
          ? [await dependencies.importPackage(pending.intake)]
          : await dependencies.importCandidates(
              selectedTargets.map((target) => ({
                intake: pending.intake,
                identity: target.selectedIdentity,
                memberNumber: target.memberNumber,
                classSpecRaw: target.classSpecRaw,
                progressionRaw: target.progressionRaw,
                availability: target.availability,
                classNameOverride: target.classNameOverride,
                specOverride: target.specOverride,
              })),
            );

        try {
          await dependencies.intakeStore.recordImport({
            sourceGuildId: pending.intake.sourceGuildId,
            sourceChannelId: pending.intake.sourceChannelId,
            sourceMessageId: pending.intake.sourceMessageId,
            sourceMessageUrl: pending.intake.sourceMessageUrl,
            submittedByDiscordUserId: pending.ownerDiscordUserId,
            importedAt: new Date().toISOString(),
            candidates: imported,
          });
        } catch (persistenceError) {
          pendingIntakes.delete(pending.id);
          console.error(
            "Candidates were imported, but the Recruitment Discord source record could not be saved:",
            persistenceError,
          );
          await interaction.editReply({
            content: [
              "The candidate output was created, but duplicate protection could not be saved. Do not import this source post again until the bot logs are checked.",
              "",
              ...imported.map((candidate) =>
                `- [${candidate.characterName}-${candidate.realm}](${candidate.outputMessageUrl})`,
              ),
            ].join("\n"),
            components: [],
          });
          return true;
        }
        pendingIntakes.delete(pending.id);

        await interaction.editReply({
          content: [
            `\u2705 ${isGroup ? "Recruitment package" : "Candidate"} added.`,
            "",
            ...imported.map((candidate) =>
              `- [${candidate.characterName}-${candidate.realm}](${candidate.outputMessageUrl}) - ${candidate.overallStatus.replaceAll("_", " ")}`,
            ),
          ].join("\n"),
          components: [],
        });
      } catch (error) {
        console.error("Could not confirm Recruitment Discord intake:", error);
        await interaction.editReply({
          content:
            "The import did not finish. Check the bot logs before retrying; part of a recruitment group may already have been added.",
          components: [],
        });
      } finally {
        activeImportSourceKeys.delete(sourceKey);
      }

      return true;
    }

    return true;
  }

  if (!interaction.isMessageContextMenuCommand()) {
    return false;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  try {
    const intake =
      normalizeRecruitmentDiscordPost(
        interaction.targetMessage,
        interaction.user.id,
        interaction.createdAt,
      );

    const existing = dependencies.intakeStore.getImport(
      intake.sourceGuildId,
      intake.sourceChannelId,
      intake.sourceMessageId,
    );

    if (existing) {
      await interaction.editReply({
        content: formatExistingImport(existing.candidates),
        components: [],
      });
      return true;
    }

    const pending = createPendingIntake(intake);
    pendingIntakes.set(pending.id, pending);
    const confirmation = renderConfirmation(pending);

    await interaction.editReply({
      content: confirmation.content,
      components: confirmation.components,
      allowedMentions: {
        parse: [],
      },
    });
  } catch (error) {
    console.error(
      "Could not import Recruitment Discord message:",
      error,
    );

    await interaction.editReply({
      content:
        "I could not add this message to the recruitment intake. Nothing was recorded; please try again.",
      allowedMentions: {
        parse: [],
      },
    });
  }

  return true;
}
