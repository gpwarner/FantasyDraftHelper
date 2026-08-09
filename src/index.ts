import "dotenv/config";

import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  type Message,
  type TextBasedChannel,
} from "discord.js";

import {
  parseAzeriteCandidate,
} from "./candidates/parseAzeriteCandidate.js";

import {
  canClassHeal,
  isHealingSpecialization,
} from "./candidates/characterRoles.js";

import {
  evaluateCandidate,
  type CheckStatus,
} from "./evaluation/evaluateCandidate.js";

import {
  getManualAvailability,
} from "./schedules/manualAvailability.js";

import {
  parseCandidateContacts,
} from "./contacts/parseCandidateContacts.js";

import {
  getCharacterPerformanceSummary,
  type WarcraftLogsPerformanceSummary,
} from "./warcraftlogs/warcraftLogsClient.js";

import {
  OfficerThreadManager,
} from "./officers/officerThreadManager.js";

import {
  RecruitmentConfigStore,
} from "./config/recruitmentConfigStore.js";

import {
  handleRecruitmentConfigInteraction,
  registerRecruitmentConfigCommand,
} from "./config/recruitmentConfigCommands.js";

/**
 * Read a required environment variable and stop immediately
 * when it is missing.
 */
function getRequiredEnvironmentVariable(
  name: string,
): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Check your .env file.`,
    );
  }

  return value;
}

const discordToken =
  getRequiredEnvironmentVariable("DISCORD_TOKEN");

const azeriteChannelId =
  getRequiredEnvironmentVariable(
    "AZERITE_CHANNEL_ID",
  );

const outputChannelId =
  getRequiredEnvironmentVariable(
    "OUTPUT_CHANNEL_ID",
  );

const azeriteBotId =
  getRequiredEnvironmentVariable(
    "AZERITE_BOT_ID",
  );

const defaultRecruitmentOfficerIds = [
  ...new Set(
    getRequiredEnvironmentVariable(
      "RECRUITMENT_OFFICER_IDS",
    )
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  ),
];

for (
  const officerId of
    defaultRecruitmentOfficerIds
) {
  if (!/^\d{17,20}$/.test(officerId)) {
    throw new Error(
      [
        `Invalid recruitment officer ID: "${officerId}".`,
        "RECRUITMENT_OFFICER_IDS must contain",
        "comma-separated numeric Discord user IDs.",
      ].join(" "),
    );
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ],

  partials: [
    Partials.Channel,
  ],
});

const auditChannelId =
  getRequiredEnvironmentVariable(
    "AUDIT_CHANNEL_ID",
  );

const recruitmentConfigStore =
  new RecruitmentConfigStore(
    defaultRecruitmentOfficerIds,
  );

await recruitmentConfigStore
  .initialize();

const recruitmentOfficerIds =
  recruitmentConfigStore
    .getConfig()
    .officerIds;

const officerThreadManager =
  new OfficerThreadManager(
    client,
    outputChannelId,
    auditChannelId,
    recruitmentOfficerIds,
  );

/**
 * Startup/history-processing state.
 */
let startupCatchUpComplete = false;
let processingHalted = false;

const processedThisRun = new Set<string>();

const pendingLiveMessages =
  new Map<string, Message>();

let liveProcessingQueue: Promise<void> =
  Promise.resolve();

const HISTORY_RECONCILIATION_INTERVAL_MS =
  5 * 60 * 1000;

/**
 * Send a message to the configured output channel.
 */
async function sendToOutputChannel(
  content: string,
): Promise<Message> {
  const channel = await client.channels.fetch(
    outputChannelId,
  );

  if (!channel) {
    throw new Error(
      `Output channel ${outputChannelId} was not found.`,
    );
  }

  if (!channel.isSendable()) {
    throw new Error(
      `Output channel ${outputChannelId} does not support sending messages.`,
    );
  }

  return channel.send({
    content,
    flags:
      MessageFlags.SuppressEmbeds,
    allowedMentions: {
      parse: [],
    },
  });
}

/**
 * Convert an Azerite Discord message into a JSON-safe
 * object for local debugging.
 */
function createInspectionPayload(
  message: Message,
): object {
  return {
    messageId: message.id,
    messageUrl: message.url,
    channelId: message.channelId,
    guildId: message.guildId,
    createdAt: message.createdAt.toISOString(),

    author: {
      id: message.author.id,
      username: message.author.username,
      displayName: message.author.displayName,
      bot: message.author.bot,
    },

    webhookId: message.webhookId,
    content: message.content,

    embeds: message.embeds.map(
      (embed) => embed.toJSON(),
    ),

    components: message.components.map(
      (component) => component.toJSON(),
    ),

    attachments: message.attachments.map(
      (attachment) => ({
        id: attachment.id,
        name: attachment.name,
        description: attachment.description,
        contentType: attachment.contentType,
        size: attachment.size,
        url: attachment.url,
      }),
    ),
  };
}

/**
 * Compare two Discord snowflake IDs.
 *
 * Discord IDs are too large to compare safely as ordinary
 * JavaScript numbers.
 */
function isSnowflakeAfter(
  candidateId: string,
  comparisonId: string,
): boolean {
  return BigInt(candidateId) > BigInt(comparisonId);
}

/**
 * Find the oldest message in an iterable collection.
 */
function getOldestMessage(
  messages: Iterable<Message>,
): Message | undefined {
  let oldest: Message | undefined;

  for (const message of messages) {
    if (
      !oldest ||
      BigInt(message.id) < BigInt(oldest.id)
    ) {
      oldest = message;
    }
  }

  return oldest;
}

/**
 * Extract the original Azerite message ID from one of this
 * bot's output messages.
 *
 * Current output format:
 *
 * ## [Character](https://discord.com/channels/GUILD/CHANNEL/MESSAGE)
 *
 * The second pattern supports older messages that included a
 * separate "Original Azerite post" link.
 */
function getProcessedAzeriteMessageId(
  outputMessage: Message,
): string | undefined {
  const linkedNamePattern = new RegExp(
    [
      "^## \\[[^\\]]+\\]\\(",
      "https://discord\\.com/channels/",
      "\\d+/",
      azeriteChannelId,
      "/(\\d{17,20})",
      "\\)",
    ].join(""),
    "m",
  );

  const linkedNameMatch =
    outputMessage.content.match(
      linkedNamePattern,
    );

  if (linkedNameMatch?.[1]) {
    return linkedNameMatch[1];
  }

  const legacyLinkPattern = new RegExp(
    [
      "\\[Original Azerite post\\]\\(",
      "https://discord\\.com/channels/",
      "\\d+/",
      azeriteChannelId,
      "/(\\d{17,20})",
      "\\)",
    ].join(""),
  );

  const legacyMatch =
    outputMessage.content.match(
      legacyLinkPattern,
    );

  return legacyMatch?.[1];
}

/**
 * Search the output channel for the newest Azerite source
 * message that this bot has already processed.
 *
 * If the output channel is empty, or contains no recognized
 * bot results, this returns undefined.
 */
async function findLastProcessedAzeriteMessageId(
  outputChannel: TextBasedChannel,
): Promise<string | undefined> {
  let before: string | undefined;
  let highestProcessedId: string | undefined;

  while (true) {
    const batch =
      await outputChannel.messages.fetch({
        limit: 100,
        cache: false,
        ...(before ? { before } : {}),
      });

    if (batch.size === 0) {
      break;
    }

    for (const message of batch.values()) {
      if (message.author.id !== client.user?.id) {
        continue;
      }

      const sourceMessageId =
        getProcessedAzeriteMessageId(
          message,
        );

      if (!sourceMessageId) {
        continue;
      }

      if (
        !highestProcessedId ||
        isSnowflakeAfter(
          sourceMessageId,
          highestProcessedId,
        )
      ) {
        highestProcessedId = sourceMessageId;
      }
    }

    if (batch.size < 100) {
      break;
    }

    const oldestMessage =
      getOldestMessage(batch.values());

    if (!oldestMessage) {
      break;
    }

    before = oldestMessage.id;
  }

  return highestProcessedId;
}

/**
 * Retrieve all Azerite messages that are newer than the
 * last processed source message.
 *
 * When lastProcessedId is undefined, this retrieves all
 * available Azerite history.
 */
async function fetchUnprocessedAzeriteMessages(
  azeriteChannel: TextBasedChannel,
  lastProcessedId: string | undefined,
): Promise<Message[]> {
  const pendingMessages: Message[] = [];

  let before: string | undefined;
  let reachedCheckpoint = false;

  while (!reachedCheckpoint) {
    const batch =
      await azeriteChannel.messages.fetch({
        limit: 100,
        cache: false,
        ...(before ? { before } : {}),
      });

    if (batch.size === 0) {
      break;
    }

    for (const message of batch.values()) {
      if (
        lastProcessedId &&
        !isSnowflakeAfter(
          message.id,
          lastProcessedId,
        )
      ) {
        reachedCheckpoint = true;
        continue;
      }

      if (message.author.id === azeriteBotId) {
        pendingMessages.push(message);
      }
    }

    if (
      reachedCheckpoint ||
      batch.size < 100
    ) {
      break;
    }

    const oldestMessage =
      getOldestMessage(batch.values());

    if (!oldestMessage) {
      break;
    }

    before = oldestMessage.id;
  }

  pendingMessages.sort((first, second) => {
    const firstId = BigInt(first.id);
    const secondId = BigInt(second.id);

    if (firstId < secondId) {
      return -1;
    }

    if (firstId > secondId) {
      return 1;
    }

    return 0;
  });

  return pendingMessages;
}

/**
 * Return true only when Warcraft Logs supplied a usable
 * overall score and encounter rankings.
 */
function hasUsableWarcraftLogsPerformance(
  performance: WarcraftLogsPerformanceSummary,
): boolean {
  return (
    typeof performance.overall === "number" &&
    Number.isFinite(performance.overall) &&
    performance.bosses.length > 0
  );
}

/**
 * Parse, evaluate, and post one Azerite candidate.
 *
 * Returns true only when the candidate was processed and
 * posted successfully.
 */
async function inspectAzeriteMessage(
  message: Message,
): Promise<boolean> {
  if (message.author.id !== azeriteBotId) {
    return false;
  }

  const inspectionPayload =
    createInspectionPayload(message);

  console.log(
    "\n=== AZERITE CHANNEL MESSAGE ===",
  );

  console.log(
    JSON.stringify(
      inspectionPayload,
      null,
      2,
    ),
  );

  console.log("=== END MESSAGE ===\n");

  try {
    const candidate =
      parseAzeriteCandidate(message);

    let roleCorrectionMessage:
      | string
      | undefined;

    try {
      const reportedSpec =
        candidate.character.spec;

      const reportedRole =
        candidate.character.role;

      if (!reportedRole) {
        throw new Error(
          [
            "Azerite did not include the character role;",
            "the role-appropriate Warcraft Logs lookup was skipped.",
          ].join(" "),
        );
      }

      let performance =
        await getCharacterPerformanceSummary({
          characterName:
            candidate.character.name,

          realm:
            candidate.character.realm,

          region:
            candidate.character.region,

          specName:
            reportedSpec,

          role:
            reportedRole,
        });

      if (
        performance.metric === "dps" &&
        !hasUsableWarcraftLogsPerformance(
          performance,
        ) &&
        canClassHeal(
          candidate.character.className,
        )
      ) {
        const healingPerformance =
          await getCharacterPerformanceSummary({
            characterName:
              candidate.character.name,

            realm:
              candidate.character.realm,

            region:
              candidate.character.region,

            role:
              reportedRole,

            metricOverride:
              "hps",
          });

        if (
          hasUsableWarcraftLogsPerformance(
            healingPerformance,
          ) &&
          isHealingSpecialization(
            candidate.character.className,
            healingPerformance.inferredSpec,
          )
        ) {
          performance = healingPerformance;

          candidate.character.role =
            "HEALING";

          if (
            healingPerformance.inferredSpec
          ) {
            candidate.character.spec =
              healingPerformance.inferredSpec;
          }

          roleCorrectionMessage = [
            "Warcraft Logs indicates",
            candidate.character.spec ??
              "unknown-spec",
            "healing activity;",
            "Azerite reported",
            reportedSpec ?? "an unknown spec",
            `${reportedRole}.`,
          ].join(" ");

          console.log(
            [
              "Detected role mismatch for",
              `${candidate.character.name}:`,
              roleCorrectionMessage,
            ].join(" "),
          );
        }
      }

      candidate.warcraftLogs = {
        metric:
          performance.metric,

        overall:
          performance.overall,

        bestPerformanceAverage:
          performance.bestPerformanceAverage,

        medianPerformanceAverage:
          performance.medianPerformanceAverage,

        bosses:
          performance.bosses.map(
            (boss) => ({
              bossName:
                boss.bossName,

              percentile:
                boss.percentile,

              medianPercentile:
                boss.medianPercentile,

              totalKills:
                boss.totalKills,
            }),
          ),

        source:
          "warcraftlogs_api",
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : String(error);

      console.error(
        [
          "Could not retrieve role-appropriate",
          "Warcraft Logs data for",
          candidate.character.name,
          errorMessage,
        ].join(" "),
      );

      candidate.warcraftLogs = {
        bosses: [],
        source:
          "warcraftlogs_api",
        error:
          errorMessage,
      };
    }

    const contacts =
      parseCandidateContacts({
        azeriteAboutText:
          candidate.about,
      });

    const availability =
      getManualAvailability(candidate);

    const evaluation =
      evaluateCandidate(
        candidate,
        availability,
        recruitmentConfigStore
          .getConfig()
          .roster,
      );

    console.log(
      "\n=== CANDIDATE EVALUATION ===",
    );

    console.log(
      JSON.stringify(
        {
          candidate,
          contacts,
          roleCorrectionMessage,
          evaluation,
        },
        null,
        2,
      ),
    );

    console.log(
      "=== END CANDIDATE EVALUATION ===\n",
    );

    const statusEmoji: Record<
      CheckStatus,
      string
    > = {
      PASS: "✅",
      FAIL: "❌",
      MANUAL_REVIEW: "⚠️",
    };

  const outputDivider = "=========================================================================";

  const characterDetails = [
    candidate.character.spec,
    candidate.character.className,
  ].filter(
    (part): part is string => Boolean(part),
  ).join(" ");

  const candidateHeading = [
    `## [${candidate.character.name}](${candidate.source.messageUrl})`,
    characterDetails || undefined,
    candidate.character.role
      ? `(${candidate.character.role})`
      : undefined,
    `${candidate.character.realm} · ${candidate.character.region}`,
  ].filter(
    (part): part is string => Boolean(part),
  ).join(" · ");

