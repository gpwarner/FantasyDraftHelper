import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThreadAutoArchiveDuration,
  type Attachment,
  type ButtonInteraction,
  type Client,
  type Interaction,
  type Message,
  type ModalSubmitInteraction,
  type TextChannel,
  type ThreadChannel,
} from "discord.js";

import {
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";

import {
  dirname,
  resolve,
} from "node:path";

import {
  getDueRecruitmentReminder,
  type DueRecruitmentReminder,
  type RecruitmentReminderCase,
  type RecruitmentReminderStage,
} from "./recruitmentReminders.js";

type AssignmentStatus =
  | "PASS"
  | "MANUAL_REVIEW";

type RecruitmentCaseStatus =
  | "ASSIGNED"
  | "OUTREACH_PENDING"
  | "UNDER_REVIEW"
  | "CONTACTED"
  | "IN_DISCUSSION"
  | "JOINING"
  | "NOT_VIABLE";

interface RecruitmentCase
extends RecruitmentReminderCase {
  id: string;
  candidateName: string;
  candidateRealm?: string;
  candidateOutputMessageUrl: string;
  guildId?: string;

  assignedOfficerId: string;

  threadId: string;
  assignmentMessageId: string;
  assignmentMessageUrl?: string;

  reviewStartedBy?: string;

  evidenceRequestDmChannelId?: string;
  evidenceRequestMessageId?: string;

  contactedBy?: string;
  auditMessageUrl?: string;

  discussionStartedBy?: string;

  joiningAt?: string;
  joiningBy?: string;

  notViableAt?: string;
  notViableBy?: string;
  notViableReason?: string;

  reminderSentAt?: string;
  pendingReminderAudits?:
    RecruitmentReminderAuditEvent[];
  lastReminderAuditMessageUrl?: string;
}

interface RecruitmentReminderAuditEvent {
  stage: RecruitmentReminderStage;
  sentAt: string;
}

interface OfficerThreadState {
  nextOfficerIndex: number;

  /** Discord officer ID -> Discord thread ID */
  threadIdsByOfficer: Record<string, string>;

  /** Candidate output-message ID -> recruitment case */
  casesById: Record<string, RecruitmentCase>;
}

interface AssignCandidateOptions {
  candidateName: string;
  candidateRealm: string;
  candidateStatus: AssignmentStatus;
  candidateOutputMessage: Message;
}

export type CandidateAssignmentResult =
  | {
      outcome: "ASSIGNED";
    }
  | {
      outcome: "DUPLICATE";
      originalOfficerId: string;
      originalAssignmentMessageUrl?: string;
    };

const INTERACTION_PREFIX =
  "recruitment-case";

const REMINDER_POLL_INTERVAL_MILLISECONDS =
  60 * 1_000;

const defaultState: OfficerThreadState = {
  nextOfficerIndex: 0,
  threadIdsByOfficer: {},
  casesById: {},
};

function createCustomId(
  action: string,
  caseId: string,
): string {
  return [
    INTERACTION_PREFIX,
    action,
    caseId,
  ].join(":");
}

function parseCustomId(
  customId: string,
):
  | {
      action: string;
      caseId: string;
    }
  | undefined {
  const [
    prefix,
    action,
    caseId,
  ] = customId.split(":");

  if (
    prefix !== INTERACTION_PREFIX ||
    !action ||
    !caseId
  ) {
    return undefined;
  }

  return {
    action,
    caseId,
  };
}

function toDiscordTimestamp(
  isoDate: string,
): string {
  const timestamp = Math.floor(
    new Date(isoDate).getTime() /
      1000,
  );

  return `<t:${timestamp}:F>`;
}

function isUnknownDiscordMessageError(
  error: unknown,
): boolean {
  if (
    typeof error !== "object" ||
    error === null
  ) {
    return false;
  }

  const discordError = error as {
    code?: unknown;
    status?: unknown;
  };

  return (
    discordError.code === 10008 &&
    discordError.status === 404
  );
}

function normalizeApplicantIdentityPart(
  value: string,
): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(
      /[^\p{L}\p{N}]+/gu,
      "",
    );
}

function parseCandidateRealmFromOutput(
  message: Message,
): string | undefined {
  const headingLine =
    message.content
      .split(/\r?\n/)
      .find((line) =>
        line.startsWith("## ["),
      );

  if (!headingLine) {
    return undefined;
  }

  const headingParts =
    headingLine.split(" · ");

  if (headingParts.length < 5) {
    return undefined;
  }

  const realm =
    headingParts.at(-2)?.trim();

  return realm || undefined;
}

function isImageAttachment(
  contentType: string | null,
  filename: string,
): boolean {
  if (
    contentType?.startsWith(
      "image/",
    )
  ) {
    return true;
  }

  return /\.(?:png|jpe?g|webp|gif)$/i.test(
    filename,
  );
}

function sanitizeFilenamePart(
  value: string,
): string {
  return value
    .replace(
      /[^a-z0-9._-]+/gi,
      "-",
    )
    .replace(/-+/g, "-")
    .replace(
      /^[-.]+|[-.]+$/g,
      "",
    )
    .slice(0, 80);
}

export class OfficerThreadManager {
  private state: OfficerThreadState = {
    ...defaultState,
    threadIdsByOfficer: {},
    casesById: {},
  };

  private initialized = false;

  private reminderTimer:
    NodeJS.Timeout |
    undefined;

  private reminderSweepInProgress =
    false;

  private officerIds: string[];

  private readonly processingDmOfficerIds =
    new Set<string>();

  private readonly stateFilePath =
    resolve(
      process.cwd(),
      "data",
      "officer-thread-state.json",
    );

  public constructor(
    private readonly client: Client,
    private readonly outputChannelId: string,
    private readonly auditChannelId: string,
    officerIds: readonly string[],
  ) {
    if (officerIds.length === 0) {
      throw new Error(
        "At least one recruitment officer is required.",
      );
    }

    this.officerIds = [
      ...officerIds,
    ];
  }

  /**
   * Update the round-robin pool used for future assignments.
   * Existing cases remain owned by their currently assigned officer.
   */
  public async updateOfficerIds(
    officerIds: readonly string[],
  ): Promise<void> {
    const normalized = [
      ...new Set(officerIds),
    ];

    if (normalized.length === 0) {
      throw new Error(
        "At least one recruitment officer is required.",
      );
    }

    const previousOfficerIds =
      this.officerIds;
    const previousIndex =
      this.state.nextOfficerIndex;

    this.officerIds = normalized;
    this.state.nextOfficerIndex =
      this.state.nextOfficerIndex %
      this.officerIds.length;

    if (!this.initialized) {
      return;
    }

    try {
      await this.saveState();
    } catch (error) {
      this.officerIds =
        previousOfficerIds;
      this.state.nextOfficerIndex =
        previousIndex;

      throw error;
    }
  }

  public async initialize():
  Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.loadState();

    this.state.nextOfficerIndex =
      this.state.nextOfficerIndex %
      this.officerIds.length;

    await this.saveState();

    this.initialized = true;

    await this
      .refreshStoredCaseMessages();

    await this
      .backfillStoredCandidateRealms();

    console.log(
      [
        "Officer thread manager initialized.",
        "Next officer:",
        this.officerIds[
          this.state
            .nextOfficerIndex
        ],
      ].join(" "),
    );

