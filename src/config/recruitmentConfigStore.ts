import {
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";

import {
  dirname,
  resolve,
} from "node:path";

export type RecruitmentRole =
  | "DPS"
  | "HEALING"
  | "TANK";

export type RecruitmentRosterMode =
  | "all"
  | "selected";

export interface RuntimeRosterConfig {
  mode: RecruitmentRosterMode;
  roles: RecruitmentRole[];
  specs: string[];
}

export interface RuntimeRecruitmentConfig {
  officerIds: string[];
  roster: RuntimeRosterConfig;
}

const validRoles = new Set<RecruitmentRole>([
  "DPS",
  "HEALING",
  "TANK",
]);

function uniqueStrings(
  values: readonly string[],
): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLowerCase();

    if (!trimmed || seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(trimmed);
  }

  return results;
}

function validateOfficerIds(
  officerIds: readonly string[],
): string[] {
  const normalized =
    uniqueStrings(officerIds);

  if (normalized.length === 0) {
    throw new Error(
      "At least one recruitment officer is required.",
    );
  }

  for (const officerId of normalized) {
    if (!/^\d{17,20}$/.test(officerId)) {
      throw new Error(
        `Invalid Discord officer ID: "${officerId}".`,
      );
    }
  }

  return normalized;
}

function normalizeState(
  value: Partial<RuntimeRecruitmentConfig>,
  defaultOfficerIds: readonly string[],
): RuntimeRecruitmentConfig {
  const officerIds =
    Array.isArray(value.officerIds)
      ? validateOfficerIds(
          value.officerIds.filter(
            (id): id is string =>
              typeof id === "string",
          ),
        )
      : validateOfficerIds(
          defaultOfficerIds,
        );

  const rosterValue =
    value.roster;

  const mode:
    RecruitmentRosterMode =
    rosterValue?.mode === "selected"
      ? "selected"
      : "all";

  const roles = Array.isArray(
    rosterValue?.roles,
  )
    ? uniqueStrings(
        (rosterValue.roles as unknown[]).filter(
          (role): role is string =>
            typeof role === "string",
        ),
      )
        .map((role) =>
          role.toUpperCase(),
        )
        .filter(
          (role): role is RecruitmentRole =>
            validRoles.has(
              role as RecruitmentRole,
            ),
        )
    : [];

  const specs = Array.isArray(
    rosterValue?.specs,
  )
    ? uniqueStrings(
        rosterValue.specs.filter(
          (spec): spec is string =>
            typeof spec === "string",
        ),
      )
    : [];

  return {
    officerIds,
    roster: {
      mode,
      roles,
      specs,
    },
  };
}

export class RecruitmentConfigStore {
  private state:
    RuntimeRecruitmentConfig;

  private initialized = false;

  private mutationQueue:
    Promise<void> =
    Promise.resolve();

  public constructor(
    private readonly defaultOfficerIds:
      readonly string[],
    private readonly stateFilePath =
      resolve(
        process.cwd(),
        "data",
        "recruitment-config.json",
      ),
  ) {
    this.state = normalizeState(
      {},
      defaultOfficerIds,
    );
  }

  public async initialize():
  Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const contents =
        await readFile(
          this.stateFilePath,
          "utf8",
        );

