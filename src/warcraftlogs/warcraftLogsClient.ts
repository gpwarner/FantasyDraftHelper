export type WarcraftLogsMetric =
  | "dps"
  | "hps";

export interface CharacterRankingsRequest {
  characterName: string;
  realm: string;
  region: string;

  /**
   * Optional so we can query every spec when the
   * Raider.IO-reported specialization appears incorrect.
   */
  specName?: string;

  role: string;

  /**
   * Allows a fallback HPS query even when Raider.IO
   * reported the player as DPS or tank.
   */
  metricOverride?: WarcraftLogsMetric;
}

export interface CharacterRankingsResult {
  metric: WarcraftLogsMetric;
  characterName: string;
  serverSlug: string;
  region: string;
  specName?: string;

  character: {
    id: number;
    name: string;
    hidden: boolean;
    serverSlug: string;
  } | null;

  zoneRankings: WarcraftLogsZoneRankings | null;

  rateLimit: {
    limitPerHour: number;
    pointsSpentThisHour: number;
    pointsResetIn: number;
  };
}

export interface WarcraftLogsEncounterRanking {
  encounter: {
    id: number;
    name: string;
  };

  rankPercent?: number | null;
  medianPercent?: number | null;
  totalKills?: number | null;
  spec?: string | null;
  bestSpec?: string | null;
}

export interface WarcraftLogsZoneRankings {
  bestPerformanceAverage?: number | null;
  medianPerformanceAverage?: number | null;
  difficulty?: number | null;
  metric?: WarcraftLogsMetric | null;
  zone?: number | null;
  rankings?: WarcraftLogsEncounterRanking[] | null;
}

interface WarcraftLogsTokenResponse {
  token_type: string;
  expires_in: number;
  access_token: string;
}

interface GraphQlError {
  message: string;
  path?: Array<string | number>;
  extensions?: Record<string, unknown>;
}

interface GraphQlResponse<T> {
  data?: T;
  errors?: GraphQlError[];
}

interface CharacterRankingsQueryData {
  characterData: {
    character: {
      id: number;
      name: string;
      hidden: boolean;

      server: {
        slug: string;
      };

      zoneRankings: WarcraftLogsZoneRankings | null;
    } | null;
  } | null;

  rateLimitData: {
    limitPerHour: number;
    pointsSpentThisHour: number;
    pointsResetIn: number;
  };
}

interface CachedToken {
  value: string;
  expiresAt: number;
}

const tokenEndpoint =
  "https://www.warcraftlogs.com/oauth/token";

const graphQlEndpoint =
  "https://www.warcraftlogs.com/api/v2/client";

let cachedToken: CachedToken | undefined;

