export type RecruitmentPostField =
  | "classSpec"
  | "faction"
  | "progression"
  | "contact"
  | "raiderIo"
  | "warcraftLogs"
  | "armory"
  | "availability"
  | "notes";

export type RecruitmentIdentitySource =
  | "raider_io"
  | "warcraft_logs"
  | "armory";

export interface RecruitmentIdentityCandidate {
  characterName: string;
  realm: string;
  realmSlug: string;
  region: string;
  sources: RecruitmentIdentitySource[];
}

export interface ParsedRecruitmentContact {
  raw?: string;
  battleTag?: string;
  discordUsername?: string;
  discordUserId?: string;
}

export type RecruitmentIdentityStatus =
  | "READY_FOR_CONFIRMATION"
  | "MULTIPLE_IDENTITIES"
  | "MISSING_IDENTITY";

export interface RecruitmentPostLinks {
  all: string[];
  raiderIo: string[];
  warcraftLogs: string[];
  armory: string[];
}

export interface ParsedRecruitmentGroupMember {
  memberNumber: number;
  classSpec?: string;
  faction?: string;
  progressionRaw?: string;
  progression: string[];
  availability?: string;
  identityCandidates: RecruitmentIdentityCandidate[];
  identityStatus: RecruitmentIdentityStatus;
  links: RecruitmentPostLinks;
}

export interface ParsedRecruitmentGroup {
  declaredCount?: number;
  guildType?: string;
  additionalInformation?: string;
  members: ParsedRecruitmentGroupMember[];
}

export interface ParsedRecruitmentDiscordPost {
  postType: "INDIVIDUAL" | "GROUP";
  fields: Partial<
    Record<RecruitmentPostField, string>
  >;
  identityCandidates:
    RecruitmentIdentityCandidate[];
  identityStatus:
    RecruitmentIdentityStatus;
  progression: string[];
  contact: ParsedRecruitmentContact;
  links: RecruitmentPostLinks;
  group?: ParsedRecruitmentGroup;
}

interface FieldLabelMatch {
  key: RecruitmentPostField;
  index: number;
  valueStart: number;
}

interface ParsedCharacterUrl {
  characterName: string;
  realmSlug: string;
  region: string;
  source: RecruitmentIdentitySource;
}

type RecruitmentGroupSection =
  | "numberOfPeople"
  | "contact"
  | "guildType"
  | "classSpec"
  | "faction"
  | "progression"
  | "raiderIo"
  | "warcraftLogs"
  | "armory"
  | "availability"
  | "additionalInformation";

interface GroupSectionLabelMatch {
  key: RecruitmentGroupSection;
  index: number;
  valueStart: number;
}

interface ParticipantValueMap {
  shared?: string;
  members: Map<number, string>;
}

const fieldLabelPattern = new RegExp(
  [
    String.raw`(?<!\S)[_*]*(`,
    String.raw`Class\s*\/\s*Spec`,
    String.raw`|Faction`,
    String.raw`|Current\s*&\s*Recent\s+Progress`,
    String.raw`|Current\s+Progress`,
    String.raw`|Contact\s+Preference(?:\s+Discord)?`,
    String.raw`|B(?:attle)?\s*Tag`,
    String.raw`|Raider\s*\.?\s*IO`,
    String.raw`|Warcraft\s+Logs(?:\s+[^:\n]{1,24})?`,
    String.raw`|Armory`,
    String.raw`|Availability`,
    String.raw`|Notes?`,
    String.raw`)[_*]*\s*(?::|[-–—])[_*]*\s*`,
  ].join(""),
  "gim",
);

const urlPattern =
  /https?:\/\/[^\s<>]+/gi;

