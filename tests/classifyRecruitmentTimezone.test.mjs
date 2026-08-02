import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyRecruitmentTimezone,
} from "../dist/schedules/classifyRecruitmentTimezone.js";
import {
  evaluateCandidate,
} from "../dist/evaluation/evaluateCandidate.js";

test(
  "allows United States and Canadian timezones",
  () => {
    for (
      const timezone of [
        "America/New_York",
        "America/Chicago",
        "America/Phoenix",
        "America/Anchorage",
        "Pacific/Honolulu",
        "America/Toronto",
        "America/Vancouver",
        "America/St_Johns",
        "US/Eastern",
        "Canada/Eastern",
      ]
    ) {
      assert.equal(
        classifyRecruitmentTimezone(
          timezone,
        ).classification,
        "ALLOWED",
        timezone,
      );
    }
  },
);

test(
  "rejects Latin American and other foreign timezones",
  () => {
    for (
      const timezone of [
        "America/Mexico_City",
        "America/Sao_Paulo",
        "America/Puerto_Rico",
        "Europe/London",
        "Asia/Tokyo",
        "UTC",
      ]
    ) {
      assert.equal(
        classifyRecruitmentTimezone(
          timezone,
        ).classification,
        "OUTSIDE_ALLOWED_REGION",
        timezone,
      );
    }
  },
);

test(
  "marks malformed timezones invalid",
  () => {
    for (
      const timezone of [
        "",
        "Eastern Standard Time",
        "Not/A_Timezone",
      ]
    ) {
      assert.equal(
        classifyRecruitmentTimezone(
          timezone,
        ).classification,
        "INVALID",
        timezone,
      );
    }
  },
);

test(
  "makes a foreign Azerite timezone a hard candidate failure",
  () => {
    const candidate = {
      source: {
        messageId: "1",
        messageUrl:
          "https://discord.com/channels/1/1/1",
        createdAt:
          "2026-08-02T00:00:00.000Z",
      },
      character: {
        name: "TimezoneTest",
        realm: "Area 52",
        region: "US",
        className: "Monk",
        role: "HEALING",
        spec: "Mistweaver",
      },
      schedule: {
        rawText: "Any day",
        daySummary: "Any day",
        timezone: "Europe/London",
        daysPerWeek: {
          minimum: 2,
          maximum: 2,
        },
        hoursPerDay: {
          minimum: 3,
          maximum: 3,
        },
      },
      general: {},
      scores: {},
      raidProgression: {
        Current: "6/9M",
      },
      warcraftLogs: {
        metric: "hps",
        overall: 75,
        bosses: [],
        source: "warcraftlogs_api",
      },
      links: {},
    };

    const evaluation =
      evaluateCandidate(candidate);
    const scheduleCheck =
      evaluation.checks.find(
        (check) =>
          check.name === "Raid schedule",
      );

    assert.equal(
      scheduleCheck?.status,
      "FAIL",
    );
    assert.match(
      scheduleCheck?.summary ?? "",
      /outside the United States and Canada/,
    );
    assert.equal(
      evaluation.overallStatus,
      "FAIL",
    );
  },
);
