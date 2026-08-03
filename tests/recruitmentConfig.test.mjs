import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import {
  tmpdir,
} from "node:os";
import {
  join,
} from "node:path";
import test from "node:test";

import {
  RecruitmentConfigStore,
} from "../dist/config/recruitmentConfigStore.js";
import {
  evaluateCandidate,
} from "../dist/evaluation/evaluateCandidate.js";

const firstOfficer =
  "123456789012345678";
const secondOfficer =
  "234567890123456789";

test(
  "persists officer and selected roster configuration",
  async (context) => {
    const directory = await mkdtemp(
      join(
        tmpdir(),
        "rgrecruitment-config-",
      ),
    );

    context.after(async () => {
      await rm(
        directory,
        {
          recursive: true,
          force: true,
        },
      );
    });

    const statePath = join(
      directory,
      "recruitment-config.json",
    );

    const store =
      new RecruitmentConfigStore(
        [firstOfficer],
        statePath,
      );

    await store.initialize();

    assert.deepEqual(
      store.getConfig(),
      {
        officerIds: [firstOfficer],
        roster: {
          mode: "all",
          roles: [],
          specs: [],
        },
      },
    );

    await assert.rejects(
      store.setRosterMode("selected"),
      /Add at least one role or spec/,
    );

    assert.equal(
      await store.addRole("HEALING"),
      true,
    );
    assert.equal(
      await store.addSpec(
        "Balance Druid",
      ),
      true,
    );
    assert.equal(
      await store.addSpec(
        "balance druid",
      ),
      false,
    );

    await store.setRosterMode(
      "selected",
    );
    await store.setOfficerIds([
      firstOfficer,
      secondOfficer,
    ]);

    const reloadedStore =
      new RecruitmentConfigStore(
        [firstOfficer],
        statePath,
      );

    await reloadedStore.initialize();

    assert.deepEqual(
      reloadedStore.getConfig(),
      {
        officerIds: [
          firstOfficer,
          secondOfficer,
        ],
        roster: {
          mode: "selected",
          roles: ["HEALING"],
          specs: ["Balance Druid"],
        },
      },
    );

    const persisted = JSON.parse(
      await readFile(
        statePath,
        "utf8",
      ),
    );

    assert.deepEqual(
      persisted,
      reloadedStore.getConfig(),
    );

    await assert.rejects(
      reloadedStore.setOfficerIds([]),
      /At least one recruitment officer/,
    );

    assert.equal(
      await reloadedStore.removeRole(
        "HEALING",
      ),
      true,
    );

    await assert.rejects(
      reloadedStore.removeSpec(
        "Balance Druid",
      ),
      /final selected roster target/,
    );
  },
);

function createCandidate({
  className,
  role,
  spec,
}) {
  return {
    source: {
      messageId: "candidate",
      messageUrl:
        "https://discord.com/channels/guild/channel/candidate",
      createdAt:
        "2026-08-03T00:00:00.000Z",
    },
    character: {
      name: "Candidate",
      realm: "Area 52",
      region: "US",
      className,
      role,
      spec,
    },
    schedule: {
      rawText:
        "Any day\n2 Days/Week · 3 Hours/Day",
      daySummary: "Any day",
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
      metric:
        role === "HEALING"
          ? "hps"
          : "dps",
      overall: 60,
      bosses: [],
      source: "warcraftlogs_api",
    },
    links: {},
  };
}

function getRosterCheck(
  candidate,
  roster,
) {
  return evaluateCandidate(
    candidate,
    undefined,
    roster,
  ).checks.find(
    (check) =>
      check.name === "Roster fit",
  );
}

test(
  "matches selected targets by role or exact class/spec",
  () => {
    const roster = {
      mode: "selected",
      roles: ["HEALING"],
      specs: ["Balance Druid"],
    };

    assert.equal(
      getRosterCheck(
        createCandidate({
          className: "Priest",
          role: "HEALING",
          spec: "Holy",
        }),
        roster,
      ).status,
      "PASS",
    );

    assert.equal(
      getRosterCheck(
        createCandidate({
          className: "Druid",
          role: "DPS",
          spec: "Balance",
        }),
        roster,
      ).status,
      "PASS",
    );

    assert.equal(
      getRosterCheck(
        createCandidate({
          className: "Mage",
          role: "DPS",
          spec: "Frost",
        }),
        roster,
      ).status,
      "FAIL",
    );
  },
);

test(
  "keeps All mode open and skips filtering when metadata is absent",
  () => {
    const completeCandidate =
      createCandidate({
        className: "Mage",
        role: "DPS",
        spec: "Frost",
      });

    assert.equal(
      getRosterCheck(
        completeCandidate,
        {
          mode: "all",
          roles: [],
          specs: [],
        },
      ).status,
      "PASS",
    );

    const incompleteCandidate =
      createCandidate({
        className: undefined,
        role: undefined,
        spec: undefined,
      });

    assert.match(
      getRosterCheck(
        incompleteCandidate,
        {
          mode: "selected",
          roles: ["DPS"],
          specs: [],
        },
      ).summary,
      /filtering was skipped/,
    );
  },
);