if (
      evaluation.overallStatus === "FAIL"
    ) {
      const failedChecks =
        evaluation.checks.filter(
          (check) =>
            check.status === "FAIL",
        );

      const failureLines =
        failedChecks.map(
          (check) =>
            [
              "❌",
              `**${check.name}:**`,
              check.summary,
            ].join(" "),
        );

      await sendToOutputChannel(
        [
          outputDivider,
          candidateHeading,
          ...failureLines,
        ].join("\n"),
      );

      return true;
    }

    const checkLines =
      evaluation.checks.map(
        (check) =>
          [
            statusEmoji[check.status],
            `**${check.name}:**`,
            check.summary,
          ].join(" "),
      );

    const progressionSummary =
      Object.entries(
        candidate.raidProgression,
      )
        .map(
          ([raid, progress]) =>
            `${raid}: ${progress}`,
        )
        .join(", ") ||
      "Unknown";

    const overallPerformance =
      candidate.warcraftLogs.overall;

    const overallLogs =
      typeof overallPerformance === "number" &&
      Number.isFinite(overallPerformance)
        ? overallPerformance.toFixed(1)
        : "Unknown";

    const metricLabel =
      candidate.warcraftLogs.metric
        ?.toUpperCase() ??
      "UNKNOWN";

    const metricLines = [
      [
        `**Item Level:** ${candidate.scores.itemLevel ?? "Unknown"}`,
        `**M+ Score:** ${candidate.scores.mythicPlusScore ?? "Unknown"}`,
      ].join(" • "),

      [
        `**Progression:** ${progressionSummary}`,
        `**WCL Overall (${metricLabel}):** ${overallLogs}`,
      ].join(" • "),
    ];

  const sourceLinkParts: string[] = [];

  if (
    candidate.links
      .raiderIoRecruitment
  ) {
    sourceLinkParts.push(
      `[Recruitment schedule](${candidate.links.raiderIoRecruitment})`,
    );
  } else {
    sourceLinkParts.push(
      "Recruitment schedule unavailable",
    );
  }

  if (
    candidate.links.warcraftLogs
  ) {
    sourceLinkParts.push(
      `[Warcraft Logs](${candidate.links.warcraftLogs})`,
    );
  } else {
    sourceLinkParts.push(
      "Warcraft Logs unavailable",
    );
  }

  const sourceLinksLine =
    sourceLinkParts.join(" • ");

  const overallEmoji =
      statusEmoji[
        evaluation.overallStatus
      ];

    const contactLines: string[] = [];

    if (contacts.battleTag) {
      contactLines.push(
        `**BattleTag:** \`${contacts.battleTag.value}\``,
      );
    }

    if (contacts.discordUsername) {
      contactLines.push(
        `**Discord:** \`${contacts.discordUsername.value}\``,
      );
    }

    if (contacts.discordUserId) {
      contactLines.push(
        `**Discord user ID:** \`${contacts.discordUserId.value}\``,
      );
    }

    if (contactLines.length === 0) {
      contactLines.push(
        "**Contact information:** Not found",
      );
    }

    const roleCorrectionLines =
      roleCorrectionMessage
        ? [
            `⚠️ **Role correction:** ${roleCorrectionMessage}`,
            "",
          ]
        : [];

