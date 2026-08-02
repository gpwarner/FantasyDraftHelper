import type { Weekday } from "../config/guildRequirements.js";

export type AvailabilitySource =
  | "manual"
  | "azerite"
  | "raider_io"
  | "guilds_of_wow"
  | "wowprogress";

export interface AvailabilityWindow {
  day: Weekday;
  start: string;
  end: string;

  /**
   * True when the end time occurs on the following day.
   *
   * Example:
   * Monday 18:00 through Tuesday 00:30.
   */
  endsNextDay: boolean;
}

export interface CandidateAvailability {
  timezone: string;
  windows: AvailabilityWindow[];
  source: AvailabilitySource;
  notes?: string;
}