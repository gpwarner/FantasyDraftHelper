import type { Message } from "discord.js";

interface RawComponent {
  type?: number;
  content?: unknown;
  label?: unknown;
  url?: unknown;
  components?: unknown;
  accessory?: unknown;
}

export interface NumericRange {
  minimum: number;
  maximum: number;
}

export interface AzeriteSchedule {
  rawText: string;
  daySummary?: string;
  timezone?: string;
  daysPerWeek?: NumericRange;
  hoursPerDay?: NumericRange;
}

export interface WarcraftLogsBossResult {
  bossName: string;
  percentile: number;
}

export interface AzeriteCandidate {
  source: {
    messageId: string;
    messageUrl: string;
    createdAt: string;
  };

  character: {
    name: string;
    realm: string;
    region: string;
    className: string;
    role: string;
    spec: string;
  };

  about?: string;
  schedule?: AzeriteSchedule;

  general: {
    language?: string;
    faction?: string;
  };

  scores: {
    itemLevel?: number;
    mythicPlusScore?: number;
  };

  raidProgression: Record<string, string>;

warcraftLogs: {
  metric?: "dps" | "hps";

  overall?: number;

  bestPerformanceAverage?: number;
  medianPerformanceAverage?: number;

  bosses: Array<
    WarcraftLogsBossResult & {
      medianPercentile?: number;
      totalKills?: number;
    }
  >;

  source?: "azerite" | "warcraftlogs_api";
  error?: string;
};

  links: {
    armory?: string;
    raiderIo?: string;
    raiderIoRecruitment?: string;
    wowProgress?: string;
    warcraftLogs?: string;
  };
}

interface CollectedComponentData {
  textBlocks: string[];
  links: Map<string, string>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Recursively walk Discord Components V2.
 *
 * Azerite uses:
 * - Containers
 * - Sections
 * - Text display components
 * - Action rows
 * - Link buttons
 *
 * We do not depend on their numeric component types here. We simply collect
 * every content field and every labeled URL.
 */
function walkComponent(
  value: unknown,
  collected: CollectedComponentData,
): void {
  if (Array.isArray(value)) {
    for (const child of value) {
      walkComponent(child, collected);
    }

    return;
  }

  if (!isObject(value)) {
    return;
  }

  if (typeof value.content === "string") {
    collected.textBlocks.push(value.content.trim());
  }

  if (
    typeof value.label === "string" &&
    typeof value.url === "string"
  ) {
    collected.links.set(value.label.trim(), value.url);
  }

  if (Array.isArray(value.components)) {
    walkComponent(value.components, collected);
  }

  if (value.accessory !== undefined) {
    walkComponent(value.accessory, collected);
  }
}

function collectComponentData(message: Message): CollectedComponentData {
  const collected: CollectedComponentData = {
    textBlocks: [],
    links: new Map<string, string>(),
  };

  const rawComponents = message.components.map(
    (component) => component.toJSON() as unknown as RawComponent,
  );

  walkComponent(rawComponents, collected);

  return collected;
}

/**
 * Parse lines formatted like:
 *
 * **Item Level** » 292
 * **M+ Score** » 3191
 *
 * Azerite also prefixes boss rows with a bullet, which this handles.
 */
function parseLabeledFields(text: string): Map<string, string> {
  const fields = new Map<string, string>();

  const fieldPattern =
    /(?:^|\n)(?:•\s*)?\*\*([^*]+)\*\*\s*»\s*([^\n]+)/g;

  for (const match of text.matchAll(fieldPattern)) {
    const label = match[1]?.trim();
    const value = match[2]?.trim();

    if (label && value) {
      fields.set(label, value);
    }
  }

  return fields;
}

function parseNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value.replaceAll(",", "").trim());

  return Number.isFinite(parsed) ? parsed : undefined;
}

function getRequiredMatch(
  value: string | undefined,
  description: string,
): string {
  if (!value) {
    throw new Error(
      `Could not find ${description} in the Azerite message.`,
    );
  }

  return value;
}

function findLink(
  links: Map<string, string>,
  label: string,
): string | undefined {
  for (const [currentLabel, url] of links) {
    if (currentLabel.toLowerCase() === label.toLowerCase()) {
      return url;
    }
  }

  return undefined;
}

