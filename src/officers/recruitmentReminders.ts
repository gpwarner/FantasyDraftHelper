export type RecruitmentReminderStage =
  | "ASSIGNED"
  | "UNDER_REVIEW"
  | "CONTACT_EVIDENCE_PENDING"
  | "CONTACTED"
  | "IN_DISCUSSION";

export interface RecruitmentReminderCase {
  candidateStatus:
    | "PASS"
    | "MANUAL_REVIEW";

  status:
    | "ASSIGNED"
    | "OUTREACH_PENDING"
    | "UNDER_REVIEW"
    | "CONTACTED"
    | "IN_DISCUSSION"
    | "JOINING"
    | "NOT_VIABLE";

  assignedAt: string;
  reviewStartedAt?: string;
  evidenceRequestedAt?: string;
  contactedAt?: string;
  discussionStartedAt?: string;

  lastActionAt?: string;
  reminderStage?: RecruitmentReminderStage;
}

export interface DueRecruitmentReminder {
  stage: RecruitmentReminderStage;
  inactivityLabel: string;
  actionText: string;
}

const HOUR_IN_MILLISECONDS =
  60 * 60 * 1_000;

const DAY_IN_MILLISECONDS =
  24 * HOUR_IN_MILLISECONDS;

function isDue(
  anchor: string | undefined,
  delayMilliseconds: number,
  nowMilliseconds: number,
): boolean {
  if (!anchor) {
    return false;
  }

  const anchorMilliseconds =
    Date.parse(anchor);

  return (
    Number.isFinite(anchorMilliseconds) &&
    nowMilliseconds - anchorMilliseconds >=
      delayMilliseconds
  );
}

/**
 * Return the single reminder currently due for a case.
 * A reminder is sent only once for each inactive workflow stage.
 */
export function getDueRecruitmentReminder(
  recruitmentCase: RecruitmentReminderCase,
  nowMilliseconds = Date.now(),
): DueRecruitmentReminder | undefined {
  let reminder:
    | (DueRecruitmentReminder & {
        anchor: string | undefined;
        delayMilliseconds: number;
      })
    | undefined;

  if (
    recruitmentCase.evidenceRequestedAt &&
    (
      recruitmentCase.status ===
        "OUTREACH_PENDING" ||
      recruitmentCase.status ===
        "UNDER_REVIEW"
    )
  ) {
    reminder = {
      stage:
        "CONTACT_EVIDENCE_PENDING",
      anchor:
        recruitmentCase.lastActionAt ??
        recruitmentCase.evidenceRequestedAt,
      delayMilliseconds:
        3 * DAY_IN_MILLISECONDS,
      inactivityLabel: "3 days",
      actionText: [
        "Paste the requested contact screenshot in this DM,",
        "or type `cancel` if you need to return to the assignment actions.",
      ].join(" "),
    };
  } else {
    switch (recruitmentCase.status) {
      case "ASSIGNED":
      case "OUTREACH_PENDING":
        reminder = {
          stage: "ASSIGNED",
          anchor:
            recruitmentCase.lastActionAt ??
            recruitmentCase.assignedAt,
          delayMilliseconds:
            12 * HOUR_IN_MILLISECONDS,
          inactivityLabel: "12 hours",
          actionText:
            recruitmentCase.candidateStatus ===
              "MANUAL_REVIEW"
              ? "Open the assignment and click **Start Review**."
              : "Open the assignment and choose **Mark Contacted** or **Not a Fit**.",
        };

        break;

      case "UNDER_REVIEW":
        reminder = {
          stage: "UNDER_REVIEW",
          anchor:
            recruitmentCase.lastActionAt ??
            recruitmentCase.reviewStartedAt,
          delayMilliseconds:
            6 * HOUR_IN_MILLISECONDS,
          inactivityLabel: "6 hours",
          actionText:
            "Open the assignment and choose **Mark Contacted** or **Not a Fit**.",
        };

        break;

      case "CONTACTED":
        reminder = {
          stage: "CONTACTED",
          anchor:
            recruitmentCase.lastActionAt ??
            recruitmentCase.contactedAt,
          delayMilliseconds:
            3 * DAY_IN_MILLISECONDS,
          inactivityLabel: "3 days",
          actionText:
            "Open the assignment and choose **In Discussion** or **Not a Fit**.",
        };

        break;

      case "IN_DISCUSSION":
        reminder = {
          stage: "IN_DISCUSSION",
          anchor:
            recruitmentCase.lastActionAt ??
            recruitmentCase.discussionStartedAt,
          delayMilliseconds:
            3 * DAY_IN_MILLISECONDS,
          inactivityLabel: "3 days",
          actionText:
            "Open the assignment and choose **We got 'em** or **Not a Fit**.",
        };

        break;

      case "JOINING":
      case "NOT_VIABLE":
        return undefined;
    }
  }

  if (
    !reminder ||
    recruitmentCase.reminderStage ===
      reminder.stage ||
    !isDue(
      reminder.anchor,
      reminder.delayMilliseconds,
      nowMilliseconds,
    )
  ) {
    return undefined;
  }

  return {
    stage: reminder.stage,
    inactivityLabel:
      reminder.inactivityLabel,
    actionText: reminder.actionText,
  };
}
