export type Weekday =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday"
  | "Sunday";

export type RosterNeed =
  | "high"
  | "open"
  | "low"
  | "closed";

export interface RaidWindow {
  day: Weekday;
  start: string;
  end: string;

  /**
   * True when the ending time occurs on the following calendar day.
   *
   * For example:
   * Monday 9:00 PM through Tuesday 12:00 AM.
   */
  endsNextDay: boolean;
  required: boolean;
}

export interface GuildRequirements {
  timezone: string;

  raidSchedule: RaidWindow[];

  warcraftLogs: {
    minimumOverallParse: number;

    /**
     * A closed-spec player must be strictly above this number
     * to receive manual review rather than an automatic failure.
     */
    exceptionalOverallParse: number;
  };

  roster: {
    /**
     * "open" means all classes and specs are currently considered.
     */
    defaultNeed: RosterNeed;

    /**
     * Add individual specs here as your needs change.
     *
     * Format:
     * "Specialization Class": "need"
     */
    overrides: Record<string, RosterNeed>;
  };
}

export const guildRequirements: GuildRequirements = {
  timezone: "America/New_York",

  raidSchedule: [
    {
      day: "Monday",
      start: "21:00",
      end: "00:00",
      endsNextDay: true,
      required: true,
    },
    {
      day: "Wednesday",
      start: "21:00",
      end: "00:00",
      endsNextDay: true,
      required: true,
    },
  ],

  warcraftLogs: {
    minimumOverallParse: 50,
    exceptionalOverallParse: 80,
  },

  roster: {
    // All classes and specs are currently accepted.
    defaultNeed: "open",

    // No spec-specific overrides yet.
    overrides: {},
  },
};

// SAMPLE OVERRIDES
  //  overrides: {
  //   "Balance Druid": "closed",
  //   "Restoration Druid": "high",
  //   "Discipline Priest": "low",
  //   "Augmentation Evoker": "open",
  // },