const candidateOutputContent = [
  outputDivider,
  candidateHeading,
  ...roleCorrectionLines,
  [
    overallEmoji,
    `**Overall: ${evaluation.overallStatus.replaceAll("_", " ")}**`,
  ].join(" "),
  "",
  ...checkLines,
  "",
  ...contactLines,
  "",
  ...metricLines,
  "",
  sourceLinksLine,
].join("\n");

const candidateOutputMessage =
  await sendToOutputChannel(
    candidateOutputContent,
  );

    const assignmentStatus =
      evaluation.overallStatus === "PASS"
        ? "PASS"
        : "MANUAL_REVIEW";

    try {
      const assignmentResult =
        await officerThreadManager.assignCandidate({
          candidateName:
            candidate.character.name,

          candidateRealm:
            candidate.character.realm,

          candidateStatus:
            assignmentStatus,

          candidateOutputMessage,
        });

      if (
        assignmentResult.outcome ===
        "DUPLICATE"
      ) {
        const originalAssignmentLink =
          assignmentResult
            .originalAssignmentMessageUrl
            ? [
                "[Open original assignment](",
                assignmentResult
                  .originalAssignmentMessageUrl,
                ")",
              ].join("")
            : undefined;
        const duplicateNote = [
          "**Duplicate entry:**",
          "The original entry was assigned to",
          `<@${assignmentResult.originalOfficerId}>.`,
          originalAssignmentLink,
        ]
          .filter(Boolean)
          .join(" ");

        await candidateOutputMessage.edit({
          content: [
            candidateOutputContent,
            "",
            duplicateNote,
          ].join("\n"),
          allowedMentions: {
            parse: [],
          },
        });
      }
    } catch (assignmentError) {
      try {
        await candidateOutputMessage.delete();
      } catch (deleteError) {
        console.error(
          "Could not remove the incomplete candidate output:",
          deleteError,
        );
      }

      throw assignmentError;
    }

    return true;
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : String(error);

    const errorStack =
      error instanceof Error
        ? error.stack
        : undefined;

    console.error(
      `Could not evaluate Azerite candidate from ${message.url}`,
    );

    console.error(errorMessage);

    if (errorStack) {
      console.error(errorStack);
    }

    try {
      await sendToOutputChannel(
        [
          "⚠️ **Could not evaluate Azerite candidate**",
          "",
          `[Open the source message](${message.url})`,
          "",
          `Error: \`${errorMessage.slice(0, 500)}\``,
        ].join("\n"),
      );
    } catch (outputError) {
      console.error(
        "Could not post the evaluation error:",
        outputError,
      );
    }

    return false;
  }
}

