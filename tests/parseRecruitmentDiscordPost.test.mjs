import assert from "node:assert/strict";
import test from "node:test";

import {
  parseRecruitmentDiscordPost,
} from "../dist/intake/parseRecruitmentDiscordPost.js";
import {
  recruitmentDiscordGroupPosts,
  recruitmentDiscordPosts,
} from "./fixtures/recruitmentDiscordPosts.mjs";

function identityNames(parsed) {
  return parsed.identityCandidates
    .map(
      (identity) =>
        identity.characterName.toLowerCase(),
    )
    .sort();
}

test(
  "parses the flexible multi-character post without choosing a main",
  () => {
    const parsed =
      parseRecruitmentDiscordPost(
        recruitmentDiscordPosts[0],
      );

    assert.equal(
      parsed.identityStatus,
      "MULTIPLE_IDENTITIES",
    );
    assert.deepEqual(
      identityNames(parsed),
      ["aegisdk", "arrowalt"],
    );
    assert.equal(
      parsed.fields.classSpec,
      "Flexible, leaning DK but flexible",
    );
    assert.equal(
      parsed.contact.discordUsername,
      "sample_recruit",
    );
    assert.deepEqual(
      parsed.progression,
      ["5/9M"],
    );
    assert.equal(
      parsed.links.warcraftLogs.length,
      2,
    );
    assert.equal(
      parsed.links.raiderIo.length,
      2,
    );
  },
);

test(
  "parses numbered group fields without mixing member identities",
  () => {
    const parsed = parseRecruitmentDiscordPost(
      recruitmentDiscordGroupPosts[0],
    );

    assert.equal(parsed.postType, "GROUP");
    assert.equal(parsed.group.declaredCount, 2);
    assert.equal(parsed.group.guildType, "AOTC/Social");
    assert.equal(parsed.group.members.length, 2);
    assert.equal(
      parsed.contact.discordUserId,
      "111111111111111111",
    );

    const [first, second] = parsed.group.members;
    assert.equal(first.classSpec, "Mistweaver Monk / Resto Druid");
    assert.deepEqual(
      first.identityCandidates.map((identity) => identity.characterName),
      ["Mistyexample", "Leafexample"],
    );
    assert.equal(first.links.warcraftLogs.length, 2);
    assert.equal(
      first.identityCandidates.some((identity) =>
        ["Bladeexample", "Bearsample"].includes(identity.characterName),
      ),
      false,
    );
    assert.deepEqual(second.progression, ["8/9"]);
    assert.match(second.availability, /6:00 PM PST/);
  },
);

test(
  "parses collapsed P1 and P2 group fields and shared availability",
  () => {
    const parsed = parseRecruitmentDiscordPost(
      recruitmentDiscordGroupPosts[1],
    );
    const [first, second] = parsed.group.members;

    assert.equal(parsed.postType, "GROUP");
    assert.equal(first.classSpec, "Balance/Feral Druid");
    assert.equal(second.classSpec, "Shadow Priest");
    assert.deepEqual(first.progression, ["6/9M"]);
    assert.deepEqual(second.progression, ["7/9M"]);
    assert.equal(first.availability, "Tues/Thurs 8pm-12am EST");
    assert.equal(second.availability, "Tues/Thurs 8pm-12am EST");
    assert.deepEqual(
      first.identityCandidates
        .map(
          (identity) =>
            `${identity.characterName}-${identity.realmSlug}`.toLowerCase(),
        )
        .sort(),
      [
        "dragonalt-zuljin",
        "moonexample-dalaran",
        "moonexample-zuljin",
      ],
    );
    assert.deepEqual(
      second.identityCandidates.map((identity) =>
        identity.characterName.toLowerCase(),
      ),
      ["shadowsample"],
    );
  },
);

test(
  "applies an unnumbered group availability to every declared member",
  () => {
    const parsed = parseRecruitmentDiscordPost(
      recruitmentDiscordGroupPosts[2],
    );

    assert.equal(parsed.group.members.length, 2);
    assert.equal(
      parsed.group.members[0].availability,
      "Any day, 7 pm - 2 am EST",
    );
    assert.equal(
      parsed.group.members[1].availability,
      "Any day, 7 pm - 2 am EST",
    );
    assert.equal(
      parsed.group.additionalInformation,
      "Both have mythic experience and are returning from a break.",
    );
    assert.deepEqual(
      parsed.group.members.map((member) => member.identityStatus),
      ["MULTIPLE_IDENTITIES", "READY_FOR_CONFIRMATION"],
    );
  },
);

test(
  "separates same-line labels and retains both character identities",
  () => {
    const parsed =
      parseRecruitmentDiscordPost(
        recruitmentDiscordPosts[1],
      );

    assert.equal(
      parsed.identityStatus,
      "MULTIPLE_IDENTITIES",
    );
    assert.deepEqual(
      identityNames(parsed),
      ["bloodalt", "stormhealz"],
    );
    assert.equal(
      parsed.fields.classSpec,
      "Resto/Ele Shaman, Blood/DPS DK, Mage",
    );
    assert.equal(parsed.fields.faction, "Alli");
    assert.equal(
      parsed.contact.discordUsername,
      "Stormhealz",
    );
  },
);

test(
  "uses structured profile links but not Warcraft Logs numeric IDs for identity",
  () => {
    const parsed =
      parseRecruitmentDiscordPost(
        recruitmentDiscordPosts[2],
      );

    assert.equal(
      parsed.identityStatus,
      "READY_FOR_CONFIRMATION",
    );
    assert.deepEqual(
      identityNames(parsed),
      ["steelward"],
    );
    assert.equal(
      parsed.contact.battleTag,
      "Steelward#2154",
    );
    assert.equal(
      parsed.links.warcraftLogs.length,
      2,
    );
    assert.equal(
      parsed.identityCandidates[0]
        .sources.includes("warcraft_logs"),
      false,
    );
  },
);

test(
  "merges matching Raider.IO, Warcraft Logs, and Armory identities",
  () => {
    const parsed =
      parseRecruitmentDiscordPost(
        recruitmentDiscordPosts[3],
      );

    assert.equal(
      parsed.identityStatus,
      "READY_FOR_CONFIRMATION",
    );
    assert.deepEqual(
      parsed.identityCandidates[0],
      {
        characterName: "Felcaster",
        realm: "Area 52",
        realmSlug: "area-52",
        region: "US",
        sources: [
          "raider_io",
          "warcraft_logs",
          "armory",
        ],
      },
    );
    assert.match(
      parsed.fields.availability,
      /Sun - Thursday/,
    );
  },
);

test(
  "captures Discord timestamps, BattleTag, mention, and multiple healer identities",
  () => {
    const parsed =
      parseRecruitmentDiscordPost(
        recruitmentDiscordPosts[4],
      );

    assert.equal(
      parsed.identityStatus,
      "MULTIPLE_IDENTITIES",
    );
    assert.deepEqual(
      identityNames(parsed),
      ["lightpally", "mistalt"],
    );
    assert.equal(
      parsed.contact.battleTag,
      "Lightward#1890",
    );
    assert.equal(
      parsed.contact.discordUserId,
      "123456789012345678",
    );
    assert.match(
      parsed.fields.availability,
      /<t:1786096800:t>/,
    );
  },
);