function getRequiredEnvironmentVariable(
  name: string,
): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}.`,
    );
  }

  return value;
}

/**
 * Warcraft Logs uses Blizzard-style server slugs.
 *
 * Examples:
 * Area 52  -> area-52
 * Zul'jin  -> zuljin
 * Mal'Ganis -> malganis
 */
export function createWarcraftLogsServerSlug(
  realm: string,
): string {
  return realm
    .trim()
    .toLowerCase()
    .replace(/%27/gi, "")
    .replaceAll("'", "")
    .replaceAll("’", "")
    .replaceAll(/\s+/g, "-");
}

/**
 * Use healing rankings for healers.
 * Tanks and damage dealers use damage rankings.
 */
export function getWarcraftLogsMetric(
  role: string,
): WarcraftLogsMetric {
  return role.trim().toUpperCase() ===
    "HEALING"
    ? "hps"
    : "dps";
}

async function getAccessToken(): Promise<string> {
  /*
   * Reuse the token unless it expires within the
   * next minute.
   */
  if (
    cachedToken &&
    cachedToken.expiresAt >
      Date.now() + 60_000
  ) {
    return cachedToken.value;
  }

  const clientId =
    getRequiredEnvironmentVariable(
      "WCL_V2_CLIENT_ID",
    );

  const clientSecret =
    getRequiredEnvironmentVariable(
      "WCL_V2_CLIENT_SECRET",
    );

  const basicCredentials =
    Buffer.from(
      `${clientId}:${clientSecret}`,
      "utf8",
    ).toString("base64");

  const response = await fetch(
    tokenEndpoint,
    {
      method: "POST",

      headers: {
        Authorization:
          `Basic ${basicCredentials}`,

        "Content-Type":
          "application/x-www-form-urlencoded",
      },

      body: new URLSearchParams({
        grant_type:
          "client_credentials",
      }),
    },
  );

  const responseText =
    await response.text();

  if (!response.ok) {
    throw new Error(
      [
        "Warcraft Logs token request failed.",
        `HTTP ${response.status}`,
        responseText,
      ].join(" "),
    );
  }

  let tokenResponse:
    WarcraftLogsTokenResponse;

  try {
    tokenResponse =
      JSON.parse(
        responseText,
      ) as WarcraftLogsTokenResponse;
  } catch {
    throw new Error(
      "Warcraft Logs returned an invalid token response.",
    );
  }

  if (
    !tokenResponse.access_token ||
    !tokenResponse.expires_in
  ) {
    throw new Error(
      "Warcraft Logs token response did not contain the expected fields.",
    );
  }

  cachedToken = {
    value:
      tokenResponse.access_token,

    expiresAt:
      Date.now() +
      tokenResponse.expires_in *
        1000,
  };

  return cachedToken.value;
}

async function executeGraphQl<T>(
  query: string,
  variables: Record<
    string,
    unknown
  >,
): Promise<T> {
  const accessToken =
    await getAccessToken();

  const response = await fetch(
    graphQlEndpoint,
    {
      method: "POST",

      headers: {
        Authorization:
          `Bearer ${accessToken}`,

        "Content-Type":
          "application/json",
      },

      body: JSON.stringify({
        query,
        variables,
      }),
    },
  );

  const responseText =
    await response.text();

  if (!response.ok) {
    throw new Error(
      [
        "Warcraft Logs GraphQL request failed.",
        `HTTP ${response.status}`,
        responseText,
      ].join(" "),
    );
  }

  let graphQlResponse:
    GraphQlResponse<T>;

  try {
    graphQlResponse =
      JSON.parse(
        responseText,
      ) as GraphQlResponse<T>;
  } catch {
    throw new Error(
      "Warcraft Logs returned invalid JSON.",
    );
  }

  if (
    graphQlResponse.errors?.length
  ) {
    const messages =
      graphQlResponse.errors.map(
        (error) => error.message,
      );

    throw new Error(
      [
        "Warcraft Logs GraphQL error:",
        ...messages,
      ].join(" "),
    );
  }

  if (!graphQlResponse.data) {
    throw new Error(
      "Warcraft Logs response did not contain data.",
    );
  }

  return graphQlResponse.data;
}

const characterRankingsQuery = `
  query CharacterRankings(
    $characterName: String!
    $serverSlug: String!
    $serverRegion: String!
    $metric: CharacterPageRankingMetricType!
    $specName: String
  ) {
    characterData {
      character(
        name: $characterName
        serverSlug: $serverSlug
        serverRegion: $serverRegion
      ) {
        id
        name
        hidden

        server {
          slug
        }

        zoneRankings(
          metric: $metric
          specName: $specName
        )
      }
    }

    rateLimitData {
      limitPerHour
      pointsSpentThisHour
      pointsResetIn
    }
  }
