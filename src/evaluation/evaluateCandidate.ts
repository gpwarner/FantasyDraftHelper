import type { AzeriteCandidate } from "../candidates/parseAzeriteCandidate.js";
import {
  guildRequirements,
  type RosterNeed,
} from "../config/guildRequirements.js";
import type { CandidateAvailability } from "../schedules/types.js";
import { evaluateAvailability } from "../schedules/evaluateAvailability.js";
import {
  classifyRecruitmentTimezone,
} from "../schedules/classifyRecruitmentTimezone.js";
import type {
  RecruitmentRole,
  RuntimeRosterConfig,
} from "../config/recruitmentConfigStore.js";

export type CheckStatus =
  | "PASS"
  | "FAIL"
  | "MANUAL_REVIEW";

type ParsedAzeriteSchedule = NonNullable<AzeriteCandidate["schedule"]>;

interface ScheduleSubcheck {
  label: string;
  status: CheckStatus;
  summary: string;
}

export interface EvaluationCheck {
  name: string;
  status: CheckStatus;
  summary: string;
}

export interface CandidateEvaluation {
  overallStatus: CheckStatus;
  specKey: string;
  checks: EvaluationCheck[];
}

function evaluateWarcraftLogs(
  candidate: AzeriteCandidate,
): EvaluationCheck {
  const logs =
    candidate.warcraftLogs;

  const overall =
    logs.overall;

  const minimum =
    guildRequirements.warcraftLogs
      .minimumOverallParse;

  const metricLabel =
    logs.metric === "hps"
      ? "healing"
      : logs.metric === "dps"
        ? "damage"
        : "role-appropriate";

  if (
    typeof overall !== "number" ||
    !Number.isFinite(overall)
  ) {
    return {
      name: "Warcraft Logs",
      status: "MANUAL_REVIEW",
      summary: logs.error
        ? [
            `Could not retrieve ${metricLabel}`,
            "rankings from Warcraft Logs.",
          ].join(" ")
        : [
            `No ${metricLabel} rankings`,
            "were found.",
          ].join(" "),
    };
  }

  if (overall >= minimum) {
    return {
      name: "Warcraft Logs",
      status: "PASS",
      summary: [
        `${overall.toFixed(1)} overall`,
        `${metricLabel} parse meets`,
        `the minimum of ${minimum.toFixed(1)}.`,
      ].join(" "),
    };
  }

  return {
    name: "Warcraft Logs",
    status: "FAIL",
    summary: [
      `${overall.toFixed(1)} overall`,
      `${metricLabel} parse is below`,
      `the minimum of ${minimum.toFixed(1)}.`,
    ].join(" "),
  };
}

function getRosterNeed(
  candidate: AzeriteCandidate,
  runtimeRoster?: RuntimeRosterConfig,
): {
  specKey: string;
  need: RosterNeed;
} {
  const specKey = [
    candidate.character.spec,
    candidate.character.className,
  ].filter(Boolean).join(" ") ||
    "Unknown class/spec";

  let need: RosterNeed;

  if (runtimeRoster) {
    if (runtimeRoster.mode === "all") {
      need = "open";
    } else {
      const normalizedRole =
        candidate.character.role
          ?.trim()
          .toUpperCase();

      const roleMatches =
        normalizedRole
          ? runtimeRoster.roles.includes(
              normalizedRole as
                RecruitmentRole,
            )
          : false;

      const specMatches =
        candidate.character.spec &&
        candidate.character.className
          ? runtimeRoster.specs.some(
              (target) =>
                target.toLowerCase() ===
                specKey.toLowerCase(),
            )
          : false;

      need =
        roleMatches || specMatches
          ? "open"
          : "closed";
    }
  } else {
    need =
      guildRequirements.roster.overrides[specKey] ??
      guildRequirements.roster.defaultNeed;
  }

  return {
    specKey,
    need,
  };
}

