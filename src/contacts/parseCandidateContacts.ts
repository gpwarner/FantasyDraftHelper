export type ContactSource =
  | "profile"
  | "azerite_about";

export interface ContactMatch {
  value: string;
  source: ContactSource;

  /**
   * The original line where the value was found.
   * This helps officers verify the parser's result.
   */
  evidence: string;
}

export interface CandidateContacts {
  battleTag?: ContactMatch;

  /**
   * A Discord username such as:
   * touchfuzzygetdizzy7_7
   *
   * This is not necessarily a numeric Discord user ID.
   */
  discordUsername?: ContactMatch;

  /**
   * Discord's numeric snowflake ID, when the applicant
   * supplied a mention, users URL, or explicit numeric ID.
   */
  discordUserId?: ContactMatch;
}

export interface CandidateContactInput {
  /**
   * Full profile text from an approved provider.
   * This source has first priority.
   */
  profileText?: string;

  /**
   * The About field included in Azerite's Discord card.
   * This is used to fill fields missing from profileText.
   */
  azeriteAboutText?: string;
}

interface SourceResult {
  battleTag?: ContactMatch;
  discordUsername?: ContactMatch;
  discordUserId?: ContactMatch;
}

const battleTagLabelPattern =
  /\b(?:battle\s*tag|battletag|battle\.?\s*net|bnet|btag)\b/i;

const discordLabelPattern =
  /\bdiscord\b/i;

/**
 * BattleTags normally resemble:
 *
 * Esmer#11149
 */
const battleTagValuePattern =
  /([\p{L}\p{N}][\p{L}\p{N}'’_-]{1,31}#\d{4,10})/u;

const invalidDiscordValues = new Set([
  "none",
  "n/a",
  "na",
  "unknown",
  "notprovided",
  "not_provided",
]);

function cleanLine(line: string): string {
  return line
    .replace(/^\s*[•*-]\s*/, "")
    .replaceAll("**", "")
    .replaceAll("`", "")
    .trim();
}

function getLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);
}

function getTextAfterLabel(
  line: string,
  labelPattern: RegExp,
): string | undefined {
  const match = line.match(labelPattern);

  if (
    !match ||
    match.index === undefined
  ) {
    return undefined;
  }

  return line
    .slice(match.index + match[0].length)
    .replace(
      /^\s*(?:id|username|user|handle|tag|name)?\s*(?::|=|[-–—]|\bis\b)?\s*/i,
      "",
    )
    .trim();
}

function extractBattleTag(
  value: string,
): string | undefined {
  const match = value.match(
    battleTagValuePattern,
  );

  return match?.[1];
}

function isValidDiscordUsername(
  value: string,
): boolean {
  const normalized = value.toLowerCase();

  if (invalidDiscordValues.has(normalized)) {
    return false;
  }

  if (value.length < 2 || value.length > 37) {
    return false;
  }

  return /[a-z0-9]/i.test(value);
}

function extractDiscordDetails(
  value: string,
): {
  username?: string;
  userId?: string;
} {
  /*
   * Discord mention:
   *
   * <@123456789012345678>
   * <@!123456789012345678>
   */
  const mentionMatch = value.match(
    /<@!?(\d{17,20})>/,
  );

  /*
   * Discord user URL:
   *
   * https://discord.com/users/123456789012345678
   */
  const userUrlMatch = value.match(
    /discord(?:app)?\.com\/users\/(\d{17,20})/i,
  );

  /*
   * An explicit raw numeric ID may also appear after
   * a label such as "Discord ID:".
   */
  const numericIdMatch = value.match(
    /\b(\d{17,20})\b/,
  );

  const userId =
    mentionMatch?.[1] ??
    userUrlMatch?.[1] ??
    numericIdMatch?.[1];

  /*
   * Legacy Discord tags are still sometimes included
   * in old recruitment profiles:
   *
   * SomeName#1234
   */
  const legacyUsernameMatch = value.match(
    /@?([a-z0-9._-]{2,32}#\d{4})/i,
  );

  if (legacyUsernameMatch?.[1]) {
    return {
      username: legacyUsernameMatch[1],
      userId,
    };
  }

  /*
   * Modern Discord usernames:
   *
   * touchfuzzygetdizzy7_7
   * some.user
   * @some_user
   */
  const modernUsernameMatch = value.match(
    /(?:^|[\s@])([a-z0-9._]{2,32})(?=$|[\s,;|)\]])/i,
  );

  const possibleUsername =
    modernUsernameMatch?.[1];

  const username =
    possibleUsername &&
    isValidDiscordUsername(possibleUsername)
      ? possibleUsername
      : undefined;

  return {
    username,
    userId,
  };
}

function parseSource(
  text: string | undefined,
  source: ContactSource,
): SourceResult {
  const result: SourceResult = {};

  if (!text?.trim()) {
    return result;
  }

  const lines = getLines(text);

  for (const line of lines) {
    if (
      !result.battleTag &&
      battleTagLabelPattern.test(line)
    ) {
      const labeledValue =
        getTextAfterLabel(
          line,
          battleTagLabelPattern,
        );

      const battleTag = extractBattleTag(
        labeledValue ?? line,
      );

      if (battleTag) {
        result.battleTag = {
          value: battleTag,
          source,
          evidence: line,
        };
      }
    }

    if (
      (!result.discordUsername ||
        !result.discordUserId) &&
      discordLabelPattern.test(line)
    ) {
      const labeledValue =
        getTextAfterLabel(
          line,
          discordLabelPattern,
        );

      const discord = extractDiscordDetails(
        labeledValue ?? line,
      );

      if (
        discord.username &&
        !result.discordUsername
      ) {
        result.discordUsername = {
          value: discord.username,
          source,
          evidence: line,
        };
      }

      if (
        discord.userId &&
        !result.discordUserId
      ) {
        result.discordUserId = {
          value: discord.userId,
          source,
          evidence: line,
        };
      }
    }
  }

  return result;
}

/**
 * Parse profile text first. Then use Azerite's About
 * field to fill any values that were not found there.
 */
export function parseCandidateContacts(
  input: CandidateContactInput,
): CandidateContacts {
  const profileContacts = parseSource(
    input.profileText,
    "profile",
  );

  const azeriteContacts = parseSource(
    input.azeriteAboutText,
    "azerite_about",
  );

  return {
    battleTag:
      profileContacts.battleTag ??
      azeriteContacts.battleTag,

    discordUsername:
      profileContacts.discordUsername ??
      azeriteContacts.discordUsername,

    discordUserId:
      profileContacts.discordUserId ??
      azeriteContacts.discordUserId,
  };
}