      this.state = normalizeState(
        JSON.parse(contents) as
          Partial<RuntimeRecruitmentConfig>,
        this.defaultOfficerIds,
      );
    } catch (error) {
      const fileError =
        error as NodeJS.ErrnoException;

      if (fileError.code !== "ENOENT") {
        throw error;
      }

      this.state = normalizeState(
        {},
        this.defaultOfficerIds,
      );

      await this.saveState(
        this.state,
      );
    }

    this.initialized = true;
  }

  public getConfig():
  RuntimeRecruitmentConfig {
    return structuredClone(
      this.state,
    );
  }

  public async setOfficerIds(
    officerIds: readonly string[],
  ): Promise<void> {
    const normalized =
      validateOfficerIds(
        officerIds,
      );

    await this.mutate(
      (state) => {
        state.officerIds =
          normalized;
      },
    );
  }

  public async setRosterMode(
    mode: RecruitmentRosterMode,
  ): Promise<void> {
    await this.mutate(
      (state) => {
        if (
          mode === "selected" &&
          state.roster.roles.length === 0 &&
          state.roster.specs.length === 0
        ) {
          throw new Error(
            [
              "Add at least one role or spec before",
              "switching the roster to selected targets.",
            ].join(" "),
          );
        }

        state.roster.mode = mode;
      },
    );
  }

  public async addRole(
    role: RecruitmentRole,
  ): Promise<boolean> {
    return this.mutate(
      (state) => {
        if (state.roster.roles.includes(role)) {
          return false;
        }

        state.roster.roles.push(role);

        return true;
      },
    );
  }

  public async removeRole(
    role: RecruitmentRole,
  ): Promise<boolean> {
    return this.mutate(
      (state) => {
        const originalLength =
          state.roster.roles.length;

        const nextRoles =
          state.roster.roles.filter(
            (currentRole) =>
              currentRole !== role,
          );

        if (
          state.roster.mode === "selected" &&
          nextRoles.length === 0 &&
          state.roster.specs.length === 0 &&
          originalLength !== nextRoles.length
        ) {
          throw new Error(
            [
              "The final selected roster target cannot be removed.",
              "Switch the roster mode to All first.",
            ].join(" "),
          );
        }

        state.roster.roles =
          nextRoles;

        return (
          state.roster.roles.length !==
          originalLength
        );
      },
    );
  }

  public async addSpec(
    spec: string,
  ): Promise<boolean> {
    const normalized = spec.trim();

    if (!normalized) {
      throw new Error(
        "The class/spec target cannot be empty.",
      );
    }

    return this.mutate(
      (state) => {
        if (
          state.roster.specs.some(
            (currentSpec) =>
              currentSpec.toLowerCase() ===
              normalized.toLowerCase(),
          )
        ) {
          return false;
        }

        state.roster.specs.push(
          normalized,
        );

        return true;
      },
    );
  }

  public async removeSpec(
    spec: string,
  ): Promise<boolean> {
    const normalized =
      spec.trim().toLowerCase();

    return this.mutate(
      (state) => {
        const originalLength =
          state.roster.specs.length;

        const nextSpecs =
          state.roster.specs.filter(
            (currentSpec) =>
              currentSpec.toLowerCase() !==
              normalized,
          );

        if (
          state.roster.mode === "selected" &&
          state.roster.roles.length === 0 &&
          nextSpecs.length === 0 &&
          originalLength !== nextSpecs.length
        ) {
          throw new Error(
            [
              "The final selected roster target cannot be removed.",
              "Switch the roster mode to All first.",
            ].join(" "),
          );
        }

        state.roster.specs =
          nextSpecs;

        return (
          state.roster.specs.length !==
          originalLength
        );
      },
    );
  }

  private mutate<T>(
    mutator: (
      state: RuntimeRecruitmentConfig,
    ) => T,
  ): Promise<T> {
    const operation =
      this.mutationQueue.then(
        async () => {
          const nextState =
            structuredClone(
              this.state,
            );

          const result =
            mutator(nextState);

          await this.saveState(
            nextState,
          );

          this.state = nextState;

          return result;
        },
      );

    this.mutationQueue =
      operation.then(
        () => undefined,
        () => undefined,
      );

    return operation;
  }

  private async saveState(
    state: RuntimeRecruitmentConfig,
  ): Promise<void> {
    await mkdir(
      dirname(
        this.stateFilePath,
      ),
      {
        recursive: true,
      },
    );

    const temporaryPath =
      `${this.stateFilePath}.tmp`;

    await writeFile(
      temporaryPath,
      JSON.stringify(
        state,
        null,
        2,
      ),
      "utf8",
    );

    await rename(
      temporaryPath,
      this.stateFilePath,
    );
  }
}