    this.startReminderScheduler();
  }

  private startReminderScheduler(): void {
    if (this.reminderTimer) {
      return;
    }

    void this.processRecruitmentReminders();

    this.reminderTimer = setInterval(
      () => {
        void this.processRecruitmentReminders();
      },
      REMINDER_POLL_INTERVAL_MILLISECONDS,
    );

    this.reminderTimer.unref();
  }

  private async processRecruitmentReminders():
  Promise<void> {
    if (this.reminderSweepInProgress) {
      return;
    }

    this.reminderSweepInProgress = true;

    try {
      for (
        const recruitmentCase of
          Object.values(
            this.state.casesById,
          )
      ) {
        const pendingAudit =
          recruitmentCase
            .pendingReminderAudits?.[0];

        if (pendingAudit) {
          try {
            await this
              .sendRecruitmentReminderAudit(
                recruitmentCase,
                pendingAudit,
              );
          } catch (error) {
            console.warn(
              [
                "Could not audit recruitment reminder for",
                `${recruitmentCase.id}`,
                `(${recruitmentCase.candidateName}):`,
              ].join(" "),
              error,
            );
          }

          continue;
        }

        const reminder =
          getDueRecruitmentReminder(
            recruitmentCase,
          );

        if (!reminder) {
          continue;
        }

        try {
          await this.sendRecruitmentReminder(
            recruitmentCase,
            reminder,
          );
        } catch (error) {
          console.warn(
            [
              "Could not send recruitment reminder for",
              `${recruitmentCase.id}`,
              `(${recruitmentCase.candidateName}):`,
            ].join(" "),
            error,
          );
        }
      }
    } finally {
      this.reminderSweepInProgress = false;
    }
  }

  private async sendRecruitmentReminder(
    recruitmentCase: RecruitmentCase,
    reminder: DueRecruitmentReminder,
  ): Promise<void> {
    const officer =
      await this.client.users.fetch(
        recruitmentCase
          .assignedOfficerId,
      );

    const assignmentUrl =
      this.getRecruitmentCaseAssignmentUrl(
        recruitmentCase,
      );

    await officer.send({
      content: [
        "## Recruitment reminder",
        "",
        [
          "Candidate:",
          `[${recruitmentCase.candidateName}](${recruitmentCase.candidateOutputMessageUrl})`,
        ].join(" "),
        "",
        [
          "No workflow action has been recorded for",
          `${reminder.inactivityLabel}.`,
        ].join(" "),
        reminder.actionText,
        "",
        `[Open the officer assignment](${assignmentUrl})`,
      ].join("\n"),

      allowedMentions: {
        parse: [],
      },
    });

    const previousReminderStage =
      recruitmentCase.reminderStage;
    const previousReminderSentAt =
      recruitmentCase.reminderSentAt;
    const previousPendingAudits = [
      ...(recruitmentCase
        .pendingReminderAudits ?? []),
    ];

    const reminderSentAt =
      new Date().toISOString();

    recruitmentCase.reminderStage =
      reminder.stage;
    recruitmentCase.reminderSentAt =
      reminderSentAt;
    recruitmentCase.pendingReminderAudits = [
      ...previousPendingAudits,
      {
        stage: reminder.stage,
        sentAt: reminderSentAt,
      },
    ];

    try {
      await this.saveState();
    } catch (error) {
      if (previousReminderStage) {
        recruitmentCase.reminderStage =
          previousReminderStage;
      } else {
        delete recruitmentCase.reminderStage;
      }

      if (previousReminderSentAt) {
        recruitmentCase.reminderSentAt =
          previousReminderSentAt;
      } else {
        delete recruitmentCase.reminderSentAt;
      }

      if (previousPendingAudits.length > 0) {
        recruitmentCase.pendingReminderAudits =
          previousPendingAudits;
      } else {
        delete recruitmentCase
          .pendingReminderAudits;
      }

      throw error;
    }

    console.log(
      [
        "Sent recruitment reminder for",
        `${recruitmentCase.candidateName}`,
        `(${reminder.stage}) to`,
        `${recruitmentCase.assignedOfficerId}.`,
      ].join(" "),
    );

    try {
      await this.sendRecruitmentReminderAudit(
        recruitmentCase,
        {
          stage: reminder.stage,
          sentAt: reminderSentAt,
        },
      );
    } catch (error) {
      console.warn(
        [
          "The recruitment reminder was sent, but its audit entry could not be posted for",
          `${recruitmentCase.id}`,
          `(${recruitmentCase.candidateName}):`,
        ].join(" "),
        error,
      );
    }
  }

  private async sendRecruitmentReminderAudit(
    recruitmentCase: RecruitmentCase,
    auditEvent: RecruitmentReminderAuditEvent,
  ): Promise<void> {
    const auditChannel =
      await this.getAuditChannel();

    const assignmentUrl =
      this.getRecruitmentCaseAssignmentUrl(
        recruitmentCase,
      );

    const auditMessage =
      await auditChannel.send({
        content: [
          "## Recruitment reminder sent",
          "",
          [
            "**Candidate:**",
            `[${recruitmentCase.candidateName}](${recruitmentCase.candidateOutputMessageUrl})`,
          ].join(" "),
          [
            "**Recruiter:**",
            `<@${recruitmentCase.assignedOfficerId}>`,
          ].join(" "),
          [
            "**Workflow stage:**",
            this.formatReminderStage(
              auditEvent.stage,
            ),
          ].join(" "),
          [
            "**Inactive for:**",
            this.formatReminderInactivity(
              auditEvent.stage,
            ),
          ].join(" "),
          [
            "**Reminder sent:**",
            toDiscordTimestamp(
              auditEvent.sentAt,
            ),
          ].join(" "),
          [
            "**Officer assignment:**",
            `[View assignment](${assignmentUrl})`,
          ].join(" "),
        ].join("\n"),

        allowedMentions: {
          parse: [],
        },
      });

    const pendingAudits =
      recruitmentCase.pendingReminderAudits ??
      [];

    const auditIndex =
      pendingAudits.findIndex(
        (pendingAudit) =>
          pendingAudit.stage ===
            auditEvent.stage &&
          pendingAudit.sentAt ===
            auditEvent.sentAt,
      );

    if (auditIndex !== -1) {
      pendingAudits.splice(
        auditIndex,
        1,
      );
    }

    if (pendingAudits.length === 0) {
      delete recruitmentCase
        .pendingReminderAudits;
    }

    recruitmentCase
      .lastReminderAuditMessageUrl =
      auditMessage.url;

    await this.saveState();

    console.log(
      [
        "Posted recruitment reminder audit for",
        `${recruitmentCase.candidateName}.`,
      ].join(" "),
    );
  }

  private getRecruitmentCaseAssignmentUrl(
    recruitmentCase: RecruitmentCase,
  ): string {
    return (
      recruitmentCase.assignmentMessageUrl ??
      (recruitmentCase.guildId
        ? [
            "https://discord.com/channels",
            recruitmentCase.guildId,
            recruitmentCase.threadId,
            recruitmentCase.assignmentMessageId,
          ].join("/")
        : recruitmentCase
            .candidateOutputMessageUrl)
    );
  }

  private formatReminderStage(
    stage: NonNullable<
      RecruitmentCase["reminderStage"]
    >,
  ): string {
    switch (stage) {
      case "ASSIGNED":
        return "Assigned";

      case "UNDER_REVIEW":
        return "Under Review";

      case "CONTACT_EVIDENCE_PENDING":
        return "Contact Evidence Pending";

      case "CONTACTED":
        return "Contacted";

      case "IN_DISCUSSION":
        return "In Discussion";
    }
  }

  private formatReminderInactivity(
    stage: NonNullable<
      RecruitmentCase["reminderStage"]
    >,
  ): string {
    switch (stage) {
      case "ASSIGNED":
        return "12 hours";

      case "UNDER_REVIEW":
        return "6 hours";

      case "CONTACT_EVIDENCE_PENDING":
      case "CONTACTED":
      case "IN_DISCUSSION":
        return "3 days";
    }
  }

  private recordRecruiterAction(
    recruitmentCase: RecruitmentCase,
    timestamp = new Date().toISOString(),
  ): void {
    recruitmentCase.lastActionAt =
      timestamp;

    delete recruitmentCase.reminderStage;
    delete recruitmentCase.reminderSentAt;
  }

/**
 * Handle recruitment workflow button and modal interactions.
 * Returns true when the interaction belongs to this manager.
 */
