import type {
  AzeriteCandidate,
} from "../candidates/parseAzeriteCandidate.js";

import type {
  RecruitmentDiscordIntake,
} from "./recruitmentDiscordIntake.js";

import type {
  RecruitmentIdentityCandidate,
  RecruitmentPostLinks,
} from "./parseRecruitmentDiscordPost.js";

export interface ConfirmedRecruitmentDiscordCandidate {
  intake: RecruitmentDiscordIntake;
  identity: RecruitmentIdentityCandidate;
  memberNumber?: number;
  classSpecRaw?: string;
  progressionRaw?: string;
  availability?: string;
  classNameOverride?: string;
  specOverride?: string;
}

const classNames = [
  "Death Knight",
  "Demon Hunter",
  "Druid",
  "Evoker",
  "Hunter",
  "Mage",
  "Monk",
  "Paladin",
  "Priest",
  "Rogue",
  "Shaman",
  "Warlock",
  "Warrior",
] as const;

const classAliases = new Map<string, string>([
  ["dk", "Death Knight"],
  ["dh", "Demon Hunter"],
  ["pally", "Paladin"],
  ["pal", "Paladin"],
  ["hpal", "Paladin"],
  ["rsham", "Shaman"],
]);

const specializationPatterns = new Map<string, RegExp>([
  ["Arcane", /\barcane\b/i],
  ["Arms", /\barms\b/i],
  ["Balance", /\bbalance\b|\bboom(?:y|kin)\b/i],
  ["Blood", /\bblood\b|\bbdk\b/i],
  ["Devourer", /\bdevourer\b/i],
  ["Discipline", /\bdisc(?:ipline)?\b/i],
  ["Elemental", /\belemental\b|\bele\b/i],
  ["Feral", /\bferal\b/i],
  ["Fury", /\bfury\b/i],
  ["Guardian", /\bguardian\b/i],
  ["Holy", /\bholy\b|\bhpal\b/i],
  ["Mistweaver", /\bmistweaver\b|\bmw\b/i],
  ["Protection", /\bprotection\b|\bprot\b/i],
  ["Restoration", /\bresto(?:ration)?\b|\brsham\b/i],
  ["Shadow", /\bshadow\b/i],
  ["Subtlety", /\bsubtlety\b|\bsub\b/i],
]);

const healingSpecPatterns = [
  /\bresto(?:ration)?\b/i,
  /\bmistweaver\b|\bmw\b/i,
  /\bholy\b|\bhpal\b/i,
  /\bdisc(?:ipline)?\b/i,
  /\bpreservation\b|\bpres\b/i,
];

const tankSpecPatterns = [
  /\bblood\b|\bbdk\b/i,
  /\bguardian\b|\bbear\b/i,
  /\bbrewmaster\b|\bbrew\b/i,
  /\bprotection\b|\bprot\b/i,
  /\bvengeance\b/i,
];

const damageSpecPatterns = [
  /\barcane\b/i,
  /\barms\b/i,
  /\bbalance\b|\bboom(?:y|kin)\b/i,
  /\bdevourer\b/i,
  /\belemental\b|\bele\b/i,
  /\bferal\b/i,
  /\bfury\b/i,
  /\bshadow\b/i,
  /\bsubtlety\b|\bsub\b/i,
  /\bdps\b/i,
];

const damageOnlyClasses = new Set([
  "Hunter",
  "Mage",
  "Rogue",
  "Warlock",
]);

function findClassName(
  raw: string | undefined,
): string | undefined {
  if (!raw) {
    return undefined;
  }

  const matches = new Set<string>();

  for (const className of classNames) {
    if (
      new RegExp(
        `\\b${className.replace(" ", "\\s+")}\\b`,
        "i",
      ).test(raw)
    ) {
      matches.add(className);
    }
  }

  for (const [alias, className] of classAliases) {
    if (new RegExp(`\\b${alias}\\b`, "i").test(raw)) {
      matches.add(className);
    }
  }

  return matches.size === 1
    ? [...matches][0]
    : undefined;
}

