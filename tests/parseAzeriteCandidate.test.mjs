import assert from "node:assert/strict";
import test from "node:test";

import {
  parseAzeriteCandidate,
} from "../dist/candidates/parseAzeriteCandidate.js";
import {
  evaluateCandidate,
} from "../dist/evaluation/evaluateCandidate.js";

function createIncompleteAzeriteMessage() {
  const componentJson = {
    type: 17,
    components: [
      {
        type: 10,
        content:
          "## [Incomplete](https://raider.io/characters/us/area-52/Incomplete)",
      },
      {
        type: 10,
        content: "Area 52 · US",
      },
      {
        type: 10,
        content: "### General",
      },
      {
        type: 10,
        content:
          "**Language** » English\n**Faction** » Horde",
      },
      {
        type: 10,
        content: "### Raid Progression",
      },
      {
        type: 10,
        content: "**VS/DR/MQD** » 6/9M",
      },
      {
        type: 1,
        components: [
          {
            type: 2,
            label: "Raider.IO",
            url:
              "https://raider.io/characters/us/area-52/Incomplete",
          },
        ],
      },
    ],
  };

  return {
    id: "1533684265185972364",
    url:
      "https://discord.com/channels/guild/channel/1533684265185972364",
    createdAt: new Date("2026-08-03T12:00:00.000Z"),
    components: [
      {
        toJSON: () => componentJson,
      },
    ],
  };
}

test(
  "continues parsing when Azerite omits class, role, and spec",
  () => {
    const candidate = parseAzeriteCandidate(
      createIncompleteAzeriteMessage(),
    );

    assert.deepEqual(candidate.character, {
      name: "Incomplete",
      realm: "Area 52",
      region: "US",
      className: undefined,
      role: undefined,
      spec: undefined,
    });

    assert.equal(
      candidate.raidProgression["VS/DR/MQD"],
      "6/9M",
    );

    const evaluation = evaluateCandidate(candidate);
    const rosterCheck = evaluation.checks.find(
      (check) => check.name === "Roster fit",
    );

    assert.equal(evaluation.specKey, "Unknown class/spec");
    assert.deepEqual(rosterCheck, {
      name: "Roster fit",
      status: "PASS",
      summary:
        "Azerite did not include the character class/spec; roster filtering was skipped.",
    });
  },
);
