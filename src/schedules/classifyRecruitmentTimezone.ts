export type RecruitmentTimezoneClassification =
  | "ALLOWED"
  | "OUTSIDE_ALLOWED_REGION"
  | "INVALID";

export interface RecruitmentTimezoneResult {
  classification:
    RecruitmentTimezoneClassification;
  canonicalTimezone?: string;
}

/*
 * Canonical IANA zones whose zone.tab country code is US or CA.
 * Intl.DateTimeFormat canonicalizes supported legacy aliases such as
 * US/Eastern and Canada/Eastern before they reach this set.
 */
const allowedRecruitmentTimezones =
  new Set<string>([
    // Canada
    "America/Atikokan",
    "America/Blanc-Sablon",
    "America/Cambridge_Bay",
    "America/Creston",
    "America/Dawson",
    "America/Dawson_Creek",
    "America/Edmonton",
    "America/Fort_Nelson",
    "America/Glace_Bay",
    "America/Goose_Bay",
    "America/Halifax",
    "America/Inuvik",
    "America/Iqaluit",
    "America/Moncton",
    "America/Rankin_Inlet",
    "America/Regina",
    "America/Resolute",
    "America/St_Johns",
    "America/Swift_Current",
    "America/Toronto",
    "America/Vancouver",
    "America/Whitehorse",
    "America/Winnipeg",

    // United States
    "America/Adak",
    "America/Anchorage",
    "America/Boise",
    "America/Chicago",
    "America/Denver",
    "America/Detroit",
    "America/Indiana/Indianapolis",
    "America/Indiana/Knox",
    "America/Indiana/Marengo",
    "America/Indiana/Petersburg",
    "America/Indiana/Tell_City",
    "America/Indiana/Vevay",
    "America/Indiana/Vincennes",
    "America/Indiana/Winamac",
    "America/Juneau",
    "America/Kentucky/Louisville",
    "America/Kentucky/Monticello",
    "America/Los_Angeles",
    "America/Menominee",
    "America/Metlakatla",
    "America/New_York",
    "America/Nome",
    "America/North_Dakota/Beulah",
    "America/North_Dakota/Center",
    "America/North_Dakota/New_Salem",
    "America/Phoenix",
    "America/Sitka",
    "America/Yakutat",
    "Pacific/Honolulu",
  ]);

export function classifyRecruitmentTimezone(
  timezone: string,
): RecruitmentTimezoneResult {
  const normalizedTimezone =
    timezone.trim();

  if (!normalizedTimezone) {
    return {
      classification: "INVALID",
    };
  }

  let canonicalTimezone: string;

  try {
    canonicalTimezone =
      new Intl.DateTimeFormat(
        "en-US",
        {
          timeZone:
            normalizedTimezone,
        },
      ).resolvedOptions().timeZone;
  } catch {
    return {
      classification: "INVALID",
    };
  }

  return {
    classification:
      allowedRecruitmentTimezones.has(
        canonicalTimezone,
      )
        ? "ALLOWED"
        : "OUTSIDE_ALLOWED_REGION",
    canonicalTimezone,
  };
}