/**
 * Process one message while preventing duplicates during the
 * current bot session.
 */
async function processAzeriteMessage(
  message: Message,
): Promise<boolean> {
  if (processingHalted) {
    return false;
  }

  if (processedThisRun.has(message.id)) {
    return true;
  }

  const success =
    await inspectAzeriteMessage(message);

  if (!success) {
    processingHalted = true;

    console.error(
      [
        "Azerite processing has been halted.",
        `Source message: ${message.url}`,
        "Fix the error and restart the bot.",
      ].join("\n"),
    );

    return false;
  }

  processedThisRun.add(message.id);

  return true;
}

/**
 * Resume processing after the newest Azerite source message
 * represented in the output channel.
 *
 * If the output channel is empty, process all available
 * Azerite history.
 */
async function processAzeriteHistory(
  logWhenCurrent = true,
):
Promise<void> {
  const azeriteChannel =
    await client.channels.fetch(
      azeriteChannelId,
    );

  if (!azeriteChannel?.isTextBased()) {
    throw new Error(
      `Azerite channel ${azeriteChannelId} is not text-based.`,
    );
  }

  const outputChannel =
    await client.channels.fetch(
      outputChannelId,
    );

  if (!outputChannel?.isTextBased()) {
    throw new Error(
      `Output channel ${outputChannelId} is not text-based.`,
    );
  }

  const lastProcessedId =
    await findLastProcessedAzeriteMessageId(
      outputChannel,
    );

  const unprocessedMessages =
    await fetchUnprocessedAzeriteMessages(
      azeriteChannel,
      lastProcessedId,
    );

  const shouldLogSummary =
    logWhenCurrent ||
    unprocessedMessages.length > 0;

  if (shouldLogSummary) {
    if (lastProcessedId) {
      console.log(
        `Last processed Azerite message: ${lastProcessedId}`,
      );
    } else {
      console.log(
        [
          "No processed Azerite results were found",
          "in the output channel.",
          "Processing the full available history.",
        ].join(" "),
      );
    }

    console.log(
      [
        `Found ${unprocessedMessages.length}`,
        "unprocessed Azerite message(s).",
      ].join(" "),
    );
  }

  for (const message of unprocessedMessages) {
    const success =
      await processAzeriteMessage(message);

    if (!success) {
      return;
    }
  }

  while (
    pendingLiveMessages.size > 0 &&
    !processingHalted
  ) {
    const pendingBatch = [
      ...pendingLiveMessages.values(),
    ].sort((first, second) => {
      const firstId = BigInt(first.id);
      const secondId = BigInt(second.id);

      if (firstId < secondId) {
        return -1;
      }

      if (firstId > secondId) {
        return 1;
      }

      return 0;
    });

    pendingLiveMessages.clear();

    for (const message of pendingBatch) {
      const success =
        await processAzeriteMessage(
          message,
        );

      if (!success) {
        return;
      }
    }
  }

  if (shouldLogSummary) {
    console.log(
      "Azerite history catch-up complete.",
    );
  }
}

