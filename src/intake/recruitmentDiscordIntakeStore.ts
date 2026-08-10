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

import type {
  CheckStatus,
} from "../evaluation/evaluateCandidate.js";

export interface RecruitmentDiscordImportedCandidate {
  characterName: string;
  realm: string;
  region: string;
  outputMessageUrl: string;
  overallStatus: CheckStatus;
}

export interface RecruitmentDiscordImportRecord {
  sourceGuildId?: string;
  sourceChannelId: string;
  sourceMessageId: string;
  sourceMessageUrl: string;
  submittedByDiscordUserId: string;
  importedAt: string;
  candidates: RecruitmentDiscordImportedCandidate[];
}

interface RecruitmentDiscordIntakeState {
  importsBySource: Record<string, RecruitmentDiscordImportRecord>;
}

const defaultState: RecruitmentDiscordIntakeState = {
  importsBySource: {},
};

export function createRecruitmentDiscordSourceKey(
  sourceGuildId: string | undefined,
  sourceChannelId: string,
  sourceMessageId: string,
): string {
  return [
    sourceGuildId ?? "dm",
    sourceChannelId,
    sourceMessageId,
  ].join("/");
}

function normalizeState(
  value: Partial<RecruitmentDiscordIntakeState>,
): RecruitmentDiscordIntakeState {
  return {
    importsBySource:
      value.importsBySource &&
      typeof value.importsBySource === "object"
        ? value.importsBySource
        : {},
  };
}

export class RecruitmentDiscordIntakeStore {
  private state = structuredClone(defaultState);
  private initialized = false;
  private mutationQueue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly stateFilePath = resolve(
      process.cwd(),
      "data",
      "recruitment-discord-intakes.json",
    ),
  ) {}

  public async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      this.state = normalizeState(
        JSON.parse(
          await readFile(this.stateFilePath, "utf8"),
        ) as Partial<RecruitmentDiscordIntakeState>,
      );
    } catch (error) {
      const fileError = error as NodeJS.ErrnoException;

      if (fileError.code !== "ENOENT") {
        throw error;
      }

      await this.saveState(this.state);
    }

    this.initialized = true;
  }

  public getImport(
    sourceGuildId: string | undefined,
    sourceChannelId: string,
    sourceMessageId: string,
  ): RecruitmentDiscordImportRecord | undefined {
    const record = this.state.importsBySource[
      createRecruitmentDiscordSourceKey(
        sourceGuildId,
        sourceChannelId,
        sourceMessageId,
      )
    ];

    return record ? structuredClone(record) : undefined;
  }

  public async recordImport(
    record: RecruitmentDiscordImportRecord,
  ): Promise<void> {
    const operation = this.mutationQueue.then(async () => {
      const nextState = structuredClone(this.state);
      const key = createRecruitmentDiscordSourceKey(
        record.sourceGuildId,
        record.sourceChannelId,
        record.sourceMessageId,
      );

      if (nextState.importsBySource[key]) {
        throw new Error(
          "This Recruitment Discord post has already been imported.",
        );
      }

      nextState.importsBySource[key] = structuredClone(record);
      await this.saveState(nextState);
      this.state = nextState;
    });

    this.mutationQueue = operation.then(
      () => undefined,
      () => undefined,
    );

    return operation;
  }

  private async saveState(
    state: RecruitmentDiscordIntakeState,
  ): Promise<void> {
    await mkdir(dirname(this.stateFilePath), { recursive: true });
    const temporaryPath = `${this.stateFilePath}.tmp`;

    await writeFile(
      temporaryPath,
      JSON.stringify(state, null, 2),
      "utf8",
    );
    await rename(temporaryPath, this.stateFilePath);
  }
}
