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

export interface RuntimeAzeriteConfig {
  ingestionEnabled: boolean;
  resumeAfterMessageId?: string;
}

export interface RuntimeRecruitmentConfig {
  officerIds: string[];
  queueAssigneeIds: string[];
  roster: RuntimeRosterConfig;
  azerite: RuntimeAzeriteConfig;
}

const DISCORD_EPOCH_MILLISECONDS =
  1_420_070_400_000n;
const DISCORD_SNOWFLAKE_INCREMENT_BITS =
  22n;
const DISCORD_SNOWFLAKE_INCREMENT_MASK =
  (1n << DISCORD_SNOWFLAKE_INCREMENT_BITS) - 1n;

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

function validateDiscordUserIds(
  userIds: readonly string[],
  label: string,
): string[] {
  const normalized =
    uniqueStrings(userIds);

  if (normalized.length === 0) {
    throw new Error(
      `At least one ${label} is required.`,
    );
  }

  for (const officerId of normalized) {
    if (!/^\d{17,20}$/.test(officerId)) {
      throw new Error(
        `Invalid Discord user ID in ${label}: "${officerId}".`,
      );
    }
  }

  return normalized;
}

export function createDiscordSnowflakeUpperBound(
  date: Date,
): string {
  const timestamp = date.getTime();

  if (
    !Number.isFinite(timestamp) ||
    timestamp <
      Number(DISCORD_EPOCH_MILLISECONDS)
  ) {
    throw new Error(
      "The Azerite resume time is invalid.",
    );
  }

  const milliseconds =
    BigInt(timestamp);

  return (
    ((milliseconds -
      DISCORD_EPOCH_MILLISECONDS) <<
      DISCORD_SNOWFLAKE_INCREMENT_BITS) |
    DISCORD_SNOWFLAKE_INCREMENT_MASK
  ).toString();
}

function normalizeState(
  value: Partial<RuntimeRecruitmentConfig>,
  defaultOfficerIds: readonly string[],
  defaultQueueAssigneeIds: readonly string[],
): RuntimeRecruitmentConfig {
  const officerIds =
    Array.isArray(value.officerIds)
      ? validateDiscordUserIds(
          value.officerIds.filter(
            (id): id is string =>
              typeof id === "string",
          ),
          "recruitment officer",
        )
      : validateDiscordUserIds(
          defaultOfficerIds,
          "recruitment officer",
        );

  const queueAssigneeIds =
    Array.isArray(value.queueAssigneeIds)
      ? validateDiscordUserIds(
          value.queueAssigneeIds.filter(
            (id): id is string =>
              typeof id === "string",
          ),
          "recruitment queue assignee",
        )
      : validateDiscordUserIds(
          defaultQueueAssigneeIds,
          "recruitment queue assignee",
        );

  const unauthorizedAssignee =
    queueAssigneeIds.find(
      (assigneeId) =>
        !officerIds.includes(assigneeId),
    );

  if (unauthorizedAssignee) {
    throw new Error(
      `Recruitment queue assignee ${unauthorizedAssignee} must also be a recruitment officer.`,
    );
  }

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

  const azeriteValue =
    value.azerite;

  const resumeAfterMessageId =
    typeof azeriteValue
      ?.resumeAfterMessageId === "string" &&
    /^\d{17,20}$/.test(
      azeriteValue.resumeAfterMessageId,
    )
      ? azeriteValue.resumeAfterMessageId
      : undefined;

  return {
    officerIds,
    queueAssigneeIds,
    roster: {
      mode,
      roles,
      specs,
    },
    azerite: {
      ingestionEnabled:
        azeriteValue
          ?.ingestionEnabled === true,
      ...(resumeAfterMessageId
        ? { resumeAfterMessageId }
        : {}),
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
    private readonly defaultQueueAssigneeIds:
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
      defaultQueueAssigneeIds,
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

      const persistedState =
        JSON.parse(contents) as
          Partial<RuntimeRecruitmentConfig>;

      this.state = normalizeState(
        persistedState,
        this.defaultOfficerIds,
        this.defaultQueueAssigneeIds,
      );

      if (
        !Array.isArray(
          persistedState.queueAssigneeIds,
        )
      ) {
        await this.saveState(
          this.state,
        );
      }
    } catch (error) {
      const fileError =
        error as NodeJS.ErrnoException;

      if (fileError.code !== "ENOENT") {
        throw error;
      }

      this.state = normalizeState(
        {},
        this.defaultOfficerIds,
        this.defaultQueueAssigneeIds,
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
      validateDiscordUserIds(
        officerIds,
        "recruitment officer",
      );

    await this.mutate(
      (state) => {
        const removedQueueAssignee =
          state.queueAssigneeIds.find(
            (assigneeId) =>
              !normalized.includes(assigneeId),
          );

        if (removedQueueAssignee) {
          throw new Error(
            `Remove ${removedQueueAssignee} from the recruitment queue before removing their officer authorization.`,
          );
        }

        state.officerIds =
          normalized;
      },
    );
  }

  public async setQueueAssigneeIds(
    queueAssigneeIds: readonly string[],
  ): Promise<void> {
    const normalized =
      validateDiscordUserIds(
        queueAssigneeIds,
        "recruitment queue assignee",
      );

    await this.mutate(
      (state) => {
        const unauthorizedAssignee =
          normalized.find(
            (assigneeId) =>
              !state.officerIds.includes(
                assigneeId,
              ),
          );

        if (unauthorizedAssignee) {
          throw new Error(
            `Add ${unauthorizedAssignee} as a recruitment officer before adding them to the queue.`,
          );
        }

        state.queueAssigneeIds = normalized;
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

  public async setAzeriteIngestionEnabled(
    ingestionEnabled: boolean,
    resumeAt = new Date(),
  ): Promise<boolean> {
    return this.mutate(
      (state) => {
        if (
          state.azerite
            .ingestionEnabled ===
          ingestionEnabled
        ) {
          return false;
        }

        state.azerite
          .ingestionEnabled =
          ingestionEnabled;

        if (ingestionEnabled) {
          state.azerite
            .resumeAfterMessageId =
            createDiscordSnowflakeUpperBound(
              resumeAt,
            );
        }

        return true;
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