/**
 * Serialize reconnect/periodic history checks with live
 * candidate processing so the same message cannot be handled
 * concurrently by both paths.
 */
function queueAzeriteHistoryReconciliation(
  reason: string,
): void {
  if (
    !startupCatchUpComplete ||
    processingHalted
  ) {
    return;
  }

  liveProcessingQueue =
    liveProcessingQueue.then(
      async () => {
        if (processingHalted) {
          return;
        }

        try {
          await processAzeriteHistory(
            false,
          );
        } catch (error) {
          console.error(
            [
              "Could not reconcile Azerite history after",
              `${reason}:`,
            ].join(" "),
            error,
          );
        }
      },
    );
}

/**
 * Bot startup.
 *
 * No startup notification is posted to Discord.
 */
client.once(
  Events.ClientReady,
  async (readyClient) => {
    console.log(
      `Connected as ${readyClient.user.tag}`,
    );

    console.log(
      `Watching Azerite channel: ${azeriteChannelId}`,
    );

    console.log(
      `Output channel: ${outputChannelId}`,
    );

    try {
      const outputChannel =
        await readyClient.channels.fetch(
          outputChannelId,
        );

      if (
        !outputChannel ||
        !("guild" in outputChannel)
      ) {
        throw new Error(
          "The output channel is not attached to a Discord guild.",
        );
      }

      await registerRecruitmentConfigCommand(
        outputChannel.guild,
      );
    } catch (error) {
      console.error(
        "Could not register recruitment configuration commands:",
        error,
      );
    }

    try {
      await officerThreadManager.initialize();
      await processAzeriteHistory();
    } catch (error) {
      processingHalted = true;

      console.error(
        "Could not process Azerite history:",
        error,
      );
    } finally {
      startupCatchUpComplete = true;
    }
  },
);