function inferRole(
  raw: string | undefined,
  className?: string,
): string | undefined {
  if (!raw) {
    return undefined;
  }

  const hasHealing = healingSpecPatterns.some((pattern) =>
    pattern.test(raw),
  );
  const hasTank = tankSpecPatterns.some((pattern) =>
    pattern.test(raw),
  );
  const hasDamage = damageSpecPatterns.some((pattern) =>
    pattern.test(raw),
  );
  const roleCount = [hasHealing, hasTank, hasDamage]
    .filter(Boolean)
    .length;

  if (roleCount > 1) {
    return undefined;
  }

  if (hasHealing) {
    return "HEALING";
  }

  if (hasTank) {
    return "TANK";
  }

  if (hasDamage || (className && damageOnlyClasses.has(className))) {
    return "DPS";
  }

  return undefined;
}

export function inferRecruitmentCharacterMetadata(
  raw: string | undefined,
): {
  className?: string;
  spec?: string;
  role?: string;
} {
  const className = findClassName(raw);
  const matchingSpecs = raw
    ? [...specializationPatterns]
        .filter(([, pattern]) => pattern.test(raw))
        .map(([spec]) => spec)
    : [];

  return {
    ...(className ? { className } : {}),
    ...(matchingSpecs.length === 1
      ? { spec: matchingSpecs[0] }
      : {}),
    ...(inferRole(raw, className)
      ? { role: inferRole(raw, className) }
      : {}),
  };
}

function findMatchingUrl(
  links: RecruitmentPostLinks,
  identity: RecruitmentIdentityCandidate,
  category: keyof Omit<RecruitmentPostLinks, "all">,
): string | undefined {
  const characterName = identity.characterName.toLowerCase();
  const realmSlug = identity.realmSlug.toLowerCase();

  return links[category].find((url) => {
    try {
      const parts = new URL(url).pathname
        .split("/")
        .filter(Boolean)
        .map((part) => decodeURIComponent(part).toLowerCase());

      return (
        parts.includes(characterName) &&
        parts.includes(realmSlug)
      );
    } catch {
      return false;
    }
  });
}

export function createRecruitmentDiscordCandidate(
  confirmed: ConfirmedRecruitmentDiscordCandidate,
): AzeriteCandidate {
  const {
    intake,
    identity,
  } = confirmed;
  const member = confirmed.memberNumber
    ? intake.parsed.group?.members.find(
        (candidateMember) =>
          candidateMember.memberNumber === confirmed.memberNumber,
      )
    : undefined;
  const links = member?.links ?? intake.parsed.links;
  const classSpecRaw = confirmed.classSpecRaw ??
    member?.classSpec ??
    intake.parsed.fields.classSpec;
  const inferredMetadata =
    inferRecruitmentCharacterMetadata(classSpecRaw);
  const className = confirmed.classNameOverride?.trim() ||
    inferredMetadata.className;
  const spec = confirmed.specOverride?.trim() ||
    inferredMetadata.spec;
  const role = inferRole(spec ?? classSpecRaw, className);
  const progressionRaw = confirmed.progressionRaw ??
    member?.progressionRaw ??
    intake.parsed.fields.progression;
  const availability = confirmed.availability ??
    member?.availability ??
    intake.parsed.fields.availability;
  const raiderIo = findMatchingUrl(links, identity, "raiderIo");

  return {
    source: {
      type: "RECRUITMENT_DISCORD",
      messageId: intake.sourceMessageId,
      messageUrl: intake.sourceMessageUrl,
      createdAt: intake.submittedAt,
      submittedByDiscordUserId: intake.submittedByDiscordUserId,
    },
    character: {
      name: identity.characterName,
      realm: identity.realm,
      region: identity.region,
      className,
      role,
      spec,
    },
    about: [
      intake.parsed.fields.contact,
      intake.parsed.fields.notes,
    ].filter(Boolean).join("\n"),
    ...(availability
      ? {
          schedule: {
            rawText: availability,
            daySummary: availability,
          },
        }
      : {}),
    general: {
      faction: member?.faction ?? intake.parsed.fields.faction,
    },
    scores: {},
    raidProgression: progressionRaw
      ? { "Recruitment Discord": progressionRaw }
      : {},
    warcraftLogs: {
      bosses: [],
    },
    links: {
      raiderIo,
      warcraftLogs: findMatchingUrl(
        links,
        identity,
        "warcraftLogs",
      ),
      armory: findMatchingUrl(links, identity, "armory"),
    },
  };
}