const groupFieldLabelPattern = new RegExp(
  [
    String.raw`(?<!\S)[_*]*(`,
    String.raw`Number\s+of\s+People\s+Looking`,
    String.raw`|Contact`,
    String.raw`|Type\s+of\s+Guild\s+Looking\s+For`,
    String.raw`|Class\s*\/\s*Spec`,
    String.raw`|(?:Any\s+)?Faction`,
    String.raw`|Cleared`,
    String.raw`|Raider\s*\.?\s*IO`,
    String.raw`|Warcraft\s+Logs`,
    String.raw`|Armory`,
    String.raw`|Availability`,
    String.raw`|Additional\s+(?:information|info)`,
    String.raw`)[_*]*\s*:[_*]*\s*`,
  ].join(""),
  "gim",
);

const participantMarkerPattern =
  /(?:^|\n)\s*(\d+)\s*:\s*|(?<!\S)P(?:erson)?\s*(\d+)\s*:\s*|(?<!\S)(Both)\s*:\s*/gim;

function getFieldKey(
  label: string,
): RecruitmentPostField {
  const normalized = label
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (normalized.startsWith("class")) {
    return "classSpec";
  }

  if (normalized === "faction") {
    return "faction";
  }

  if (normalized.startsWith("current")) {
    return "progression";
  }

  if (
    normalized.startsWith("contact") ||
    normalized.includes("tag")
  ) {
    return "contact";
  }

  if (normalized.startsWith("raider")) {
    return "raiderIo";
  }

  if (normalized.startsWith("warcraft")) {
    return "warcraftLogs";
  }

  if (normalized === "armory") {
    return "armory";
  }

  if (normalized === "availability") {
    return "availability";
  }

  return "notes";
}

function cleanFieldValue(
  value: string,
): string {
  return value
    .replace(/^\s+|\s+$/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function parseLabeledFields(
  content: string,
): ParsedRecruitmentDiscordPost["fields"] {
  const matches: FieldLabelMatch[] = [];

  for (const match of content.matchAll(
    fieldLabelPattern,
  )) {
    if (
      match.index === undefined ||
      !match[1]
    ) {
      continue;
    }

    matches.push({
      key: getFieldKey(match[1]),
      index: match.index,
      valueStart:
        match.index + match[0].length,
    });
  }

  const fields:
    ParsedRecruitmentDiscordPost["fields"] =
    {};

  for (
    let index = 0;
    index < matches.length;
    index += 1
  ) {
    const match = matches[index];
    const nextMatch = matches[index + 1];
    const value = cleanFieldValue(
      content.slice(
        match.valueStart,
        nextMatch?.index ?? content.length,
      ),
    );

    if (!value) {
      continue;
    }

    const existing = fields[match.key];
    fields[match.key] = existing
      ? `${existing}\n${value}`
      : value;
  }

  return fields;
}

function cleanUrl(url: string): string {
  return url.replace(/[),.;]+$/g, "");
}

function uniqueStrings(
  values: readonly string[],
): string[] {
  return [
    ...new Set(
      values.map((value) => value.trim()),
    ),
  ].filter(Boolean);
}

function getIdentityStatus(
  identities: readonly RecruitmentIdentityCandidate[],
): RecruitmentIdentityStatus {
  if (identities.length === 0) {
    return "MISSING_IDENTITY";
  }

  return identities.length === 1
    ? "READY_FOR_CONFIRMATION"
    : "MULTIPLE_IDENTITIES";
}

function categorizeLinks(
  content: string,
): RecruitmentPostLinks {
  const all = uniqueStrings(
    [...content.matchAll(urlPattern)].map(
      (match) => cleanUrl(match[0]),
    ),
  );

  return {
    all,
    raiderIo: all.filter((url) =>
      /\/\/([^/]+\.)?raider\.io\//i.test(url),
    ),
    warcraftLogs: all.filter((url) =>
      /\/\/([^/]+\.)?warcraftlogs\.com\//i.test(url),
    ),
    armory: all.filter((url) =>
      /\/\/worldofwarcraft\.blizzard\.com\//i.test(url),
    ),
  };
}

function parseProgression(
  value: string | undefined,
): string[] {
  return uniqueStrings(
    [
      ...(value ?? "").matchAll(
        /\b(\d+\s*\/\s*\d+\s*M?)\b/gi,
      ),
    ].map((match) =>
      match[1].replace(/\s+/g, ""),
    ),
  );
}

function getGroupSectionKey(
  label: string,
): RecruitmentGroupSection {
  const normalized = label
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (normalized.startsWith("number")) {
    return "numberOfPeople";
  }

  if (normalized === "contact") {
    return "contact";
  }

  if (normalized.startsWith("type")) {
    return "guildType";
  }

  if (normalized.startsWith("class")) {
    return "classSpec";
  }

  if (normalized.includes("faction")) {
    return "faction";
  }

  if (normalized === "cleared") {
    return "progression";
  }

  if (normalized.startsWith("raider")) {
    return "raiderIo";
  }

  if (normalized.startsWith("warcraft")) {
    return "warcraftLogs";
  }

  if (normalized === "armory") {
    return "armory";
  }

  if (normalized === "availability") {
    return "availability";
  }

  return "additionalInformation";
}

function parseGroupSections(
  content: string,
): Partial<Record<RecruitmentGroupSection, string>> {
  const matches: GroupSectionLabelMatch[] = [];

  for (const match of content.matchAll(groupFieldLabelPattern)) {
    if (match.index === undefined || !match[1]) {
      continue;
    }

    matches.push({
      key: getGroupSectionKey(match[1]),
      index: match.index,
      valueStart: match.index + match[0].length,
    });
  }

  const sections: Partial<
    Record<RecruitmentGroupSection, string>
  > = {};

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const nextMatch = matches[index + 1];
    const value = cleanFieldValue(
      content.slice(
        match.valueStart,
        nextMatch?.index ?? content.length,
      ),
    );

    if (value) {
      sections[match.key] = value;
    }
  }

  return sections;
}