public async handleInteraction(
  interaction: Interaction,
): Promise<boolean> {
  if (
    !interaction.isButton() &&
    !interaction.isModalSubmit()
  ) {
    return false;
  }

  const customId =
    interaction.customId;

  if (
    !customId.startsWith(
      `${INTERACTION_PREFIX}:`,
    )
  ) {
    return false;
  }

  try {
    await this.initialize();

    const parsed =
      parseCustomId(customId);

    if (!parsed) {
      await this.replyEphemeral(
        interaction,
        "This recruitment action is invalid.",
      );

      return true;
    }

    if (interaction.isModalSubmit()) {
      if (parsed.action === "not-a-fit-reason") {
        await this.handleNotAFitReason(
          interaction,
          parsed.caseId,
        );

        return true;
      }

      await this.replyEphemeral(
        interaction,
        "This recruitment form is no longer supported.",
      );

      return true;
    }

    const buttonInteraction:
      ButtonInteraction =
      interaction;

    switch (parsed.action) {
      case "start":
        await this.handleStartReview(
          buttonInteraction,
          parsed.caseId,
        );

        return true;

      case "contact":
        await this.handleContactButton(
          buttonInteraction,
          parsed.caseId,
        );

        return true;

      case "not-a-fit":
        await this.handleNotAFitButton(
          buttonInteraction,
          parsed.caseId,
        );

        return true;

      case "joining":
        await this.handleJoining(
          buttonInteraction,
          parsed.caseId,
        );

        return true;

      case "in-discussion":
        await this.handleInDiscussion(
          buttonInteraction,
          parsed.caseId,
        );

        return true;

      default:
        await this.replyEphemeral(
          interaction,
          "This recruitment action is no longer supported.",
        );

        return true;
    }
  } catch (error) {
    console.error(
      "Recruitment workflow interaction failed:",
      error,
    );

    await this
      .replyEphemeral(
        interaction,
        [
          "The recruitment action could not be completed.",
          "Nothing has been intentionally advanced.",
          "Please try again or contact the bot administrator.",
        ].join(" "),
      )
      .catch((replyError) => {
        console.error(
          "Could not send interaction error response:",
          replyError,
        );
      });

    return true;
  }
}

  /**
   * Process screenshot evidence pasted into a recruiter DM.
   * Returns true when the message belongs to a pending case.
   */
  public async handleDirectMessage(
    message: Message,
  ): Promise<boolean> {
    if (
      message.author.bot ||
      message.guildId !== null
    ) {
      return false;
    }

    await this.initialize();

    const recruitmentCase =
      this.findPendingEvidenceCase(
        message.author.id,
      );

    if (!recruitmentCase) {
      return false;
    }

    if (
      this.processingDmOfficerIds.has(
        message.author.id,
      )
    ) {
      await message.reply(
        "I am already processing your previous evidence message. Please wait a moment.",
      );

      return true;
    }

    this.processingDmOfficerIds.add(
      message.author.id,
    );

    try {
      const normalizedContent =
        message.content
          .trim()
          .toLowerCase();

      if (normalizedContent === "cancel") {
        await this.cancelEvidenceRequest(
          recruitmentCase,
        );

        await message.reply(
          [
            `The evidence request for **${recruitmentCase.candidateName}** was canceled.`,
            "The candidate remains **Under Review**.",
          ].join(" "),
        );

        return true;
      }

      const imageAttachments =
        message.attachments.filter(
          (attachment) =>
            isImageAttachment(
              attachment.contentType,
              attachment.name,
            ),
        );

      if (imageAttachments.size === 0) {
        await message.reply(
          [
            `I am waiting for contact evidence for **${recruitmentCase.candidateName}**.`,
            "Paste one screenshot into this DM and send it.",
            "Type `cancel` to stop this evidence request.",
          ].join(" "),
        );

        return true;
      }

      if (imageAttachments.size > 1) {
        await message.reply(
          "Please send exactly one screenshot for this candidate.",
        );

        return true;
      }

      const screenshot =
        imageAttachments.first();

      if (!screenshot) {
        return true;
      }

      await this.recordContactEvidence(
        recruitmentCase,
        message,
        screenshot,
      );

      return true;
    } catch (error) {
      console.error(
        "Could not process DM contact evidence:",
        error,
      );

      await message.reply(
        [
          "I could not save that screenshot.",
          "The candidate is still awaiting evidence, so please try again.",
        ].join(" "),
      );

      return true;
    } finally {
      this.processingDmOfficerIds.delete(
        message.author.id,
      );
    }
  }

  public async assignCandidate(
    options: AssignCandidateOptions,
  ): Promise<CandidateAssignmentResult> {
    await this.initialize();

    const existingDuplicate =
      this.findExistingDuplicate(
        options,
      );

    if (existingDuplicate) {
      console.log(
        [
          "Skipped duplicate officer assignment for",
          `${options.candidateName}-${options.candidateRealm}.`,
          "The applicant already has officer case",
          `${existingDuplicate.id}`,
          `(${this.formatStatus(existingDuplicate.status)}).`,
        ].join(" "),
      );

      const originalAssignmentMessageUrl =
        existingDuplicate
          .assignmentMessageUrl ??
        (existingDuplicate.guildId
          ? [
              "https://discord.com/channels",
              existingDuplicate.guildId,
              existingDuplicate.threadId,
              existingDuplicate
                .assignmentMessageId,
            ].join("/")
          : undefined);

      return {
        outcome: "DUPLICATE",
        originalOfficerId:
          existingDuplicate
            .assignedOfficerId,
        ...(originalAssignmentMessageUrl
          ? {
              originalAssignmentMessageUrl,
            }
          : {}),
      };
    }

    const officerId =
      this.officerIds[
        this.state
          .nextOfficerIndex
      ];

    if (!officerId) {
      throw new Error(
        "No recruitment officer is available for assignment.",
      );
    }

    const thread =
      await this
        .getOrCreateOfficerThread(
          officerId,
        );

    try {
      await thread.members.add(
        officerId,
      );
    } catch (error) {
      console.warn(
        [
          "Could not explicitly add officer",
          `${officerId} to thread`,
          `${thread.id}.`,
          "The officer mention will still be sent.",
        ].join(" "),
        error,
      );
    }

    if (
      options.candidateStatus ===
      "PASS"
    ) {
      await this
        .sendPassWorkflowAssignment(
          thread,
          officerId,
          options,
        );

      return {
        outcome: "ASSIGNED",
      };
    }

    await this
      .sendManualReviewAssignment(
        thread,
        officerId,
        options,
      );

    return {
      outcome: "ASSIGNED",
    };
  }

  private findExistingDuplicate(
    options: AssignCandidateOptions,
  ): RecruitmentCase | undefined {
    const candidateName =
      normalizeApplicantIdentityPart(
        options.candidateName,
      );
    const candidateRealm =
      normalizeApplicantIdentityPart(
        options.candidateRealm,
      );

    return Object.values(
      this.state.casesById,
    )
      .filter((recruitmentCase) => {
        if (
          recruitmentCase.id ===
            options.candidateOutputMessage.id ||
          !recruitmentCase
            .candidateRealm
        ) {
          return false;
        }

        return (
          normalizeApplicantIdentityPart(
            recruitmentCase.candidateName,
          ) === candidateName &&
          normalizeApplicantIdentityPart(
            recruitmentCase
              .candidateRealm,
          ) === candidateRealm
        );
      })
      .sort(
        (left, right) =>
          left.assignedAt.localeCompare(
            right.assignedAt,
          ),
      )[0];
  }

  private async sendPassWorkflowAssignment(
    thread: ThreadChannel,
    officerId: string,
    options: AssignCandidateOptions,
  ): Promise<void> {
    const caseId =
      options.candidateOutputMessage.id;

    const assignedAt =
      new Date().toISOString();

    const recruitmentCase:
    RecruitmentCase = {
      id: caseId,
      candidateName:
        options.candidateName,
      candidateRealm:
        options.candidateRealm,
      candidateStatus: "PASS",
      candidateOutputMessageUrl:
        options.candidateOutputMessage.url,
      ...(options.candidateOutputMessage.guildId
        ? {
            guildId:
              options.candidateOutputMessage.guildId,
          }
        : {}),
      assignedOfficerId: officerId,
      assignedAt,
      lastActionAt: assignedAt,
      threadId: thread.id,
      assignmentMessageId: "",
      status: "OUTREACH_PENDING",
    };

    const rendered =
      this.renderManualReviewCase(
        recruitmentCase,
      );

    const assignmentMessage =
      await thread.send({
        content: rendered.content,
        components:
          rendered.components,
        allowedMentions: {
          parse: [],
          users: [officerId],
        },
      });

    recruitmentCase.assignmentMessageId =
      assignmentMessage.id;
    recruitmentCase.assignmentMessageUrl =
      assignmentMessage.url;

    const previousIndex =
      this.state.nextOfficerIndex;

    this.state.casesById[caseId] =
      recruitmentCase;
    this.advanceOfficer();

    try {
      await this.saveState();
    } catch (error) {
      delete this.state.casesById[caseId];
      this.state.nextOfficerIndex =
        previousIndex;

      await assignmentMessage.delete()
        .catch((deleteError) => {
          console.error(
            "Could not remove the untracked PASS workflow assignment:",
            deleteError,
          );
        });

      throw error;
    }
  }

  private async sendPassAssignment(
    thread: ThreadChannel,
    officerId: string,
    options: AssignCandidateOptions,
  ): Promise<void> {
    const candidateLink =
      `[${options.candidateName}](${options.candidateOutputMessage.url})`;

    const assignmentMessage =
      await thread.send({
        content: [
          `📣 <@${officerId}>`,
          "",
          "**PASS candidate**",
          "",
          [
            candidateLink,
            "matches all of our configured",
            "recruitment criteria and should be contacted.",
          ].join(" "),
          "",
          [
            "Once you have reached out to the candidate,",
            "react to this post with 👍.",
          ].join(" "),
        ].join("\n"),

        allowedMentions: {
          parse: [],
          users: [officerId],
        },
      });

    try {
      await assignmentMessage.react(
        "👍",
      );
    } catch (error) {
      console.warn(
        [
          "Could not add the completion reaction to",
          `PASS assignment ${assignmentMessage.id}.`,
        ].join(" "),
        error,
      );
    }
  }

  private async sendManualReviewAssignment(
    thread: ThreadChannel,
    officerId: string,
    options: AssignCandidateOptions,
  ): Promise<void> {
    const caseId =
      options
        .candidateOutputMessage.id;

    const assignedAt =
      new Date().toISOString();

    const recruitmentCase:
    RecruitmentCase = {
      id: caseId,
      candidateName:
        options.candidateName,
      candidateRealm:
        options.candidateRealm,
      candidateStatus:
        "MANUAL_REVIEW",
      candidateOutputMessageUrl:
        options
          .candidateOutputMessage.url,
      ...(options
        .candidateOutputMessage
        .guildId
        ? {
            guildId:
              options
                .candidateOutputMessage
                .guildId,
          }
        : {}),
      assignedOfficerId:
        officerId,
      assignedAt,
      lastActionAt: assignedAt,
      threadId:
        thread.id,
      assignmentMessageId:
        "",
      status:
        "ASSIGNED",
    };

    const rendered =
      this.renderManualReviewCase(
        recruitmentCase,
      );

    const assignmentMessage =
      await thread.send({
        content:
          rendered.content,
        components:
          rendered.components,
        allowedMentions: {
          parse: [],
          users: [officerId],
        },
      });

    recruitmentCase
      .assignmentMessageId =
      assignmentMessage.id;

    recruitmentCase
      .assignmentMessageUrl =
      assignmentMessage.url;

    const previousIndex =
      this.state
        .nextOfficerIndex;

    this.state.casesById[
      caseId
    ] = recruitmentCase;

    this.advanceOfficer();

    try {
      await this.saveState();
    } catch (error) {
      delete this.state.casesById[
        caseId
      ];

      this.state.nextOfficerIndex =
        previousIndex;

      try {
        await assignmentMessage
          .delete();
      } catch (deleteError) {
        console.error(
          "Could not remove the untracked workflow assignment:",
          deleteError,
        );
      }

      throw error;
    }
  }

  private async handleStartReview(
    interaction: ButtonInteraction,
    caseId: string,
  ): Promise<void> {
    const recruitmentCase =
      await this.getAuthorizedCase(
        interaction,
        caseId,
        "ASSIGNED",
      );

    if (!recruitmentCase) {
      return;
    }

    await interaction.deferUpdate();

    const previousCase = {
      ...recruitmentCase,
    };

    const actionAt =
      new Date().toISOString();

    recruitmentCase.status =
      "UNDER_REVIEW";
    recruitmentCase
      .reviewStartedAt =
      actionAt;
    recruitmentCase
      .reviewStartedBy =
      interaction.user.id;

    this.recordRecruiterAction(
      recruitmentCase,
      actionAt,
    );

    try {
      await this.saveState();

      const rendered =
        this.renderManualReviewCase(
          recruitmentCase,
        );

      await interaction.editReply({
        content:
          rendered.content,
        components:
          rendered.components,
        allowedMentions: {
          parse: [],
        },
      });
    } catch (error) {
      this.state.casesById[
        caseId
      ] = previousCase;

      await this.saveState()
        .catch((rollbackError) => {
          console.error(
            "Could not roll back review state:",
            rollbackError,
          );
        });

      throw error;
    }
  }

  private async handleContactButton(
    interaction: ButtonInteraction,
    caseId: string,
  ): Promise<void> {
    const recruitmentCase =
      await this.getAuthorizedCase(
        interaction,
        caseId,
        [
          "OUTREACH_PENDING",
          "UNDER_REVIEW",
        ],
      );

    if (!recruitmentCase) {
      return;
    }

    if (
      recruitmentCase
        .evidenceRequestedAt
    ) {
      await this.replyEphemeral(
        interaction,
        [
          "I am already waiting for a screenshot for",
          `**${recruitmentCase.candidateName}** in your DMs.`,
        ].join(" "),
      );

      return;
    }

    const otherPendingCase =
      this.findPendingEvidenceCase(
        interaction.user.id,
      );

    if (
      otherPendingCase &&
      otherPendingCase.id !==
        recruitmentCase.id
    ) {
      await this.replyEphemeral(
        interaction,
        [
          "Please finish the pending screenshot request for",
          `**${otherPendingCase.candidateName}** before starting another one.`,
        ].join(" "),
      );

      return;
    }

    await interaction.deferReply({
      flags:
        MessageFlags.Ephemeral,
    });

    const officer =
      await this.client.users.fetch(
        interaction.user.id,
      );

    let dmMessage: Message;

    try {
      dmMessage =
        await officer.send({
          content: [
            "## Contact evidence requested",
            "",
            [
              "Candidate:",
              `[${recruitmentCase.candidateName}](${recruitmentCase.candidateOutputMessageUrl})`,
            ].join(" "),
            "",
            [
              "Paste one cropped screenshot of your initial outreach",
              "into this DM with **Ctrl+V**, then send the message.",
            ].join(" "),
            "",
            [
              "Please hide unrelated private messages or personal information.",
              "Type `cancel` to stop this evidence request.",
            ].join(" "),
          ].join("\n"),

          allowedMentions: {
            parse: [],
          },
        });
    } catch (error) {
      console.warn(
        [
          "Could not DM recruitment officer",
          interaction.user.id + ".",
        ].join(" "),
        error,
      );

      await interaction.editReply({
        content: [
          "I could not send you a DM.",
          "Enable direct messages from members of this server and click **Mark Contacted** again.",
        ].join(" "),
      });

      return;
    }

    const previousCase = {
      ...recruitmentCase,
    };

    const actionAt =
      new Date().toISOString();

    recruitmentCase
      .evidenceRequestedAt =
      actionAt;

    recruitmentCase
      .evidenceRequestDmChannelId =
      dmMessage.channelId;

    recruitmentCase
      .evidenceRequestMessageId =
      dmMessage.id;

    this.recordRecruiterAction(
      recruitmentCase,
      actionAt,
    );

    try {
      await this.saveState();

      await this
        .updateCaseAssignmentMessage(
          recruitmentCase,
        );
    } catch (error) {
      this.state.casesById[
        caseId
      ] = previousCase;

      await this.saveState()
        .catch((rollbackError) => {
          console.error(
            "Could not roll back the DM evidence request:",
            rollbackError,
          );
        });

      await dmMessage.delete()
        .catch(() => undefined);

      throw error;
    }

    await interaction.editReply({
      content: [
        `I sent you a DM for **${recruitmentCase.candidateName}**.`,
        "Paste the screenshot there with **Ctrl+V** and send it.",
      ].join(" "),
    });
  }

  private async handleNotAFitButton(
    interaction: ButtonInteraction,
    caseId: string,
  ): Promise<void> {
    const recruitmentCase =
      await this.getAuthorizedCase(
        interaction,
        caseId,
        [
          "OUTREACH_PENDING",
          "UNDER_REVIEW",
          "CONTACTED",
          "IN_DISCUSSION",
        ],
      );

    if (!recruitmentCase) {
      return;
    }

    if (
      recruitmentCase
        .evidenceRequestedAt
    ) {
      await this.replyEphemeral(
        interaction,
        [
          "A contact-evidence request is already pending in your DMs.",
          "Type `cancel` there before marking this candidate Not a Fit.",
        ].join(" "),
      );

      return;
    }

    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(
          createCustomId(
            "not-a-fit-reason",
            recruitmentCase.id,
          ),
        )
        .setTitle("Why is this candidate not a fit?")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>()
            .addComponents(
              new TextInputBuilder()
                .setCustomId("reason")
                .setLabel("Reason")
                .setStyle(TextInputStyle.Paragraph)
                .setPlaceholder(
                  "Explain why the candidate is not joining us.",
                )
                .setMinLength(1)
                .setMaxLength(1000)
                .setRequired(true),
            ),
        ),
    );
  }

  private async handleNotAFitReason(
    interaction: ModalSubmitInteraction,
    caseId: string,
  ): Promise<void> {
    const recruitmentCase =
      await this.getAuthorizedCase(
        interaction,
        caseId,
        [
          "OUTREACH_PENDING",
          "UNDER_REVIEW",
          "CONTACTED",
          "IN_DISCUSSION",
        ],
      );

    if (!recruitmentCase) {
      return;
    }

    if (!interaction.isFromMessage()) {
      await this.replyEphemeral(
        interaction,
        "This form is not attached to the stored recruitment assignment.",
      );

      return;
    }

    const reason =
      interaction.fields
        .getTextInputValue("reason")
        .trim();

    if (!reason) {
      await this.replyEphemeral(
        interaction,
        "Please provide a reason why this candidate is not a fit.",
      );

      return;
    }

    await interaction.deferUpdate();

    const previousCase = {
      ...recruitmentCase,
    };

    const actionAt =
      new Date().toISOString();

    recruitmentCase.status =
      "NOT_VIABLE";
    recruitmentCase
      .notViableAt =
      actionAt;
    recruitmentCase
      .notViableBy =
      interaction.user.id;
    recruitmentCase
      .notViableReason =
      reason;

    this.recordRecruiterAction(
      recruitmentCase,
      actionAt,
    );

    try {
      await this.saveState();

      const rendered =
        this.renderManualReviewCase(
          recruitmentCase,
        );

      await interaction.editReply({
        content:
          rendered.content,
        components:
          rendered.components,
        allowedMentions: {
          parse: [],
        },
      });
    } catch (error) {
      this.state.casesById[
        caseId
      ] = previousCase;

      await this.saveState()
        .catch((rollbackError) => {
          console.error(
            "Could not roll back not-a-fit state:",
            rollbackError,
          );
        });

      throw error;
    }
  }

  private async handleInDiscussion(
    interaction: ButtonInteraction,
    caseId: string,
  ): Promise<void> {
    const recruitmentCase =
      await this.getAuthorizedCase(
        interaction,
        caseId,
        "CONTACTED",
      );

    if (!recruitmentCase) {
      return;
    }

    await interaction.deferUpdate();

    const previousCase = {
      ...recruitmentCase,
    };

    const actionAt =
      new Date().toISOString();

    recruitmentCase.status =
      "IN_DISCUSSION";
    recruitmentCase
      .discussionStartedAt =
      actionAt;
    recruitmentCase
      .discussionStartedBy =
      interaction.user.id;

    this.recordRecruiterAction(
      recruitmentCase,
      actionAt,
    );

    try {
      await this.saveState();

      const rendered =
        this.renderManualReviewCase(
          recruitmentCase,
        );

      await interaction.editReply({
        content:
          rendered.content,
        components:
          rendered.components,
        allowedMentions: {
          parse: [],
        },
      });
    } catch (error) {
      this.state.casesById[
        caseId
      ] = previousCase;

      await this.saveState()
        .catch((rollbackError) => {
          console.error(
            "Could not roll back in-discussion state:",
            rollbackError,
          );
        });

      throw error;
    }
  }

  private async handleJoining(
    interaction: ButtonInteraction,
    caseId: string,
  ): Promise<void> {
    const recruitmentCase =
      await this.getAuthorizedCase(
        interaction,
        caseId,
        "IN_DISCUSSION",
      );

    if (!recruitmentCase) {
      return;
    }

    await interaction.deferUpdate();

    const previousCase = {
      ...recruitmentCase,
    };

    const actionAt =
      new Date().toISOString();

    recruitmentCase.status =
      "JOINING";
    recruitmentCase.joiningAt =
      actionAt;
    recruitmentCase.joiningBy =
      interaction.user.id;

    this.recordRecruiterAction(
      recruitmentCase,
      actionAt,
    );

    try {
      await this.saveState();

      const rendered =
        this.renderManualReviewCase(
          recruitmentCase,
        );

      await interaction.editReply({
        content: rendered.content,
        components:
          rendered.components,
        allowedMentions: {
          parse: [],
        },
      });
    } catch (error) {
      this.state.casesById[
        caseId
      ] = previousCase;

      await this.saveState()
        .catch((rollbackError) => {
          console.error(
            "Could not roll back joining state:",
            rollbackError,
          );
        });

      throw error;
    }
  }

  private findPendingEvidenceCase(
    officerId: string,
  ): RecruitmentCase | undefined {
    return Object.values(
      this.state.casesById,
    ).find(
      (recruitmentCase) =>
        recruitmentCase
          .assignedOfficerId ===
          officerId &&
        (
          recruitmentCase.status ===
            "OUTREACH_PENDING" ||
          recruitmentCase.status ===
            "UNDER_REVIEW"
        ) &&
        Boolean(
          recruitmentCase
            .evidenceRequestedAt,
        ),
    );
  }

  private async cancelEvidenceRequest(
    recruitmentCase: RecruitmentCase,
  ): Promise<void> {
    const previousCase = {
      ...recruitmentCase,
    };

    delete recruitmentCase
      .evidenceRequestedAt;
    delete recruitmentCase
      .evidenceRequestDmChannelId;
    delete recruitmentCase
      .evidenceRequestMessageId;

    this.recordRecruiterAction(
      recruitmentCase,
    );

    try {
      await this.saveState();
      await this.updateCaseAssignmentMessage(
        recruitmentCase,
      );
    } catch (error) {
      this.state.casesById[
        recruitmentCase.id
      ] = previousCase;

      await this.saveState()
        .catch((rollbackError) => {
          console.error(
            "Could not roll back the canceled evidence request:",
            rollbackError,
          );
        });

      throw error;
    }
  }

  private async recordContactEvidence(
    recruitmentCase: RecruitmentCase,
    directMessage: Message,
    screenshot: Attachment,
  ): Promise<void> {
    const screenshotResponse =
      await fetch(
        screenshot.url,
      );

    if (!screenshotResponse.ok) {
      throw new Error(
        [
          "Discord returned",
          `${screenshotResponse.status}`,
          "while retrieving the pasted screenshot.",
        ].join(" "),
      );
    }

    const screenshotBuffer =
      Buffer.from(
        await screenshotResponse
          .arrayBuffer(),
      );

    const auditChannel =
      await this.getAuditChannel();

    const submittedAt =
      new Date().toISOString();

    const assignmentUrl =
      recruitmentCase
        .assignmentMessageUrl ??
      (recruitmentCase.guildId
        ? [
            "https://discord.com/channels",
            recruitmentCase.guildId,
            recruitmentCase.threadId,
            recruitmentCase
              .assignmentMessageId,
          ].join("/")
        : recruitmentCase
            .candidateOutputMessageUrl);

    const candidateFilename =
      sanitizeFilenamePart(
        recruitmentCase
          .candidateName,
      ) || "candidate";

    const screenshotName =
      screenshot.name;

    const originalFilename =
      sanitizeFilenamePart(
        screenshotName,
      ) || "screenshot.png";

    const auditMessage =
      await auditChannel.send({
        content: [
          "## Contact evidence",
          "",
          [
            "**Candidate:**",
            `[${recruitmentCase.candidateName}](${recruitmentCase.candidateOutputMessageUrl})`,
          ].join(" "),
          [
            "**Recruiter:**",
            `<@${directMessage.author.id}>`,
          ].join(" "),
          [
            "**Submitted:**",
            toDiscordTimestamp(
              submittedAt,
            ),
          ].join(" "),
          [
            "**Officer assignment:**",
            `[View assignment](${assignmentUrl})`,
          ].join(" "),
          "**Status recorded:** Contacted",
        ].join("\n"),

        files: [
          {
            attachment:
              screenshotBuffer,
            name: [
              "contact",
              candidateFilename,
              originalFilename,
            ].join("-"),
          },
        ],

        allowedMentions: {
          parse: [],
        },
      });

    const previousCase = {
      ...recruitmentCase,
    };

    recruitmentCase.status =
      "CONTACTED";
    recruitmentCase.contactedAt =
      submittedAt;
    recruitmentCase.contactedBy =
      directMessage.author.id;
    recruitmentCase.auditMessageUrl =
      auditMessage.url;

    this.recordRecruiterAction(
      recruitmentCase,
      submittedAt,
    );

    delete recruitmentCase
      .evidenceRequestedAt;
    delete recruitmentCase
      .evidenceRequestDmChannelId;
    delete recruitmentCase
      .evidenceRequestMessageId;

    try {
      await this.saveState();
    } catch (error) {
      this.state.casesById[
        recruitmentCase.id
      ] = previousCase;

      await auditMessage.delete()
        .catch((deleteError) => {
          console.error(
            "Could not remove contact evidence after a state-save failure:",
            deleteError,
          );
        });

      throw error;
    }

    try {
      await this.updateCaseAssignmentMessage(
        recruitmentCase,
      );
    } catch (error) {
      console.error(
        "Contact evidence was recorded, but the officer assignment message could not be refreshed:",
        error,
      );
    }

    await directMessage.reply(
      `**${recruitmentCase.candidateName}** is now marked **Contacted**.`,
    );
  }

  private async getAuthorizedCase(
    interaction:
      | ButtonInteraction
      | ModalSubmitInteraction,
    caseId: string,
    expectedStatus:
      | RecruitmentCaseStatus
      | readonly RecruitmentCaseStatus[],
  ): Promise<
    RecruitmentCase |
    undefined
  > {
    const recruitmentCase =
      this.state.casesById[
        caseId
      ];

    if (!recruitmentCase) {
      await this.replyEphemeral(
        interaction,
        [
          "This recruitment case could not be found.",
          "It may have been removed or created before workflow tracking was enabled.",
        ].join(" "),
      );

      return undefined;
    }

    if (
      interaction.user.id !==
      recruitmentCase
        .assignedOfficerId
    ) {
      await this.replyEphemeral(
        interaction,
        "Only the recruitment officer assigned to this candidate can perform this action.",
      );

      return undefined;
    }

    if (
      interaction.message?.id !==
        recruitmentCase
          .assignmentMessageId
    ) {
      await this.replyEphemeral(
        interaction,
        "This button does not belong to the stored recruitment assignment.",
      );

      return undefined;
    }

    const hasExpectedStatus =
      Array.isArray(expectedStatus)
        ? expectedStatus.includes(
            recruitmentCase.status,
          )
        : recruitmentCase.status ===
          expectedStatus;

    if (!hasExpectedStatus) {
      await this.replyEphemeral(
        interaction,
        [
          "This candidate is currently marked",
          `**${this.formatStatus(recruitmentCase.status)}**.`,
          "Refresh the thread and use the actions shown on the latest assignment message.",
        ].join(" "),
      );

      return undefined;
    }

    return recruitmentCase;
  }

  private renderManualReviewCase(
    recruitmentCase:
      RecruitmentCase,
  ): {
    content: string;
    components:
      ActionRowBuilder<ButtonBuilder>[];
  } {
    const candidateLink =
      `[${recruitmentCase.candidateName}](${recruitmentCase.candidateOutputMessageUrl})`;

    const isPassCandidate =
      recruitmentCase.candidateStatus ===
      "PASS";

    const contentLines = [
      `📣 <@${recruitmentCase.assignedOfficerId}>`,
      "",
      isPassCandidate
        ? "**PASS candidate**"
        : "**MANUAL REVIEW candidate**",
      "",
      isPassCandidate
        ? [
            candidateLink,
            "matches all of our configured recruitment criteria",
            "and should be contacted.",
          ].join(" ")
        : [
            candidateLink,
            "has no automatic red flags excluding them",
            "as a potential match for the team.",
          ].join(" "),
      "",
      ...(isPassCandidate
        ? []
        : [
            [
              "Further manual review is needed to confirm",
              "whether they are a viable candidate.",
            ].join(" "),
            "",
          ]),
      `**Status:** ${this.formatStatus(recruitmentCase.status)}`,
    ];

    const components:
      ActionRowBuilder<ButtonBuilder>[] =
      [];

    switch (recruitmentCase.status) {
      case "ASSIGNED": {
        contentLines.push(
          `**Assigned:** ${toDiscordTimestamp(recruitmentCase.assignedAt)}`,
        );

        components.push(
          new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(
                  createCustomId(
                    "start",
                    recruitmentCase.id,
                  ),
                )
                .setLabel(
                  "Start Review",
                )
                .setStyle(
                  ButtonStyle.Primary,
                ),
            ),
        );

        break;
      }

      case "OUTREACH_PENDING": {
        contentLines.push(
          `**Assigned:** ${toDiscordTimestamp(recruitmentCase.assignedAt)}`,
        );

        if (recruitmentCase.evidenceRequestedAt) {
          contentLines.push(
            "",
            [
              "**Contact evidence:** Waiting for a screenshot in the assigned recruiter's DMs.",
              "Paste one image there with Ctrl+V, or type `cancel` to return to the outreach actions.",
            ].join(" "),
          );
        } else {
          contentLines.push(
            "",
            "Contact the candidate, then provide outreach evidence or mark them Not a Fit.",
          );

          components.push(
            new ActionRowBuilder<ButtonBuilder>()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId(
                    createCustomId(
                      "contact",
                      recruitmentCase.id,
                    ),
                  )
                  .setLabel("Mark Contacted")
                  .setStyle(ButtonStyle.Success),

                new ButtonBuilder()
                  .setCustomId(
                    createCustomId(
                      "not-a-fit",
                      recruitmentCase.id,
                    ),
                  )
                  .setLabel("Not a Fit")
                  .setStyle(ButtonStyle.Danger),
              ),
          );
        }

        break;
      }

      case "UNDER_REVIEW": {
        if (
          recruitmentCase
            .reviewStartedBy
        ) {
          contentLines.push(
            [
              "**Review started by:**",
              `<@${recruitmentCase.reviewStartedBy}>`,
            ].join(" "),
          );
        }

        if (
          recruitmentCase
            .reviewStartedAt
        ) {
          contentLines.push(
            [
              "**Review started:**",
              toDiscordTimestamp(
                recruitmentCase
                  .reviewStartedAt,
              ),
            ].join(" "),
          );
        }

        if (
          recruitmentCase
            .evidenceRequestedAt
        ) {
          contentLines.push(
            "",
            [
              "**Contact evidence:** Waiting for a screenshot in the assigned recruiter's DMs.",
              "Paste one image there with Ctrl+V, or type `cancel` to return to the review actions.",
            ].join(" "),
          );
        } else {
          contentLines.push(
            "",
            [
              "After reviewing the candidate, mark them Contacted",
              "to receive a private screenshot request in your DMs,",
              "or mark them Not a Fit.",
            ].join(" "),
          );

          components.push(
            new ActionRowBuilder<ButtonBuilder>()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId(
                    createCustomId(
                      "contact",
                      recruitmentCase.id,
                    ),
                  )
                  .setLabel(
                    "Mark Contacted",
                  )
                  .setStyle(
                    ButtonStyle.Success,
                  ),

                new ButtonBuilder()
                  .setCustomId(
                    createCustomId(
                      "not-a-fit",
                      recruitmentCase.id,
                    ),
                  )
                  .setLabel(
                    "Not a Fit",
                  )
                  .setStyle(
                    ButtonStyle.Danger,
                  ),
              ),
          );
        }

        break;
      }

      case "CONTACTED": {
        if (
          recruitmentCase
            .contactedBy
        ) {
          contentLines.push(
            [
              "**Contacted by:**",
              `<@${recruitmentCase.contactedBy}>`,
            ].join(" "),
          );
        }

        if (
          recruitmentCase
            .contactedAt
        ) {
          contentLines.push(
            [
              "**Contacted:**",
              toDiscordTimestamp(
                recruitmentCase
                  .contactedAt,
              ),
            ].join(" "),
          );
        }

        components.push(
          new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(
                  createCustomId(
                    "in-discussion",
                    recruitmentCase.id,
                  ),
                )
                .setLabel(
                  "In Discussion",
                )
                .setStyle(
                  ButtonStyle.Primary,
                ),

              new ButtonBuilder()
                .setCustomId(
                  createCustomId(
                    "not-a-fit",
                    recruitmentCase.id,
                  ),
                )
                .setLabel(
                  "Not a Fit",
                )
                .setStyle(
                  ButtonStyle.Danger,
                ),
            ),
        );

        break;
      }

      case "IN_DISCUSSION": {
        if (
          recruitmentCase
            .discussionStartedBy
        ) {
          contentLines.push(
            [
              "**Discussion started by:**",
              `<@${recruitmentCase.discussionStartedBy}>`,
            ].join(" "),
          );
        }

        if (
          recruitmentCase
            .discussionStartedAt
        ) {
          contentLines.push(
            [
              "**Discussion started:**",
              toDiscordTimestamp(
                recruitmentCase
                  .discussionStartedAt,
              ),
            ].join(" "),
          );
        }

        components.push(
          new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(
                  createCustomId(
                    "joining",
                    recruitmentCase.id,
                  ),
                )
                .setLabel(
                  "We got 'em",
                )
                .setStyle(
                  ButtonStyle.Success,
                ),

              new ButtonBuilder()
                .setCustomId(
                  createCustomId(
                    "not-a-fit",
                    recruitmentCase.id,
                  ),
                )
                .setLabel(
                  "Not a Fit",
                )
                .setStyle(
                  ButtonStyle.Danger,
                ),
            ),
        );

        break;
      }

      case "JOINING": {
        if (recruitmentCase.joiningBy) {
          contentLines.push(
            [
              "**Confirmed by:**",
              `<@${recruitmentCase.joiningBy}>`,
            ].join(" "),
          );
        }

        if (recruitmentCase.joiningAt) {
          contentLines.push(
            [
              "**Joining confirmed:**",
              toDiscordTimestamp(
                recruitmentCase.joiningAt,
              ),
            ].join(" "),
          );
        }

        break;
      }

      case "NOT_VIABLE": {
        if (
          recruitmentCase
            .notViableBy
        ) {
          contentLines.push(
            [
              "**Reviewed by:**",
              `<@${recruitmentCase.notViableBy}>`,
            ].join(" "),
          );
        }

        if (
          recruitmentCase
            .notViableAt
        ) {
          contentLines.push(
            [
              "**Decision recorded:**",
              toDiscordTimestamp(
                recruitmentCase
                  .notViableAt,
              ),
            ].join(" "),
          );
        }

        if (
          recruitmentCase
            .notViableReason
        ) {
          contentLines.push(
            [
              "**Reason:**",
              recruitmentCase.notViableReason,
            ].join(" "),
          );
        }

        break;
      }
    }

    return {
      content:
        contentLines.join("\n"),
      components,
    };
  }

  private formatStatus(
    status:
      RecruitmentCaseStatus,
  ): string {
    switch (status) {
      case "ASSIGNED":
        return "Assigned";

      case "OUTREACH_PENDING":
        return "Assigned";

      case "UNDER_REVIEW":
        return "Under Review";

      case "CONTACTED":
        return "Contacted";

      case "IN_DISCUSSION":
        return "In Discussion";

      case "JOINING":
        return "We Got 'Em";

      case "NOT_VIABLE":
        return "Not a Fit";
    }
  }

  private advanceOfficer(): void {
    this.state.nextOfficerIndex =
      (
        this.state
          .nextOfficerIndex + 1
      ) % this.officerIds.length;
  }

  private async getOutputChannel():
  Promise<TextChannel> {
    const channel =
      await this.client
        .channels.fetch(
          this.outputChannelId,
        );

    if (
      !channel ||
      channel.type !==
        ChannelType.GuildText
    ) {
      throw new Error(
        [
          "Output channel",
          this.outputChannelId,
          "must be a normal Discord text channel",
          "to support officer threads.",
        ].join(" "),
      );
    }

    return channel;
  }

  private async getAuditChannel():
  Promise<TextChannel> {
    const channel =
      await this.client
        .channels.fetch(
          this.auditChannelId,
        );

    if (
      !channel ||
      channel.type !==
        ChannelType.GuildText
    ) {
      throw new Error(
        [
          "Audit channel",
          this.auditChannelId,
          "must be a normal Discord text channel.",
        ].join(" "),
      );
    }

    return channel;
  }

  private async prepareOfficerThread(
    thread: ThreadChannel,
  ): Promise<ThreadChannel> {
    if (thread.archived) {
      await thread.setArchived(
        false,
        "New recruitment assignment",
      );
    }

    if (thread.locked) {
      await thread.setLocked(
        false,
        "New recruitment assignment",
      );
    }

    return thread;
  }

  private async findExistingOfficerThread(
    outputChannel: TextChannel,
    officerId: string,
    expectedName: string,
  ): Promise<ThreadChannel | undefined> {
    const priorThreadIds = [
      ...new Set(
        Object.values(
          this.state.casesById,
        )
          .filter(
            (recruitmentCase) =>
              recruitmentCase
                .assignedOfficerId ===
              officerId,
          )
          .sort(
            (left, right) =>
              right.assignedAt.localeCompare(
                left.assignedAt,
              ),
          )
          .map(
            (recruitmentCase) =>
              recruitmentCase.threadId,
          ),
      ),
    ];

    for (const threadId of priorThreadIds) {
      const priorChannel =
        await this.client.channels
          .fetch(threadId)
          .catch(() => null);

      if (
        priorChannel?.isThread() &&
        priorChannel.parentId ===
          outputChannel.id
      ) {
        return priorChannel;
      }
    }

    const discoveredThreads =
      new Map<string, ThreadChannel>();

    const activeThreads =
      await outputChannel.threads
        .fetchActive(false)
        .catch((error) => {
          console.warn(
            "Could not search active recruitment threads:",
            error,
          );

          return undefined;
        });

    for (
      const thread of
        activeThreads?.threads.values() ??
        []
    ) {
      if (
        thread.parentId ===
        outputChannel.id
      ) {
        discoveredThreads.set(
          thread.id,
          thread,
        );
      }
    }

    const archivedThreads =
      await outputChannel.threads
        .fetchArchived({
          type: "public",
          fetchAll: true,
        }, false)
        .catch((error) => {
          console.warn(
            "Could not search archived recruitment threads:",
            error,
          );

          return undefined;
        });

    for (
      const thread of
        archivedThreads?.threads.values() ??
        []
    ) {
      if (
        thread.parentId ===
        outputChannel.id
      ) {
        discoveredThreads.set(
          thread.id,
          thread,
        );
      }
    }

    return [
      ...discoveredThreads.values(),
    ]
      .filter(
        (thread) =>
          thread.name === expectedName,
      )
      .sort(
        (left, right) =>
          left.id === right.id
            ? 0
            : BigInt(left.id) <
                BigInt(right.id)
              ? -1
              : 1,
      )[0];
  }

  private async getOrCreateOfficerThread(
    officerId: string,
  ): Promise<ThreadChannel> {
    const outputChannel =
      await this.getOutputChannel();

    const storedThreadId =
      this.state
        .threadIdsByOfficer[
          officerId
        ];

    if (storedThreadId) {
      const storedChannel =
        await this.client
          .channels.fetch(
            storedThreadId,
          )
          .catch(() => null);

      if (
        storedChannel?.isThread() &&
        storedChannel.parentId ===
          outputChannel.id
      ) {
        return this.prepareOfficerThread(
          storedChannel,
        );
      }
    }

    const officer =
      await this.client.users
        .fetch(officerId)
        .catch(() => null);

    const officerName =
      officer?.globalName ??
      officer?.username ??
      officerId;

    const threadName = [
      "Recruiting",
      officerName,
    ]
      .join(" — ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 100);

    const existingThread =
      await this.findExistingOfficerThread(
        outputChannel,
        officerId,
        threadName,
      );

    if (existingThread) {
      this.state
        .threadIdsByOfficer[
          officerId
        ] = existingThread.id;

      await this.saveState();

      return this.prepareOfficerThread(
        existingThread,
      );
    }

    const thread =
      await outputChannel
        .threads.create({
          name: threadName,
          type:
            ChannelType.PublicThread,
          autoArchiveDuration:
            ThreadAutoArchiveDuration.OneWeek,
          reason:
            `Recruitment queue for officer ${officerId}`,
        });

    this.state
      .threadIdsByOfficer[
        officerId
      ] = thread.id;

    try {
      await this.saveState();
    } catch (error) {
      try {
        await thread.delete(
          "Could not save officer thread state",
        );
      } catch (deleteError) {
        console.error(
          "Could not remove the untracked officer thread:",
          deleteError,
        );
      }

      throw error;
    }

    console.log(
      [
        "Created recruitment thread",
        `"${thread.name}"`,
        `for officer ${officerId}.`,
      ].join(" "),
    );

    return thread;
  }

  private async updateCaseAssignmentMessage(
    recruitmentCase:
      RecruitmentCase,
    reopenThread = true,
  ): Promise<void> {
    const thread =
      await this.client.channels
        .fetch(
          recruitmentCase.threadId,
        );

    if (!thread?.isThread()) {
      throw new Error(
        [
          "Recruitment thread",
          recruitmentCase.threadId,
          "was not found.",
        ].join(" "),
      );
    }

    if (thread.archived) {
      if (!reopenThread) {
        return;
      }

      await thread.setArchived(
        false,
        "Recruitment workflow update",
      );
    }

    const message =
      await thread.messages.fetch(
        recruitmentCase
          .assignmentMessageId,
      );

    const rendered =
      this.renderManualReviewCase(
        recruitmentCase,
      );

    await message.edit({
      content: rendered.content,
      components:
        rendered.components,
      allowedMentions: {
        parse: [],
      },
    });
  }

  private async refreshStoredCaseMessages():
  Promise<void> {
    const staleCases:
      RecruitmentCase[] = [];

    for (
      const recruitmentCase of Object.values(
        this.state.casesById,
      )
    ) {
      try {
        await this
          .updateCaseAssignmentMessage(
            recruitmentCase,
            false,
          );
      } catch (error) {
        if (
          isUnknownDiscordMessageError(
            error,
          )
        ) {
          staleCases.push(
            recruitmentCase,
          );

          continue;
        }

        console.warn(
          [
            "Could not refresh stored recruitment case",
            `${recruitmentCase.id}:`,
          ].join(" "),
          error,
        );
      }
    }

    if (staleCases.length === 0) {
      return;
    }

    for (
      const staleCase of staleCases
    ) {
      delete this.state.casesById[
        staleCase.id
      ];
    }

    try {
      await this.saveState();
    } catch (error) {
      for (
        const staleCase of staleCases
      ) {
        this.state.casesById[
          staleCase.id
        ] = staleCase;
      }

      throw error;
    }

    for (
      const staleCase of staleCases
    ) {
      console.warn(
        [
          "Removed stale recruitment case",
          `${staleCase.id}`,
          `(${staleCase.candidateName}):`,
          "its Discord assignment message no longer exists.",
        ].join(" "),
      );
    }
  }

  private async backfillStoredCandidateRealms():
  Promise<void> {
    const casesMissingRealm =
      Object.values(
        this.state.casesById,
      ).filter(
        (recruitmentCase) =>
          !recruitmentCase
            .candidateRealm?.trim(),
      );

    if (casesMissingRealm.length === 0) {
      return;
    }

    let outputChannel: TextChannel;

    try {
      outputChannel =
        await this.getOutputChannel();
    } catch (error) {
      console.warn(
        "Could not backfill candidate realms from the output channel:",
        error,
      );

      return;
    }

    const backfilledCases:
      RecruitmentCase[] = [];

    for (
      const recruitmentCase of casesMissingRealm
    ) {
      try {
        const outputMessage =
          await outputChannel.messages
            .fetch(
              recruitmentCase.id,
            );
        const candidateRealm =
          parseCandidateRealmFromOutput(
            outputMessage,
          );

        if (!candidateRealm) {
          console.warn(
            [
              "Could not determine the candidate realm for stored case",
              `${recruitmentCase.id}.`,
            ].join(" "),
          );

          continue;
        }

        recruitmentCase.candidateRealm =
          candidateRealm;
        backfilledCases.push(
          recruitmentCase,
        );
      } catch (error) {
        if (
          isUnknownDiscordMessageError(
            error,
          )
        ) {
          console.warn(
            [
              "Could not backfill the candidate realm for stored case",
              `${recruitmentCase.id}:`,
              "its main output message no longer exists.",
            ].join(" "),
          );

          continue;
        }

        console.warn(
          [
            "Could not backfill the candidate realm for stored case",
            `${recruitmentCase.id}:`,
          ].join(" "),
          error,
        );
      }
    }

    if (backfilledCases.length === 0) {
      return;
    }

    try {
      await this.saveState();
    } catch (error) {
      for (
        const recruitmentCase of backfilledCases
      ) {
        delete recruitmentCase
          .candidateRealm;
      }

      throw error;
    }

    console.log(
      [
        "Backfilled candidate realms for",
        `${backfilledCases.length}`,
        "stored recruitment case(s).",
      ].join(" "),
    );

  }

  private async replyEphemeral(
    interaction: Interaction,
    content: string,
  ): Promise<void> {
    if (!interaction.isRepliable()) {
      return;
    }

    if (
      interaction.deferred ||
      interaction.replied
    ) {
      if (
        interaction.ephemeral ===
        null
      ) {
        await interaction.followUp({
          content,
          flags:
            MessageFlags.Ephemeral,
          allowedMentions: {
            parse: [],
          },
        });

        return;
      }

      await interaction.editReply({
        content,
      });

      return;
    }

    await interaction.reply({
      content,
      flags:
        MessageFlags.Ephemeral,
      allowedMentions: {
        parse: [],
      },
    });
  }

  private async loadState():
  Promise<void> {
    try {
      const contents =
        await readFile(
          this.stateFilePath,
          "utf8",
        );

      const parsed =
        JSON.parse(contents) as
          Partial<OfficerThreadState>;

      this.state = {
        nextOfficerIndex:
          typeof parsed
            .nextOfficerIndex ===
              "number" &&
          Number.isInteger(
            parsed.nextOfficerIndex,
          ) &&
          parsed.nextOfficerIndex >= 0
            ? parsed.nextOfficerIndex
            : 0,

        threadIdsByOfficer:
          parsed.threadIdsByOfficer &&
          typeof parsed
            .threadIdsByOfficer ===
              "object"
            ? parsed.threadIdsByOfficer
            : {},

        casesById:
          parsed.casesById &&
          typeof parsed
            .casesById ===
              "object"
            ? parsed.casesById
            : {},
      };
    } catch (error) {
      const fileError =
        error as
          NodeJS.ErrnoException;

      if (
        fileError.code !==
        "ENOENT"
      ) {
        throw error;
      }

      this.state = {
        ...defaultState,
        threadIdsByOfficer: {},
        casesById: {},
      };
    }
  }

  private async saveState():
  Promise<void> {
    await mkdir(
      dirname(
        this.stateFilePath,
      ),
      {
        recursive: true,
      },
    );

    const temporaryPath =
      `${this.stateFilePath}.tmp`;

    await writeFile(
      temporaryPath,
      JSON.stringify(
        this.state,
        null,
        2,
      ),
      "utf8",
    );

    await rename(
      temporaryPath,
      this.stateFilePath,
    );
  }
}