function evaluateRosterFit(
  candidate: AzeriteCandidate,
  runtimeRoster?: RuntimeRosterConfig,
): EvaluationCheck {
  const hasClassAndSpec = Boolean(
    candidate.character.className &&
    candidate.character.spec,
  );

  const canUseSelectedRole = Boolean(
    runtimeRoster?.mode === "selected" &&
    candidate.character.role,
  );

  if (
    !hasClassAndSpec &&
    !canUseSelectedRole
  ) {
    return {
      name: "Roster fit",
      status: "PASS",
      summary: [
        "Azerite did not include the character class/spec;",
        "roster filtering was skipped.",
      ].join(" "),
    };
  }

  const { specKey, need } =
    getRosterNeed(
      candidate,
      runtimeRoster,
    );

  switch (need) {
    case "high":
      return {
        name: "Roster fit",
        status: "PASS",
        summary: `${specKey} is a high-priority need.`,
      };

    case "open":
      return {
        name: "Roster fit",
        status: "PASS",
        summary: `${specKey} is currently open.`,
      };

    case "low":
      return {
        name: "Roster fit",
        status: "PASS",
        summary: `${specKey} is a low-priority but open spec.`,
      };

    case "closed": {
      const overall =
        candidate.warcraftLogs.overall;

      const exceptionalThreshold =
        guildRequirements.warcraftLogs
          .exceptionalOverallParse;

      if (
        overall !== undefined &&
        overall > exceptionalThreshold
      ) {
        return {
          name: "Roster fit",
          status: "MANUAL_REVIEW",
          summary: [
            `${specKey} is closed, but the`,
            ` ${overall.toFixed(1)} overall parse is`,
            ` above the exceptional-player threshold`,
            ` of ${exceptionalThreshold.toFixed(1)}.`,
          ].join(""),
        };
      }

      return {
        name: "Roster fit",
        status: "FAIL",
        summary:
          overall === undefined
            ? `${specKey} is closed and no overall parse was found.`
            : [
              `${specKey} is closed, and the`,
              ` ${overall.toFixed(1)} overall parse is not`,
              ` above the exceptional-player threshold`,
              ` of ${exceptionalThreshold.toFixed(1)}.`,
            ].join(""),
      };
    }
  }
}

function formatRange(
  range:
    | {
      minimum: number;
      maximum: number;
    }
    | undefined,
  unit: string,
): string | undefined {
  if (!range) {
    return undefined;
  }

  if (range.minimum === range.maximum) {
    return `${range.minimum} ${unit}`;
  }

  return [
    `${range.minimum}–${range.maximum}`,
    unit,
  ].join(" ");
}

function getRequiredRaidDayCount(): number {
  const requiredDays = new Set(
    guildRequirements.raidSchedule
      .filter((raid) => raid.required)
      .map((raid) => raid.day),
  );

  return requiredDays.size;
}