function parseParticipantValues(
  value: string | undefined,
): ParticipantValueMap {
  const result: ParticipantValueMap = {
    members: new Map<number, string>(),
  };

  if (!value) {
    return result;
  }

  const cleaned = value
    .replace(/^\s*\((?:required)\)\s*/i, "")
    .replace(/^\s*Include\s+time\s+zones?!?\s*/i, "")
    .trim();
  const markers = [...cleaned.matchAll(participantMarkerPattern)];

  if (markers.length === 0) {
    if (cleaned) {
      result.shared = cleaned;
    }

    return result;
  }

  const prefix = cleanFieldValue(
    cleaned.slice(0, markers[0].index),
  );

  if (prefix) {
    result.shared = prefix;
  }

  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const nextMarker = markers[index + 1];
    const memberValue = cleanFieldValue(
      cleaned.slice(
        (marker.index ?? 0) + marker[0].length,
        nextMarker?.index ?? cleaned.length,
      ),
    ).replace(/\s+P\d+(?:\s*\/\s*\d+)+\s*:\s*$/i, "");

    if (!memberValue) {
      continue;
    }

    if (marker[3]) {
      result.shared = memberValue;
      continue;
    }

    const memberNumber = Number.parseInt(
      marker[1] ?? marker[2],
      10,
    );
    const existing = result.members.get(memberNumber);
    result.members.set(
      memberNumber,
      existing ? `${existing}\n${memberValue}` : memberValue,
    );
  }

  return result;
}

