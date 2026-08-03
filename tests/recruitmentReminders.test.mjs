import assert from "node:assert/strict";
import test from "node:test";

import {
  getDueRecruitmentReminder,
} from "../dist/officers/recruitmentReminders.js";

const now = Date.parse(
  "2026-08-10T12:00:00.000Z",
);

const hour = 60 * 60 * 1_000;
const day = 24 * hour;

function iso(millisecondsAgo) {
  return new Date(
    now - millisecondsAgo,
  ).toISOString();
}

function createCase(overrides = {}) {
  return {
    candidateStatus: "MANUAL_REVIEW",
    status: "ASSIGNED",
    assignedAt: iso(12 * hour),
    ...overrides,
  };
}

test(
  "reminds after 12 inactive assignment hours",
  () => {
    assert.equal(
      getDueRecruitmentReminder(
        createCase({
          assignedAt:
            iso(12 * hour - 1),
        }),
        now,
      ),
      undefined,
    );

    assert.deepEqual(
      getDueRecruitmentReminder(
        createCase(),
        now,
      ),
      {
        stage: "ASSIGNED",
        inactivityLabel: "12 hours",
        actionText:
          "Open the assignment and click **Start Review**.",
      },
    );
  },
);

test(
  "PASS assignments skip Start Review in their reminder",
  () => {
    const reminder =
      getDueRecruitmentReminder(
        createCase({
          candidateStatus: "PASS",
          status: "OUTREACH_PENDING",
        }),
        now,
      );

    assert.equal(
      reminder?.actionText,
      "Open the assignment and choose **Mark Contacted** or **Not a Fit**.",
    );
  },
);

test(
  "reminds after 6 inactive review hours",
  () => {
    const reminder =
      getDueRecruitmentReminder(
        createCase({
          status: "UNDER_REVIEW",
          reviewStartedAt: iso(6 * hour),
        }),
        now,
      );

    assert.equal(
      reminder?.stage,
      "UNDER_REVIEW",
    );
    assert.equal(
      reminder?.inactivityLabel,
      "6 hours",
    );
  },
);

test(
  "reminds three days after Mark Contacted while evidence is pending",
  () => {
    const reminder =
      getDueRecruitmentReminder(
        createCase({
          status: "UNDER_REVIEW",
          reviewStartedAt: iso(10 * day),
          evidenceRequestedAt:
            iso(3 * day),
        }),
        now,
      );

    assert.equal(
      reminder?.stage,
      "CONTACT_EVIDENCE_PENDING",
    );
    assert.match(
      reminder?.actionText ?? "",
      /contact screenshot/,
    );
  },
);

test(
  "reminds after three inactive days in Contacted and In Discussion",
  () => {
    const contactedReminder =
      getDueRecruitmentReminder(
        createCase({
          status: "CONTACTED",
          contactedAt: iso(3 * day),
        }),
        now,
      );

    const discussionReminder =
      getDueRecruitmentReminder(
        createCase({
          status: "IN_DISCUSSION",
          discussionStartedAt:
            iso(3 * day),
        }),
        now,
      );

    assert.equal(
      contactedReminder?.stage,
      "CONTACTED",
    );
    assert.equal(
      discussionReminder?.stage,
      "IN_DISCUSSION",
    );
  },
);

test(
  "uses the latest action time and sends only once per stage",
  () => {
    assert.equal(
      getDueRecruitmentReminder(
        createCase({
          assignedAt: iso(5 * day),
          lastActionAt: iso(11 * hour),
        }),
        now,
      ),
      undefined,
    );

    assert.equal(
      getDueRecruitmentReminder(
        createCase({
          reminderStage: "ASSIGNED",
        }),
        now,
      ),
      undefined,
    );
  },
);

test(
  "does not remind terminal cases",
  () => {
    for (const status of [
      "JOINING",
      "NOT_VIABLE",
    ]) {
      assert.equal(
        getDueRecruitmentReminder(
          createCase({ status }),
          now,
        ),
        undefined,
      );
    }
  },
);