/**
 * Process newly arriving Azerite messages.
 */
client.on(
  Events.MessageCreate,
  (message) => {
    if (
      message.channelId !== azeriteChannelId
    ) {
      return;
    }

    if (message.author.id !== azeriteBotId) {
      return;
    }

    if (!startupCatchUpComplete) {
      pendingLiveMessages.set(
        message.id,
        message,
      );

      return;
    }

    liveProcessingQueue =
      liveProcessingQueue
        .then(async () => {
          await processAzeriteMessage(
            message,
          );
        })
        .catch((error) => {
          processingHalted = true;

          console.error(
            "Live processing queue failed:",
            error,
          );
        });
  },
);

client.on(
  Events.Error,
  (error) => {
    console.error(
      "Discord client error:",
      error,
    );
  },
);

client.on(
  Events.ShardResume,
  (
    shardId,
    replayedEvents,
  ) => {
    console.log(
      [
        `Discord shard ${shardId} resumed.`,
        `Replayed ${replayedEvents} event(s).`,
      ].join(" "),
    );

    queueAzeriteHistoryReconciliation(
      "a Discord session resume",
    );
  },
);

client.on(
  Events.ShardReady,
  (shardId) => {
    if (!startupCatchUpComplete) {
      return;
    }

    console.log(
      `Discord shard ${shardId} reconnected with a new session.`,
    );

    queueAzeriteHistoryReconciliation(
      "a Discord session reconnect",
    );
  },
);

client.on(
  Events.InteractionCreate,
  async (interaction) => {
    const handledConfig =
      await handleRecruitmentConfigInteraction(
        interaction,
        recruitmentConfigStore,
        officerThreadManager,
      );

    if (handledConfig) {
      return;
    }

    await officerThreadManager
      .handleInteraction(
        interaction,
      );
  },
);

client.on(
  Events.MessageCreate,
  async (message) => {
    if (message.guildId !== null) {
      return;
    }

    try {
      await officerThreadManager
        .handleDirectMessage(
          message,
        );
    } catch (error) {
      console.error(
        "Could not process recruitment evidence DM:",
        error,
      );
    }
  },
);

  process.on(
  "unhandledRejection",
  (error) => {
    console.error(
      "Unhandled promise rejection:",
      error,
    );
  },
);

process.on(
  "uncaughtException",
  (error) => {
    console.error(
      "Uncaught exception:",
      error,
    );

    process.exitCode = 1;
  },
);

setInterval(
  () => {
    queueAzeriteHistoryReconciliation(
      "the periodic check",
    );
  },
  HISTORY_RECONCILIATION_INTERVAL_MS,
);

await client.login(discordToken);