function parseGroupPost(
  content: string,
): ParsedRecruitmentDiscordPost {
  const sections = parseGroupSections(content);
  const classSpecs = parseParticipantValues(sections.classSpec);
  const factions = parseParticipantValues(sections.faction);
  const progressionValues = parseParticipantValues(
    sections.progression,
  );
  const raiderIo = parseParticipantValues(sections.raiderIo);
  const warcraftLogs = parseParticipantValues(
    sections.warcraftLogs,
  );
  const armory = parseParticipantValues(sections.armory);
  const availability = parseParticipantValues(
    sections.availability,
  );
  const declaredCountMatch = sections.numberOfPeople?.match(/\d+/);
  const declaredCount = declaredCountMatch
    ? Number.parseInt(declaredCountMatch[0], 10)
    : undefined;
  const memberNumbers = new Set<number>();

  if (declaredCount && declaredCount > 0 && declaredCount <= 40) {
    for (let memberNumber = 1; memberNumber <= declaredCount; memberNumber += 1) {
      memberNumbers.add(memberNumber);
    }
  }

  for (const parsedValues of [
    classSpecs,
    factions,
    progressionValues,
    raiderIo,
    warcraftLogs,
    armory,
    availability,
  ]) {
    for (const memberNumber of parsedValues.members.keys()) {
      memberNumbers.add(memberNumber);
    }
  }

  const members = [...memberNumbers]
    .sort((left, right) => left - right)
    .map((memberNumber): ParsedRecruitmentGroupMember => {
      const memberLinkContent = [
        raiderIo.members.get(memberNumber) ?? raiderIo.shared,
        warcraftLogs.members.get(memberNumber) ?? warcraftLogs.shared,
        armory.members.get(memberNumber) ?? armory.shared,
      ]
        .filter((value): value is string => Boolean(value))
        .join("\n");
      const links = categorizeLinks(memberLinkContent);
      const identityCandidates = buildIdentityCandidates(links.all);
      const progressionRaw =
        progressionValues.members.get(memberNumber) ??
        progressionValues.shared;

      return {
        memberNumber,
        ...(classSpecs.members.get(memberNumber) ?? classSpecs.shared
          ? {
              classSpec:
                classSpecs.members.get(memberNumber) ?? classSpecs.shared,
            }
          : {}),
        ...(factions.members.get(memberNumber) ?? factions.shared
          ? {
              faction:
                factions.members.get(memberNumber) ?? factions.shared,
            }
          : {}),
        ...(progressionRaw ? { progressionRaw } : {}),
        progression: parseProgression(progressionRaw),
        ...(availability.members.get(memberNumber) ?? availability.shared
          ? {
              availability:
                availability.members.get(memberNumber) ?? availability.shared,
            }
          : {}),
        identityCandidates,
        identityStatus: getIdentityStatus(identityCandidates),
        links,
      };
    });
  const links = categorizeLinks(content);
  const identityCandidates = buildIdentityCandidates(links.all);
  const fields: ParsedRecruitmentDiscordPost["fields"] = {
    ...(sections.contact ? { contact: sections.contact } : {}),
    ...(sections.classSpec ? { classSpec: sections.classSpec } : {}),
    ...(sections.faction ? { faction: sections.faction } : {}),
    ...(sections.progression ? { progression: sections.progression } : {}),
    ...(sections.raiderIo ? { raiderIo: sections.raiderIo } : {}),
    ...(sections.warcraftLogs
      ? { warcraftLogs: sections.warcraftLogs }
      : {}),
    ...(sections.armory ? { armory: sections.armory } : {}),
    ...(sections.availability
      ? { availability: sections.availability }
      : {}),
    ...(sections.additionalInformation
      ? { notes: sections.additionalInformation }
      : {}),
  };

  return {
    postType: "GROUP",
    fields,
    identityCandidates,
    identityStatus: getIdentityStatus(identityCandidates),
    progression: uniqueStrings(
      members.flatMap((member) => member.progression),
    ),
    contact: parseContact(sections.contact),
    links,
    group: {
      ...(declaredCount ? { declaredCount } : {}),
      ...(sections.guildType ? { guildType: sections.guildType } : {}),
      ...(sections.additionalInformation
        ? { additionalInformation: sections.additionalInformation }
        : {}),
      members,
    },
  };
}

function decodeUrlPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function formatRealmName(
  realmSlug: string,
): string {
  return realmSlug
    .split("-")
    .filter(Boolean)
    .map(
      (part) =>
        `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`,
    )
    .join(" ");
}

