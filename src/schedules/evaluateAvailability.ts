import { DateTime } from "luxon";

import {
  guildRequirements,
  type RaidWindow,
  type Weekday,
} from "../config/guildRequirements.js";

import type {
  AvailabilityWindow,
  CandidateAvailability,
} from "./types.js";

export type ScheduleEvaluationStatus =
  | "PASS"
  | "FAIL"
  | "MANUAL_REVIEW";

export interface ScheduleEvaluation {
  status: ScheduleEvaluationStatus;
  summary: string;
}

interface ParsedTime {
  hour: number;
  minute: number;
}

const weekdayNumbers: Record<Weekday, number> = {
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
  Sunday: 7,
};

function parseTime(value: string): ParsedTime {
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)$/);

  if (!match) {
    throw new Error(
      `Invalid time "${value}". Expected 24-hour HH:mm format.`,
    );
  }

  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
  };
}

function createDateTime(
  date: DateTime,
  time: string,
  timezone: string,
): DateTime {
  const parsedTime = parseTime(time);

  const result = DateTime.fromObject(
    {
      year: date.year,
      month: date.month,
      day: date.day,
      hour: parsedTime.hour,
      minute: parsedTime.minute,
      second: 0,
      millisecond: 0,
    },
    {
      zone: timezone,
    },
  );

  if (!result.isValid) {
    throw new Error(
      `Could not create ${date.toISODate()} ${time} in ${timezone}: ` +
        `${result.invalidExplanation ?? "unknown error"}`,
    );
  }

  return result;
}

function createRaidOccurrence(
  raidWindow: RaidWindow,
  weekOffset: number,
): {
  start: DateTime;
  end: DateTime;
} {
  const timezone = guildRequirements.timezone;
  const now = DateTime.now().setZone(timezone);
  const today = now.startOf("day");

  const targetWeekday = weekdayNumbers[raidWindow.day];

  let daysUntilTarget =
    (targetWeekday - today.weekday + 7) % 7;

  let date = today.plus({
    days: daysUntilTarget,
    weeks: weekOffset,
  });

  let start = createDateTime(
    date,
    raidWindow.start,
    timezone,
  );

  // When this week's raid has already started, begin next week.
  if (weekOffset === 0 && start <= now) {
    date = date.plus({ weeks: 1 });
    start = createDateTime(
      date,
      raidWindow.start,
      timezone,
    );
  }

  let end = createDateTime(
    date,
    raidWindow.end,
    timezone,
  );

  if (
    raidWindow.endsNextDay ||
    end.toMillis() <= start.toMillis()
  ) {
    end = end.plus({ days: 1 });
  }

  return {
    start,
    end,
  };
}

function createAvailabilityOccurrence(
  date: DateTime,
  window: AvailabilityWindow,
  timezone: string,
): {
  start: DateTime;
  end: DateTime;
} {
  const start = createDateTime(
    date,
    window.start,
    timezone,
  );

  let end = createDateTime(
    date,
    window.end,
    timezone,
  );

  if (
    window.endsNextDay ||
    end.toMillis() <= start.toMillis()
  ) {
    end = end.plus({ days: 1 });
  }

  return {
    start,
    end,
  };
}

function isCoveredByAvailability(
  raidStart: DateTime,
  raidEnd: DateTime,
  availability: CandidateAvailability,
): boolean {
  /*
   * Convert the raid start to the candidate's timezone.
   *
   * We inspect the surrounding dates because a raid can cross
   * midnight or become a different weekday in another timezone.
   */
  const candidateLocalStart = raidStart.setZone(
    availability.timezone,
  );

  const datesToCheck = [
    candidateLocalStart.startOf("day").minus({ days: 1 }),
    candidateLocalStart.startOf("day"),
    candidateLocalStart.startOf("day").plus({ days: 1 }),
  ];

  for (const window of availability.windows) {
    const requiredWeekday = weekdayNumbers[window.day];

    for (const date of datesToCheck) {
      if (date.weekday !== requiredWeekday) {
        continue;
      }

      const occurrence = createAvailabilityOccurrence(
        date,
        window,
        availability.timezone,
      );

      const coversStart =
        occurrence.start.toMillis() <=
        raidStart.toMillis();

      const coversEnd =
        occurrence.end.toMillis() >=
        raidEnd.toMillis();

      if (coversStart && coversEnd) {
        return true;
      }
    }
  }

  return false;
}

function formatRaidOccurrence(
  raidStart: DateTime,
  raidEnd: DateTime,
): string {
  const startText = raidStart.toFormat(
    "cccc, LLL d yyyy h:mm a ZZZZ",
  );

  const endText = raidEnd.toFormat(
    "h:mm a ZZZZ",
  );

  return `${startText}–${endText}`;
}

export function evaluateAvailability(
  availability: CandidateAvailability | undefined,
): ScheduleEvaluation {
  if (!availability) {
    return {
      status: "MANUAL_REVIEW",
      summary: [
        "No candidate schedule has been retrieved.",
        "Required availability is Monday and Wednesday,",
        "9:00 PM–12:00 AM Eastern.",
      ].join(" "),
    };
  }

  if (
    !DateTime.now()
      .setZone(availability.timezone)
      .isValid
  ) {
    return {
      status: "MANUAL_REVIEW",
      summary:
        `Candidate timezone "${availability.timezone}" is invalid.`,
    };
  }

  if (availability.windows.length === 0) {
    return {
      status: "MANUAL_REVIEW",
      summary:
        "The candidate schedule contains no availability windows.",
    };
  }

  const requiredRaids =
    guildRequirements.raidSchedule.filter(
      (raid) => raid.required,
    );

  /*
   * Check approximately one full year.
   *
   * This catches temporary incompatibilities caused by different
   * daylight-saving transition dates between timezones.
   */
  const weeksToCheck = 54;

  for (
    let weekOffset = 0;
    weekOffset < weeksToCheck;
    weekOffset += 1
  ) {
    for (const raidWindow of requiredRaids) {
      const occurrence = createRaidOccurrence(
        raidWindow,
        weekOffset,
      );

      const covered = isCoveredByAvailability(
        occurrence.start,
        occurrence.end,
        availability,
      );

      if (!covered) {
        return {
          status: "FAIL",
          summary: [
            `Candidate availability does not fully cover`,
            `${formatRaidOccurrence(
              occurrence.start,
              occurrence.end,
            )}.`,
            `Schedule source: ${availability.source}.`,
          ].join(" "),
        };
      }
    }
  }

  return {
    status: "PASS",
    summary: [
      "Candidate availability covers every required",
      "Monday and Wednesday raid from 9:00 PM",
      "through midnight Eastern.",
      `Schedule source: ${availability.source}.`,
    ].join(" "),
  };
}