`;

export async function getCharacterRankings(
  request: CharacterRankingsRequest,
): Promise<CharacterRankingsResult> {
  const metric =
    request.metricOverride ??
    getWarcraftLogsMetric(
        request.role,
    );

  const serverSlug =
    createWarcraftLogsServerSlug(
      request.realm,
    );

  const region =
    request.region
      .trim()
      .toLowerCase();

  const data =
    await executeGraphQl<CharacterRankingsQueryData>(
      characterRankingsQuery,
      {
        characterName:
          request.characterName,

        serverSlug,
        serverRegion: region,
        metric,

        /*
         * Use the specialization supplied by Azerite,
         * such as Discipline or Restoration.
         */
        specName:
          request.specName ?? null,
      },
    );

  const character =
    data.characterData?.character ??
    null;

  return {
    metric,
    characterName:
      request.characterName,
    serverSlug,
    region,
    specName:
      request.specName,

    character: character
      ? {
          id: character.id,
          name: character.name,
          hidden: character.hidden,
          serverSlug:
            character.server.slug,
        }
      : null,

zoneRankings:
  character?.zoneRankings ?? null,

    rateLimit: {
      limitPerHour:
        data.rateLimitData
          .limitPerHour,

      pointsSpentThisHour:
        data.rateLimitData
          .pointsSpentThisHour,

      pointsResetIn:
        data.rateLimitData
          .pointsResetIn,
    },
  };
}

export interface WarcraftLogsPerformanceSummary {
  metric: WarcraftLogsMetric;

  /**
   * Used for the guild's current overall parse requirement.
   */
  overall?: number;

  bestPerformanceAverage?: number;
  medianPerformanceAverage?: number;

  inferredSpec?: string;

  bosses: Array<{
    bossName: string;
    percentile: number;
    medianPercentile?: number;
    totalKills?: number;
  }>;
}

export async function getCharacterPerformanceSummary(
  request: CharacterRankingsRequest,
): Promise<WarcraftLogsPerformanceSummary> {
  const result =
    await getCharacterRankings(request);

  const rankings =
    result.zoneRankings;

  if (!result.character || !rankings) {
    return {
      metric: result.metric,
      bosses: [],
    };
  }

  const bestPerformanceAverage =
    getFiniteNumber(
      rankings.bestPerformanceAverage,
    );

  const medianPerformanceAverage =
    getFiniteNumber(
      rankings.medianPerformanceAverage,
    );

  const rawEncounterRankings =
    rankings.rankings ?? [];

  const inferredSpec =
    inferDominantSpec(
      rawEncounterRankings,
    );

  const bosses =
    rawEncounterRankings.flatMap(
    (ranking) => {
    const percentile =
      getFiniteNumber(
        ranking.rankPercent,
      );

    if (percentile === undefined) {
      return [];
    }

    const medianPercentile =
      getFiniteNumber(
        ranking.medianPercent,
      );

    const totalKills =
      getFiniteNumber(
        ranking.totalKills,
      );

    return [
      {
        bossName:
          ranking.encounter.name,

        percentile,

        ...(medianPercentile !== undefined
          ? { medianPercentile }
          : {}),

        ...(totalKills !== undefined
          ? { totalKills }
          : {}),
      },
    ];
  });

  return {
    metric: result.metric,

    overall:
      bestPerformanceAverage,

    bestPerformanceAverage,
    medianPerformanceAverage,
    bosses,
  };
}

function getFiniteNumber(
  value: unknown,
): number | undefined {
  return (
    typeof value === "number" &&
    Number.isFinite(value)
  )
    ? value
    : undefined;
}

function inferDominantSpec(
  rankings: WarcraftLogsEncounterRanking[],
): string | undefined {
  const scores =
    new Map<string, number>();

  for (const ranking of rankings) {
    const spec =
      ranking.bestSpec?.trim() ||
      ranking.spec?.trim();

    if (!spec) {
      continue;
    }

    /*
     * Weight the result by the number of kills.
     * A spec used for several kills is stronger evidence
     * than one used for a single encounter.
     */
    const totalKills =
      getFiniteNumber(
        ranking.totalKills,
      );

    const weight =
      totalKills !== undefined &&
      totalKills > 0
        ? totalKills
        : 1;

    scores.set(
      spec,
      (scores.get(spec) ?? 0) +
        weight,
    );
  }

  let dominantSpec:
    | string
    | undefined;

  let highestScore = -1;

  for (const [spec, score] of scores) {
    if (score > highestScore) {
      dominantSpec = spec;
      highestScore = score;
    }
  }

  return dominantSpec;
}