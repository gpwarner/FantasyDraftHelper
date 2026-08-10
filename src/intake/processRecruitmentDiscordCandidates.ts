import type { Message } from "discord.js";

import {
  canClassHeal,
  isHealingSpecialization,
} from "../candidates/characterRoles.js";

import type {
  AzeriteCandidate,
} from "../candidates/parseAzeriteCandidate.js";

import type {
  RuntimeRosterConfig,
} from "../config/recruitmentConfigStore.js";

import {
  evaluateCandidate,
  type CheckStatus,
} from "../evaluation/evaluateCandidate.js";

import type {
  OfficerThreadManager,
} from "../officers/officerThreadManager.js";

import {
  getCharacterPerformanceSummary,
  type WarcraftLogsPerformanceSummary,
} from "../warcraftlogs/warcraftLogsClient.js";

import {
  createRecruitmentDiscordCandidate,
  type ConfirmedRecruitmentDiscordCandidate,
} from "./createRecruitmentDiscordCandidate.js";

import type {
  RecruitmentDiscordImportedCandidate,
} from "./recruitmentDiscordIntakeStore.js";

import type {
  RecruitmentDiscordIntake,
} from "./recruitmentDiscordIntake.js";

export interface ProcessRecruitmentDiscordDependencies {
  roster: RuntimeRosterConfig;
  officerThreadManager: OfficerThreadManager;
  sendToOutputChannel: (content: string) => Promise<Message>;
  getPerformance?: typeof getCharacterPerformanceSummary;
}

function hasUsablePerformance(
  performance: WarcraftLogsPerformanceSummary,
): boolean {
  return (
    typeof performance.overall === "number" &&
    Number.isFinite(performance.overall) &&
    performance.bosses.length > 0
  );
}

