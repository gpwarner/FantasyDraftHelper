const healingSpecializationsByClass = new Map<
  string,
  ReadonlySet<string>
>([
  ["druid", new Set(["restoration"])],
  ["evoker", new Set(["preservation"])],
  ["monk", new Set(["mistweaver"])],
  ["paladin", new Set(["holy"])],
  ["priest", new Set(["discipline", "holy"])],
  ["shaman", new Set(["restoration"])],
]);

function normalizeCharacterLabel(
  value: string | undefined,
): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized || undefined;
}

export function canClassHeal(
  className: string | undefined,
): boolean {
  const normalizedClass =
    normalizeCharacterLabel(className);

  return normalizedClass
    ? healingSpecializationsByClass.has(
        normalizedClass,
      )
    : false;
}

export function isHealingSpecialization(
  className: string | undefined,
  specName: string | undefined,
): boolean {
  const normalizedClass =
    normalizeCharacterLabel(className);
  const normalizedSpec =
    normalizeCharacterLabel(specName);

  if (!normalizedClass || !normalizedSpec) {
    return false;
  }

  return healingSpecializationsByClass
    .get(normalizedClass)
    ?.has(normalizedSpec) ?? false;
}