function parseCharacterUrl(
  url: string,
): ParsedCharacterUrl | undefined {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(url);
  } catch {
    return undefined;
  }

  const host = parsedUrl.hostname
    .replace(/^www\./i, "")
    .toLowerCase();
  const parts = parsedUrl.pathname
    .split("/")
    .filter(Boolean)
    .map(decodeUrlPart);

  if (
    host === "raider.io" &&
    parts[0]?.toLowerCase() ===
      "characters" &&
    parts.length >= 4
  ) {
    return {
      region: parts[1].toUpperCase(),
      realmSlug: parts[2].toLowerCase(),
      characterName: parts[3],
      source: "raider_io",
    };
  }

  if (
    host === "warcraftlogs.com" &&
    parts[0]?.toLowerCase() ===
      "character" &&
    parts[1]?.toLowerCase() !== "id" &&
    parts.length >= 4
  ) {
    return {
      region: parts[1].toUpperCase(),
      realmSlug: parts[2].toLowerCase(),
      characterName: parts[3],
      source: "warcraft_logs",
    };
  }

  if (
    host ===
      "worldofwarcraft.blizzard.com" &&
    parts[1]?.toLowerCase() ===
      "character" &&
    parts.length >= 5
  ) {
    return {
      region: parts[2].toUpperCase(),
      realmSlug: parts[3].toLowerCase(),
      characterName: parts[4],
      source: "armory",
    };
  }

  return undefined;
}

function buildIdentityCandidates(
  urls: readonly string[],
): RecruitmentIdentityCandidate[] {
  const identities = new Map<
    string,
    RecruitmentIdentityCandidate
  >();

  for (const url of urls) {
    const parsed = parseCharacterUrl(url);

    if (!parsed) {
      continue;
    }

    const key = [
      parsed.region,
      parsed.realmSlug,
      parsed.characterName,
    ].join("/").toLowerCase();
    const existing = identities.get(key);

    if (existing) {
      if (
        !existing.sources.includes(
          parsed.source,
        )
      ) {
        existing.sources.push(
          parsed.source,
        );
      }

      continue;
    }

    identities.set(key, {
      characterName:
        parsed.characterName,
      realm:
        formatRealmName(
          parsed.realmSlug,
        ),
      realmSlug: parsed.realmSlug,
      region: parsed.region,
      sources: [parsed.source],
    });
  }

  return [...identities.values()];
}

function parseContact(
  raw: string | undefined,
): ParsedRecruitmentContact {
  if (!raw) {
    return {};
  }

  const battleTag = raw.match(
    /([\p{L}\p{N}][\p{L}\p{N}'’_-]{1,31}#\d{4,10})/u,
  )?.[1];
  const discordUserId = raw.match(
    /<@!?(\d{17,20})>/,
  )?.[1];
  const explicitUsername = raw.match(
    /(?<!<)@([a-z0-9._]{2,32})/i,
  )?.[1];
  const discordLabeledUsername =
    /\bdiscord\b/i.test(raw)
      ? raw
          .replace(/^.*?\bdiscord\b\s*(?::)?\s*/i, "")
          .match(/^([a-z0-9._]{2,32})/i)?.[1]
      : undefined;
  const bareUsername = raw
    .trim()
    .match(/^([a-z0-9._]{2,32})$/i)?.[1];

  return {
    raw,
    ...(battleTag ? { battleTag } : {}),
    ...(explicitUsername ||
    discordLabeledUsername ||
    bareUsername
      ? {
          discordUsername:
            explicitUsername ??
            discordLabeledUsername ??
            bareUsername,
        }
      : {}),
    ...(discordUserId
      ? { discordUserId }
      : {}),
  };
}

export function parseRecruitmentDiscordPost(
  content: string,
): ParsedRecruitmentDiscordPost {
  if (
    /\bNumber\s+of\s+People\s+Looking\s*:/i.test(
      content.replace(/[*_]/g, ""),
    )
  ) {
    return parseGroupPost(content);
  }

  const fields = parseLabeledFields(content);
  const links = categorizeLinks(content);
  const identityCandidates =
    buildIdentityCandidates(links.all);
  const progression = parseProgression(
    fields.progression,
  );

  return {
    postType: "INDIVIDUAL",
    fields,
    identityCandidates,
    identityStatus:
      getIdentityStatus(identityCandidates),
    progression,
    contact: parseContact(
      fields.contact,
    ),
    links,
  };
}