async function enrichWithWarcraftLogs(
  candidate: AzeriteCandidate,
  getPerformance: typeof getCharacterPerformanceSummary,
): Promise<string | undefined> {
  const reportedSpec = candidate.character.spec;
  const reportedRole = candidate.character.role;

  if (!reportedRole) {
    candidate.warcraftLogs = {
      bosses: [],
      source: "warcraftlogs_api",
      error:
        "The submitted class/spec could map to multiple roles. Edit the candidate with one class and specialization to enable a role-appropriate lookup.",
    };
    return undefined;
  }

  try {
    let performance = await getPerformance({
      characterName: candidate.character.name,
      realm: candidate.character.realm,
      region: candidate.character.region,
      specName: reportedSpec,
      role: reportedRole,
    });

    if (
      performance.metric === "dps" &&
      !hasUsablePerformance(performance) &&
      canClassHeal(candidate.character.className)
    ) {
      const healingPerformance = await getPerformance({
        characterName: candidate.character.name,
        realm: candidate.character.realm,
        region: candidate.character.region,
        role: reportedRole,
        metricOverride: "hps",
      });

      if (
        hasUsablePerformance(healingPerformance) &&
        isHealingSpecialization(
          candidate.character.className,
          healingPerformance.inferredSpec,
        )
      ) {
        performance = healingPerformance;
        candidate.character.role = "HEALING";
        candidate.character.spec =
          healingPerformance.inferredSpec ?? candidate.character.spec;

        return [
          "Warcraft Logs indicates",
          candidate.character.spec ?? "unknown-spec",
          "healing activity; the submitted class/spec was",
          reportedSpec ?? "not specific.",
        ].join(" ");
      }
    }

    candidate.warcraftLogs = {
      metric: performance.metric,
      overall: performance.overall,
      bestPerformanceAverage: performance.bestPerformanceAverage,
      medianPerformanceAverage: performance.medianPerformanceAverage,
      bosses: performance.bosses.map((boss) => ({
        bossName: boss.bossName,
        percentile: boss.percentile,
        medianPercentile: boss.medianPercentile,
        totalKills: boss.totalKills,
      })),
      source: "warcraftlogs_api",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    candidate.warcraftLogs = {
      bosses: [],
      source: "warcraftlogs_api",
      error: errorMessage,
    };
  }

  return undefined;
}

function formatContactLines(
  confirmed: ConfirmedRecruitmentDiscordCandidate,
): string[] {
  const contact = confirmed.intake.parsed.contact;
  const lines: string[] = contact.raw
    ? [
        `**Contact:** ${contact.raw.replace(/[\r\n]+/g, " ").slice(0, 300)}`,
      ]
    : [];

  if (contact.battleTag) {
    lines.push(`**BattleTag:** \`${contact.battleTag}\``);
  }
  if (contact.discordUsername) {
    lines.push(`**Discord:** \`${contact.discordUsername}\``);
  }
  if (contact.discordUserId) {
    lines.push(`**Discord user ID:** \`${contact.discordUserId}\``);
  }

  return lines.length > 0
    ? lines
    : ["**Contact information:** Not found"];
}

function formatCandidateOutput(
  confirmed: ConfirmedRecruitmentDiscordCandidate,
  candidate: AzeriteCandidate,
  evaluation: ReturnType<typeof evaluateCandidate>,
  roleCorrection?: string,
): string {
  const statusEmoji: Record<CheckStatus, string> = {
    PASS: "\u2705",
    FAIL: "\u274c",
    MANUAL_REVIEW: "\u26a0\ufe0f",
  };
  const characterDetails = [
    candidate.character.spec,
    candidate.character.className,
  ].filter(Boolean).join(" ");
  const heading = [
    `## [${candidate.character.name}](${candidate.source.messageUrl})`,
    characterDetails || undefined,
    candidate.character.role ? `(${candidate.character.role})` : undefined,
    `${candidate.character.realm} · ${candidate.character.region}`,
  ].filter(Boolean).join(" · ");
  const sourceLines = [
    "**Source:** Recruitment Discord",
    `**Submitted by:** <@${confirmed.intake.submittedByDiscordUserId}>`,
    `[Original Post](${confirmed.intake.sourceMessageUrl})`,
  ].join(" · ");
  const checkLines = evaluation.checks.map((check) =>
    `${statusEmoji[check.status]} **${check.name}:** ${check.summary}`,
  );

  if (evaluation.overallStatus === "FAIL") {
    return [
      "=========================================================================",
      heading,
      sourceLines,
      ...evaluation.checks
        .filter((check) => check.status === "FAIL")
        .map((check) =>
          `${statusEmoji.FAIL} **${check.name}:** ${check.summary}`,
        ),
    ].join("\n").slice(0, 2_000);
  }

  const progression = Object.entries(candidate.raidProgression)
    .map(([raid, progress]) => `${raid}: ${progress}`)
    .join(", ") || "Unknown";
  const overall = typeof candidate.warcraftLogs.overall === "number"
    ? candidate.warcraftLogs.overall.toFixed(1)
    : "Unknown";
  const links = [
    candidate.links.raiderIo
      ? `[Raider.IO](${candidate.links.raiderIo})`
      : undefined,
    candidate.links.warcraftLogs
      ? `[Warcraft Logs](${candidate.links.warcraftLogs})`
      : undefined,
    candidate.links.armory
      ? `[Armory](${candidate.links.armory})`
      : undefined,
  ].filter(Boolean).join(" · ") || "Profile links unavailable";

  return [
    "=========================================================================",
    heading,
    sourceLines,
    ...(roleCorrection ? [`\u26a0\ufe0f **Role correction:** ${roleCorrection}`] : []),
    `${statusEmoji[evaluation.overallStatus]} **Overall: ${evaluation.overallStatus.replaceAll("_", " ")}**`,
    "",
    ...checkLines,
    "",
    ...formatContactLines(confirmed),
    "",
    `**Progression:** ${progression} · **WCL Overall (${candidate.warcraftLogs.metric?.toUpperCase() ?? "UNKNOWN"}):** ${overall}`,
    "",
    links,
  ].join("\n").slice(0, 2_000);
}

async function processOne(
  confirmed: ConfirmedRecruitmentDiscordCandidate,
  dependencies: ProcessRecruitmentDiscordDependencies,
): Promise<RecruitmentDiscordImportedCandidate> {
  const candidate = createRecruitmentDiscordCandidate(confirmed);
  const roleCorrection = await enrichWithWarcraftLogs(
    candidate,
    dependencies.getPerformance ?? getCharacterPerformanceSummary,
  );
  const evaluation = evaluateCandidate(
    candidate,
    undefined,
    dependencies.roster,
  );
  const outputContent = formatCandidateOutput(
    confirmed,
    candidate,
    evaluation,
    roleCorrection,
  );
  const outputMessage = await dependencies.sendToOutputChannel(outputContent);

  if (evaluation.overallStatus !== "FAIL") {
    try {
      const assignment = await dependencies.officerThreadManager.assignCandidate({
        candidateName: candidate.character.name,
        candidateRealm: candidate.character.realm,
        candidateStatus:
          evaluation.overallStatus === "PASS" ? "PASS" : "MANUAL_REVIEW",
        candidateOutputMessage: outputMessage,
      });

      if (assignment.outcome === "DUPLICATE") {
        await outputMessage.edit({
          content: [
            outputContent,
            "",
            "**Duplicate character:** An existing officer workflow was kept.",
            assignment.originalAssignmentMessageUrl
              ? `[Open original assignment](${assignment.originalAssignmentMessageUrl})`
              : undefined,
          ].filter(Boolean).join("\n").slice(0, 2_000),
          allowedMentions: { parse: [] },
        });
      }
    } catch (error) {
      await outputMessage.delete().catch(() => undefined);
      throw error;
    }
  }

  return {
    characterName: candidate.character.name,
    realm: candidate.character.realm,
    region: candidate.character.region,
    outputMessageUrl: outputMessage.url,
    overallStatus: evaluation.overallStatus,
  };
}

export async function processRecruitmentDiscordCandidates(
  confirmedCandidates: readonly ConfirmedRecruitmentDiscordCandidate[],
  dependencies: ProcessRecruitmentDiscordDependencies,
): Promise<RecruitmentDiscordImportedCandidate[]> {
  const results: RecruitmentDiscordImportedCandidate[] = [];

  for (const confirmed of confirmedCandidates) {
    results.push(await processOne(confirmed, dependencies));
  }

  return results;
}

function formatPackageLinks(
  label: string,
  urls: readonly string[],
): string[] {
  return urls.slice(0, 2).map(
    (url, index) =>
      `[${label}${urls.length > 1 ? ` ${index + 1}` : ""}](${url})`,
  );
}

function getPackageDisplayName(
  intake: RecruitmentDiscordIntake,
): string {
  const count = intake.parsed.group?.declaredCount ??
    intake.parsed.group?.members.length ??
    "multiple";

  return [
    "Recruitment Package:",
    intake.sourceAuthorDisplayName,
    `(${count} people)`,
  ].join(" ").slice(0, 100);
}

function formatRecruitmentPackageOutput(
  intake: RecruitmentDiscordIntake,
): string {
  const group = intake.parsed.group;

  if (!group) {
    throw new Error("A package import requires a parsed group post.");
  }

  const memberLines = group.members.flatMap((member) => {
    const identities = member.identityCandidates
      .map((identity) =>
        `${identity.characterName}-${identity.realm} (${identity.region})`,
      )
      .join(", ") || "Not found";
    const links = [
      ...formatPackageLinks("Raider.IO", member.links.raiderIo),
      ...formatPackageLinks("WCL", member.links.warcraftLogs),
      ...formatPackageLinks("Armory", member.links.armory),
    ];

    return [
      "",
      `**Raider ${member.memberNumber}: ${member.classSpec ?? "Class/spec not found"}**`,
      `Faction: ${member.faction ?? "Not found"}`,
      `Cleared: ${member.progressionRaw ?? "Not found"}`,
      `Availability: ${member.availability ?? "Not found"}`,
      `Characters: ${identities}`,
      `Links: ${links.join(" · ") || "Not found"}`,
    ];
  });
  const content = [
    "=========================================================================",
    `## [${getPackageDisplayName(intake)}](${intake.sourceMessageUrl})`,
    "**Source:** Recruitment Discord",
    `**Submitted by:** <@${intake.submittedByDiscordUserId}> · [Original Post](${intake.sourceMessageUrl})`,
    `**Contact:** ${intake.parsed.contact.raw ?? "Not found"}`,
    `**Guild type:** ${group.guildType ?? "Not found"}`,
    "⚠️ **Overall: MANUAL REVIEW**",
    "**Package deal:** These raiders must be evaluated and contacted together. Individual automated pass/fail checks were not applied.",
    ...memberLines,
    "",
    `**Additional information:** ${group.additionalInformation ?? "None"}`,
  ].join("\n");

  return content.length <= 2_000
    ? content
    : `${content.slice(0, 1_960)}\n… *(package post truncated)*`;
}

export async function processRecruitmentDiscordPackage(
  intake: RecruitmentDiscordIntake,
  dependencies: ProcessRecruitmentDiscordDependencies,
): Promise<RecruitmentDiscordImportedCandidate> {
  const packageName = getPackageDisplayName(intake);
  const outputContent = formatRecruitmentPackageOutput(intake);
  const outputMessage = await dependencies.sendToOutputChannel(outputContent);

  try {
    const assignment = await dependencies.officerThreadManager.assignCandidate({
      candidateName: packageName,
      candidateRealm: `package-${intake.sourceMessageId}`,
      candidateStatus: "MANUAL_REVIEW",
      candidateOutputMessage: outputMessage,
    });

    if (assignment.outcome === "DUPLICATE") {
      await outputMessage.edit({
        content: [
          outputContent,
          "",
          "**Duplicate package:** The existing officer workflow was kept.",
          assignment.originalAssignmentMessageUrl
            ? `[Open original assignment](${assignment.originalAssignmentMessageUrl})`
            : undefined,
        ].filter(Boolean).join("\n").slice(0, 2_000),
        allowedMentions: { parse: [] },
      });
    }
  } catch (error) {
    await outputMessage.delete().catch(() => undefined);
    throw error;
  }

  return {
    characterName: packageName,
    realm: "Package",
    region: "Multiple",
    outputMessageUrl: outputMessage.url,
    overallStatus: "MANUAL_REVIEW",
  };
}
