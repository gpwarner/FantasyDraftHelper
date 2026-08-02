import type { AzeriteCandidate } from "../candidates/parseAzeriteCandidate.js";
import type { CandidateAvailability } from "./types.js";

function normalizeKeyPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, "-");
}

function createCandidateKey(
  region: string,
  realm: string,
  characterName: string,
): string {
  return [
    normalizeKeyPart(region),
    normalizeKeyPart(realm),
    normalizeKeyPart(characterName),
  ].join("|");
}

/**
 * Temporary storage for manually entered schedules.
 *
 * This will eventually be replaced or supplemented by approved
 * Raider.IO, Azerite, Guilds of WoW, and WoWProgress providers.
 */
const manualAvailabilityByCharacter: Record<
  string,
  CandidateAvailability
> = {
  /*
   * Example only:
   *
   * "us|area-52|exampleplayer": {
   *   timezone: "America/New_York",
   *   source: "manual",
   *   windows: [
   *     {
   *       day: "Monday",
   *       start: "20:00",
   *       end: "00:30",
   *       endsNextDay: true,
   *     },
   *     {
   *       day: "Wednesday",
   *       start: "20:00",
   *       end: "00:30",
   *       endsNextDay: true,
   *     },
   *   ],
   * },
   */
};

export function getManualAvailability(
  candidate: AzeriteCandidate,
): CandidateAvailability | undefined {
  const key = createCandidateKey(
    candidate.character.region,
    candidate.character.realm,
    candidate.character.name,
  );

  return manualAvailabilityByCharacter[key];
}