function parseClockMinutes(time: string): number {
  const match = time.match(
    /^([01]\d|2[0-3]):([0-5]\d)$/,
  );

  if (!match) {
    throw new Error(
      `Invalid raid time "${time}". Expected HH:mm.`,
    );
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function getRaidDurationHours(
  start: string,
  end: string,
  endsNextDay: boolean,
): number {
  const startMinutes = parseClockMinutes(start);
  let endMinutes = parseClockMinutes(end);

  if (
    endsNextDay ||
    endMinutes <= startMinutes
  ) {
    endMinutes += 24 * 60;
  }

  return (endMinutes - startMinutes) / 60;
}

function getRequiredRaidHoursPerDay(): number {
  const durations = guildRequirements.raidSchedule
    .filter((raid) => raid.required)
    .map((raid) =>
      getRaidDurationHours(
        raid.start,
        raid.end,
        raid.endsNextDay,
      ),
    );

  return durations.length > 0
    ? Math.max(...durations)
    : 0;
}

function formatNumericRange(
  range: {
    minimum: number;
    maximum: number;
  },
): string {
  if (range.minimum === range.maximum) {
    return String(range.minimum);
  }

  return `${range.minimum}–${range.maximum}`;
}

function evaluateSchedule(
  candidate: AzeriteCandidate,
  availability:
    | CandidateAvailability
    | undefined,
): EvaluationCheck {
  const schedule = candidate.schedule;
  const reportedTimezone =
    schedule?.timezone?.trim();

  if (reportedTimezone) {
    const timezoneResult =
      classifyRecruitmentTimezone(
        reportedTimezone,
      );

    if (
      timezoneResult.classification ===
      "OUTSIDE_ALLOWED_REGION"
    ) {
      return {
        name: "Raid schedule",
        status: "FAIL",
        summary: [
          `Azerite reports timezone "${reportedTimezone}",`,
          "which is outside the United States and Canada.",
        ].join(" "),
      };
    }

    if (
      timezoneResult.classification ===
      "INVALID"
    ) {
      return {
        name: "Raid schedule",
        status: "MANUAL_REVIEW",
        summary: [
          `Azerite reports unrecognized timezone "${reportedTimezone}".`,
          "Manual review required.",
        ].join(" "),
      };
    }
  }

  /*
   * Exact structured availability takes priority
   * over Azerite's schedule summary.
   */
  if (availability) {
    const scheduleEvaluation =
      evaluateAvailability(availability);

    return {
      name: "Raid schedule",
      status: scheduleEvaluation.status,
      summary: scheduleEvaluation.summary,
    };
  }

  if (!schedule) {
    return {
      name: "Raid schedule",
      status: "MANUAL_REVIEW",
      summary:
        "Azerite did not include schedule information.",
    };
  }

  const requiredDays =
    getRequiredRaidDayCount();

  const requiredHours =
    getRequiredRaidHoursPerDay();

  const checks: ScheduleSubcheck[] = [
    evaluateAzeriteDays(schedule),

    evaluateScheduleRange(
      schedule.daysPerWeek,
      requiredDays,
      "Days per week",
      "days/week",
    ),

    evaluateScheduleRange(
      schedule.hoursPerDay,
      requiredHours,
      "Hours per day",
      "hours/day",
    ),
  ];

  const failedChecks = checks.filter(
    (check) => check.status === "FAIL",
  );

  if (failedChecks.length > 0) {
    return {
      name: "Raid schedule",
      status: "MANUAL_REVIEW",
      summary: [
        "The reported schedule appears incompatible,",
        "but Azerite schedule entries may not accurately",
        "represent the applicant's availability.",
        "Manual review required.",
        ...failedChecks.map(
          (check) =>
            `${check.label}: ${check.summary}`,
        ),
      ].join(" "),
    };
  }

  const manualReviewChecks = checks.filter(
    (check) =>
      check.status === "MANUAL_REVIEW",
  );

  if (manualReviewChecks.length > 0) {
    return {
      name: "Raid schedule",
      status: "MANUAL_REVIEW",
      summary: manualReviewChecks
        .map(
          (check) =>
            `${check.label}: ${check.summary}`,
        )
        .join(" "),
    };
  }

  return {
    name: "Raid schedule",
    status: "PASS",
    summary: "PASS",
  };
}

function determineOverallStatus(
  checks: EvaluationCheck[],
): CheckStatus {
  if (
    checks.some((check) => check.status === "FAIL")
  ) {
    return "FAIL";
  }

  if (
    checks.some(
      (check) =>
        check.status === "MANUAL_REVIEW",
    )
  ) {
    return "MANUAL_REVIEW";
  }

  return "PASS";
}

export function evaluateCandidate(
  candidate: AzeriteCandidate,
  availability?: CandidateAvailability,
  runtimeRoster?: RuntimeRosterConfig,
): CandidateEvaluation {
  const { specKey } = getRosterNeed(
    candidate,
    runtimeRoster,
  );

  const checks: EvaluationCheck[] = [
    evaluateWarcraftLogs(candidate),
    evaluateRosterFit(
      candidate,
      runtimeRoster,
    ),
    evaluateSchedule(candidate, availability),
  ];

  return {
    overallStatus:
      determineOverallStatus(checks),
    specKey,
    checks,
  };
}

function evaluateAzeriteDays(
  schedule: ParsedAzeriteSchedule,
): ScheduleSubcheck {
  const daySummary =
    schedule.daySummary?.trim();

  if (!daySummary) {
    return {
      label: "Days",
      status: "MANUAL_REVIEW",
      summary:
        "Azerite did not include available raid days.",
    };
  }

  if (
    daySummary.toLowerCase() === "any day"
  ) {
    return {
      label: "Days",
      status: "PASS",
      summary:
        '"Any day" includes Monday and Wednesday.',
    };
  }

  return {
    label: "Days",
    status: "MANUAL_REVIEW",
    summary: [
      `Azerite reports "${daySummary}",`,
      "but exact day matching is not supported yet.",
    ].join(" "),
  };
}

function evaluateScheduleRange(
  range:
    | {
        minimum: number;
        maximum: number;
      }
    | undefined,
  requiredValue: number,
  label: string,
  unit: string,
): ScheduleSubcheck {
  if (!range) {
    return {
      label,
      status: "MANUAL_REVIEW",
      summary:
        `Azerite did not include ${unit}.`,
    };
  }

  const rangeText =
    formatNumericRange(range);

  const includesGuildRequirement =
    range.minimum <= requiredValue &&
    range.maximum >= requiredValue;

  if (!includesGuildRequirement) {
    return {
      label,
      status: "FAIL",
      summary: [
        `Applicant accepts ${rangeText} ${unit};`,
        `this does not include the guild's`,
        `${requiredValue} ${unit}.`,
      ].join(" "),
    };
  }

  return {
    label,
    status: "PASS",
    summary: [
      `Applicant accepts ${rangeText} ${unit},`,
      `which includes the guild's`,
      `${requiredValue} ${unit}.`,
    ].join(" "),
  };
}

function determineScheduleStatus(
  checks: ScheduleSubcheck[],
): CheckStatus {
  if (
    checks.some(
      (check) => check.status === "FAIL",
    )
  ) {
    return "FAIL";
  }

  if (
    checks.some(
      (check) =>
        check.status === "MANUAL_REVIEW",
    )
  ) {
    return "MANUAL_REVIEW";
  }

  return "PASS";
}
