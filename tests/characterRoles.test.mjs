import assert from "node:assert/strict";
import test from "node:test";

import {
  canClassHeal,
  isHealingSpecialization,
} from "../dist/candidates/characterRoles.js";

test(
  "does not allow Mage Warcraft Logs data to trigger a healing correction",
  () => {
    assert.equal(canClassHeal("Mage"), false);
    assert.equal(
      isHealingSpecialization("Mage", "Arcane"),
      false,
    );
  },
);

test(
  "recognizes valid healer class and specialization combinations",
  () => {
    assert.equal(canClassHeal("Priest"), true);
    assert.equal(
      isHealingSpecialization(
        "Priest",
        "Discipline",
      ),
      true,
    );
    assert.equal(
      isHealingSpecialization("Priest", "Shadow"),
      false,
    );
  },
);