export function parseAzeriteCandidate(
  message: Message,
): AzeriteCandidate {
  const { textBlocks, links } = collectComponentData(message);

  /*
   * Example:
   * ## [Isekaii](https://raider.io/characters/us/area-52/Isekaii)
   */
  const characterHeading = textBlocks.find((text) =>
    /^##\s+\[[^\]]+]\(https?:\/\/[^)]+\)/.test(text),
  );

  const schedule =
    parseAzeriteSchedule(textBlocks);

  const about = findSectionContent(
    textBlocks,
    "About",
  )?.replace(/^•\s*/, "").trim();

  const characterMatch = characterHeading?.match(
    /^##\s+\[([^\]]+)]\((https?:\/\/[^)]+)\)/,
  );

  const characterName = getRequiredMatch(
    characterMatch?.[1],
    "the character name",
  );

  const headingProfileUrl = characterMatch?.[2];

  /*
   * Example:
   * **Shaman · HEALING · Restoration**
   */
  const classLine = textBlocks.find((text) => {
    const cleaned = text.replaceAll("**", "");
    return cleaned.split("·").length === 3;
  });

  const classParts = classLine
    ?.replaceAll("**", "")
    .split("·")
    .map((part) => part.trim());

  const className = getRequiredMatch(
    classParts?.[0],
    "the character class",
  );

  const role = getRequiredMatch(
    classParts?.[1],
    "the character role",
  );

  const spec = getRequiredMatch(
    classParts?.[2],
    "the character specialization",
  );

  /*
   * Example:
   * Area 52 · US
   */
  const locationLine = textBlocks.find((text) =>
    /^[^*\n]+·\s*(US|EU|KR|TW|CN)$/i.test(text),
  );

  const locationParts = locationLine
    ?.split("·")
    .map((part) => part.trim());

  const realm = getRequiredMatch(
    locationParts?.[0],
    "the character realm",
  );

  const region = getRequiredMatch(
    locationParts?.[1],
    "the character region",
  ).toUpperCase();

  const generalBlock = textBlocks.find((text) =>
    text.includes("**Language**"),
  );

  const generalFields = generalBlock
    ? parseLabeledFields(generalBlock)
    : new Map<string, string>();

  const scoresBlock = textBlocks.find(
    (text) =>
      text.includes("**Item Level**") ||
      text.includes("**M+ Score**"),
  );

  const scoreFields = scoresBlock
    ? parseLabeledFields(scoresBlock)
    : new Map<string, string>();

  /*
   * Example:
   * **VS/DR/MQD** » 9/9M
   */
  const progressionBlock = textBlocks.find((text) =>
    /\*\*[^*]+\*\*\s*»\s*\d+\/\d+[A-Z]/i.test(text),
  );

  const progressionFields = progressionBlock
    ? parseLabeledFields(progressionBlock)
    : new Map<string, string>();

  /*
   * Example:
   * **Overall** » 41.0
   * • **Imperator Averzian** » 47.6
   */
  const warcraftLogsBlock = textBlocks.find((text) =>
    text.includes("**Overall**"),
  );

  const warcraftLogsFields = warcraftLogsBlock
    ? parseLabeledFields(warcraftLogsBlock)
    : new Map<string, string>();

  const bosses: WarcraftLogsBossResult[] = [];

  for (const [bossName, value] of warcraftLogsFields) {
    if (bossName.toLowerCase() === "overall") {
      continue;
    }

    const percentile = parseNumber(value);

    if (percentile !== undefined) {
      bosses.push({
        bossName,
        percentile,
      });
    }
  }

  const buttonRaiderIoUrl = findLink(links, "Raider.IO");

  const raiderIoUrl = normalizeRaiderIoUrl(
    buttonRaiderIoUrl ??
      headingProfileUrl,
  );

  const raiderIoRecruitmentUrl = raiderIoUrl
    ? `${raiderIoUrl.replace(/\/+$/, "")}/recruitment`
    : undefined;

  return {
    source: {
      messageId: message.id,
      messageUrl: message.url,
      createdAt: message.createdAt.toISOString(),
    },

    character: {
      name: characterName,
      realm,
      region,
      className,
      role,
      spec,
    },

    about,
    schedule,
    general: {
      language: generalFields.get("Language"),
      faction: generalFields.get("Faction"),
    },

    scores: {
      itemLevel: parseNumber(scoreFields.get("Item Level")),
      mythicPlusScore: parseNumber(scoreFields.get("M+ Score")),
    },

    raidProgression: Object.fromEntries(progressionFields),

    warcraftLogs: {
      overall: parseNumber(warcraftLogsFields.get("Overall")),
      bosses,
      source: "azerite",
    },

    links: {
      armory: findLink(links, "Armory"),
      raiderIo: raiderIoUrl,
      raiderIoRecruitment: raiderIoRecruitmentUrl,
      wowProgress: findLink(links, "WoWProgress"),
      warcraftLogs: findLink(links, "WarcraftLogs"),
    },
  };
}

function findSectionContent(
  textBlocks: string[],
  sectionName: string,
): string | undefined {
  const expectedHeading =
    `### ${sectionName}`.toLowerCase();

  const headingIndex = textBlocks.findIndex(
    (text) =>
      text.trim().toLowerCase() === expectedHeading,
  );

  if (headingIndex === -1) {
    return undefined;
  }

  const content =
    textBlocks[headingIndex + 1]?.trim();

  if (
    !content ||
    content.startsWith("###")
  ) {
    return undefined;
  }

  return content;
}

function parseNumericRange(
  text: string,
  pattern: RegExp,
): NumericRange | undefined {
  const match = text.match(pattern);

  if (!match?.[1]) {
    return undefined;
  }

  const minimum = Number(match[1]);
  const maximum = match[2]
    ? Number(match[2])
    : minimum;

  if (
    !Number.isFinite(minimum) ||
    !Number.isFinite(maximum)
  ) {
    return undefined;
  }

  return {
    minimum,
    maximum,
  };
}

function parseAzeriteSchedule(
  textBlocks: string[],
): AzeriteSchedule | undefined {
  const rawText = findSectionContent(
    textBlocks,
    "Schedule",
  );

  if (!rawText) {
    return undefined;
  }

  const fields =
    parseLabeledFields(rawText);

  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const daySummary = lines.find(
    (line) =>
      !line.includes("**Timezone**") &&
      !/Days?\s*\/\s*Week/i.test(line) &&
      !/Hours?\s*\/\s*Day/i.test(line),
  );

  const daysPerWeek = parseNumericRange(
    rawText,
    /(\d+)(?:\s*[-–—]\s*(\d+))?\s*Days?\s*\/\s*Week/i,
  );

  const hoursPerDay = parseNumericRange(
    rawText,
    /(\d+)(?:\s*[-–—]\s*(\d+))?\s*Hours?\s*\/\s*Day/i,
  );

  return {
    rawText,
    daySummary,
    timezone: fields.get("Timezone"),
    daysPerWeek,
    hoursPerDay,
  };
}

function normalizeRaiderIoUrl(
  url: string | undefined,
): string | undefined {
  if (!url) {
    return undefined;
  }

  return url
    .replace(/%27/gi, "")
    .replaceAll("'", "")
    .replaceAll("’", "");
}
