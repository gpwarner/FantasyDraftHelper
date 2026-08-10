import {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Guild,
  type Interaction,
} from "discord.js";

import type {
  OfficerThreadManager,
} from "../officers/officerThreadManager.js";

import {
  RecruitmentConfigStore,
  type RecruitmentRole,
  type RuntimeRecruitmentConfig,
} from "./recruitmentConfigStore.js";

const commandName =
  "recruitment-config";

const command =
  new SlashCommandBuilder()
    .setName(commandName)
    .setDescription(
      "Manage recruitment intake, access, assignments, and roster targets.",
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild,
    )
    .setDMPermission(false)
    .addSubcommandGroup((group) =>
      group
        .setName("officers")
        .setDescription(
          "Manage who can use recruitment actions.",
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("list")
            .setDescription(
              "Show the current recruitment officers.",
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("add")
            .setDescription(
              "Authorize a recruitment officer.",
            )
            .addUserOption((option) =>
              option
                .setName("officer")
                .setDescription(
                  "The recruiter to add.",
                )
                .setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("remove")
            .setDescription(
              "Remove a recruitment officer's authorization.",
            )
            .addUserOption((option) =>
              option
                .setName("officer")
                .setDescription(
                  "The recruiter to remove.",
                )
                .setRequired(true),
            ),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("queue")
        .setDescription(
          "Manage the round-robin assignment queue.",
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("list")
            .setDescription(
              "Show the current queue assignees.",
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("add")
            .setDescription(
              "Add an officer to future assignments.",
            )
            .addUserOption((option) =>
              option
                .setName("assignee")
                .setDescription(
                  "The officer to add to the queue.",
                )
                .setRequired(true),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("remove")
            .setDescription(
              "Remove an officer from future assignments.",
            )
            .addUserOption((option) =>
              option
                .setName("assignee")
                .setDescription(
                  "The officer to remove from the queue.",
                )
                .setRequired(true),
            ),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("roster")
        .setDescription(
          "Manage class/spec and role targets.",
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("show")
            .setDescription(
              "Show the active roster targets.",
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("mode")
            .setDescription(
              "Recruit everyone or only selected targets.",
            )
            .addStringOption((option) =>
              option
                .setName("value")
                .setDescription(
                  "The roster-filter mode.",
                )
                .setRequired(true)
                .addChoices(
                  {
                    name: "All classes/specs/roles",
                    value: "all",
                  },
                  {
                    name: "Selected roles/specs only",
                    value: "selected",
                  },
                ),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("add-role")
            .setDescription(
              "Add a role to the selected targets.",
            )
            .addStringOption((option) =>
              option
                .setName("role")
                .setDescription(
                  "The role to recruit.",
                )
                .setRequired(true)
                .addChoices(
                  {
                    name: "Damage (DPS)",
                    value: "DPS",
                  },
                  {
                    name: "Healer",
                    value: "HEALING",
                  },
                  {
                    name: "Tank",
                    value: "TANK",
                  },
                ),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("remove-role")
            .setDescription(
              "Remove a role from the selected targets.",
            )
            .addStringOption((option) =>
              option
                .setName("role")
                .setDescription(
                  "The role to stop recruiting.",
                )
                .setRequired(true)
                .addChoices(
                  {
                    name: "Damage (DPS)",
                    value: "DPS",
                  },
                  {
                    name: "Healer",
                    value: "HEALING",
                  },
                  {
                    name: "Tank",
                    value: "TANK",
                  },
                ),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("add-spec")
            .setDescription(
              "Add an exact Specialization Class target.",
            )
            .addStringOption((option) =>
              option
                .setName("spec")
                .setDescription(
                  "For example: Balance Druid",
                )
                .setRequired(true)
                .setMinLength(3)
                .setMaxLength(80),
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("remove-spec")
            .setDescription(
              "Remove a Specialization Class target.",
            )
            .addStringOption((option) =>
              option
                .setName("spec")
                .setDescription(
                  "For example: Balance Druid",
                )
                .setRequired(true)
                .setMinLength(3)
                .setMaxLength(80),
            ),
        ),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("azerite")
        .setDescription(
          "Pause or resume candidate intake from Azerite.",
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("status")
            .setDescription(
              "Show whether Azerite candidate intake is active.",
            ),
        )
        .addSubcommand((subcommand) =>
          subcommand
            .setName("mode")
            .setDescription(
              "Enable or pause Azerite candidate intake.",
            )
            .addStringOption((option) =>
              option
                .setName("value")
                .setDescription(
                  "Whether new Azerite candidates should be processed.",
                )
                .setRequired(true)
                .addChoices(
                  {
                    name: "Enabled",
                    value: "enabled",
                  },
                  {
                    name: "Paused",
                    value: "paused",
                  },
                ),
            ),
        ),
    );

function formatOfficers(
  config: RuntimeRecruitmentConfig,
): string {
  return config.officerIds
    .map(
      (officerId, index) =>
        `${index + 1}. <@${officerId}>`,
    )
    .join("\n");
}

function formatQueueAssignees(
  config: RuntimeRecruitmentConfig,
): string {
  return config.queueAssigneeIds
    .map(
      (assigneeId, index) =>
        `${index + 1}. <@${assigneeId}>`,
    )
    .join("\n");
}

function formatRoster(
  config: RuntimeRecruitmentConfig,
): string {
  if (config.roster.mode === "all") {
    return [
      "**Mode:** All classes/specs/roles",
      "Every candidate passes the roster-target filter.",
    ].join("\n");
  }

  return [
    "**Mode:** Selected roles/specs only",
    [
      "**Roles:**",
      config.roster.roles.length > 0
        ? config.roster.roles.join(", ")
        : "None",
    ].join(" "),
    [
      "**Class/specs:**",
      config.roster.specs.length > 0
        ? config.roster.specs.join(", ")
        : "None",
    ].join(" "),
    "A candidate is targeted when either their role or exact class/spec matches.",
  ].join("\n");
}

function formatAzeriteIntake(
  config: RuntimeRecruitmentConfig,
): string {
  return config.azerite.ingestionEnabled
    ? [
        "**Azerite intake:** Enabled",
        "New Azerite posts will be evaluated and sent into the recruitment workflow.",
      ].join("\n")
    : [
        "**Azerite intake:** Paused",
        "New Azerite posts are ignored. Existing recruitment workflows remain active.",
      ].join("\n");
}

async function updateQueuePool(
  store: RecruitmentConfigStore,
  officerThreadManager:
    OfficerThreadManager,
  nextAssigneeIds: readonly string[],
): Promise<void> {
  const previousAssigneeIds =
    store.getConfig().queueAssigneeIds;

  await store.setQueueAssigneeIds(
    nextAssigneeIds,
  );

  try {
    await officerThreadManager
      .updateOfficerIds(
        nextAssigneeIds,
      );
  } catch (error) {
    await store.setQueueAssigneeIds(
      previousAssigneeIds,
    );

    throw error;
  }
}

async function handleOfficerCommand(
  interaction:
    ChatInputCommandInteraction,
  store: RecruitmentConfigStore,
  subcommand: string,
): Promise<string> {
  const config = store.getConfig();

  if (subcommand === "list") {
    return [
      "## Recruitment officers",
      formatOfficers(config),
    ].join("\n");
  }

  const officer =
    interaction.options.getUser(
      "officer",
      true,
    );

  if (officer.bot) {
    throw new Error(
      "A bot account cannot be added as a recruitment officer.",
    );
  }

  if (subcommand === "add") {
    if (
      config.officerIds.includes(
        officer.id,
      )
    ) {
      return `<@${officer.id}> is already an authorized recruitment officer.`;
    }

    await store.setOfficerIds([
      ...config.officerIds,
      officer.id,
    ]);

    return `Authorized <@${officer.id}> to use recruitment actions.`;
  }

  if (subcommand === "remove") {
    if (
      !config.officerIds.includes(
        officer.id,
      )
    ) {
      return `<@${officer.id}> is not an authorized recruitment officer.`;
    }

    if (config.officerIds.length === 1) {
      throw new Error(
        "The final recruitment officer cannot be removed.",
      );
    }

    if (
      config.queueAssigneeIds.includes(
        officer.id,
      )
    ) {
      throw new Error(
        "Remove that officer from the recruitment queue before removing their authorization.",
      );
    }

    await store.setOfficerIds(
      config.officerIds.filter(
        (officerId) =>
          officerId !== officer.id,
      ),
    );

    return `Removed recruitment authorization from <@${officer.id}>.`;
  }

  throw new Error(
    "Unknown officer configuration action.",
  );
}

async function handleQueueCommand(
  interaction:
    ChatInputCommandInteraction,
  store: RecruitmentConfigStore,
  officerThreadManager:
    OfficerThreadManager,
  subcommand: string,
): Promise<string> {
  const config = store.getConfig();

  if (subcommand === "list") {
    return [
      "## Recruitment queue assignees",
      formatQueueAssignees(config),
    ].join("\n");
  }

  const assignee =
    interaction.options.getUser(
      "assignee",
      true,
    );

  if (assignee.bot) {
    throw new Error(
      "A bot account cannot be added as a recruitment queue assignee.",
    );
  }

  if (subcommand === "add") {
    if (
      !config.officerIds.includes(
        assignee.id,
      )
    ) {
      throw new Error(
        "Authorize that user as a recruitment officer before adding them to the queue.",
      );
    }

    if (
      config.queueAssigneeIds.includes(
        assignee.id,
      )
    ) {
      return `<@${assignee.id}> is already in the recruitment assignment queue.`;
    }

    await updateQueuePool(
      store,
      officerThreadManager,
      [
        ...config.queueAssigneeIds,
        assignee.id,
      ],
    );

    return [
      `Added <@${assignee.id}> to future recruitment assignments.`,
      "Existing candidate assignments were not changed.",
    ].join("\n");
  }

  if (subcommand === "remove") {
    if (
      !config.queueAssigneeIds.includes(
        assignee.id,
      )
    ) {
      return `<@${assignee.id}> is not in the recruitment assignment queue.`;
    }

    if (
      config.queueAssigneeIds.length === 1
    ) {
      throw new Error(
        "The final recruitment queue assignee cannot be removed.",
      );
    }

    await updateQueuePool(
      store,
      officerThreadManager,
      config.queueAssigneeIds.filter(
        (assigneeId) =>
          assigneeId !== assignee.id,
      ),
    );

    return [
      `Removed <@${assignee.id}> from future recruitment assignments.`,
      "Existing candidate assignments remain with their current recruiter.",
    ].join("\n");
  }

  throw new Error(
    "Unknown queue configuration action.",
  );
}

function getRoleOption(
  interaction:
    ChatInputCommandInteraction,
): RecruitmentRole {
  return interaction.options.getString(
    "role",
    true,
  ) as RecruitmentRole;
}

async function handleRosterCommand(
  interaction:
    ChatInputCommandInteraction,
  store: RecruitmentConfigStore,
  subcommand: string,
): Promise<string> {
  if (subcommand === "show") {
    return [
      "## Recruitment roster targets",
      formatRoster(
        store.getConfig(),
      ),
    ].join("\n");
  }

  if (subcommand === "mode") {
    const mode =
      interaction.options.getString(
        "value",
        true,
      ) as "all" | "selected";

    await store.setRosterMode(mode);

    return [
      "Recruitment roster mode updated.",
      formatRoster(
        store.getConfig(),
      ),
    ].join("\n");
  }

  if (
    subcommand === "add-role" ||
    subcommand === "remove-role"
  ) {
    const role =
      getRoleOption(interaction);

    const changed =
      subcommand === "add-role"
        ? await store.addRole(role)
        : await store.removeRole(role);

    return [
      changed
        ? `${role} was ${subcommand === "add-role" ? "added to" : "removed from"} the selected targets.`
        : `${role} was already ${subcommand === "add-role" ? "present in" : "absent from"} the selected targets.`,
      formatRoster(
        store.getConfig(),
      ),
    ].join("\n");
  }

  if (
    subcommand === "add-spec" ||
    subcommand === "remove-spec"
  ) {
    const spec =
      interaction.options.getString(
        "spec",
        true,
      ).trim();

    const changed =
      subcommand === "add-spec"
        ? await store.addSpec(spec)
        : await store.removeSpec(spec);

    return [
      changed
        ? `**${spec}** was ${subcommand === "add-spec" ? "added to" : "removed from"} the selected targets.`
        : `**${spec}** was already ${subcommand === "add-spec" ? "present in" : "absent from"} the selected targets.`,
      formatRoster(
        store.getConfig(),
      ),
    ].join("\n");
  }

  throw new Error(
    "Unknown roster configuration action.",
  );
}

async function handleAzeriteCommand(
  interaction:
    ChatInputCommandInteraction,
  store: RecruitmentConfigStore,
  subcommand: string,
  onIngestionEnabled?:
    () => void | Promise<void>,
): Promise<string> {
  if (subcommand === "status") {
    return formatAzeriteIntake(
      store.getConfig(),
    );
  }

  if (subcommand === "mode") {
    const mode =
      interaction.options.getString(
        "value",
        true,
      ) as "enabled" | "paused";
    const ingestionEnabled =
      mode === "enabled";
    const changed =
      await store
        .setAzeriteIngestionEnabled(
          ingestionEnabled,
        );

    if (
      changed &&
      ingestionEnabled &&
      onIngestionEnabled
    ) {
      await onIngestionEnabled();
    }

    return [
      changed
        ? "Azerite candidate intake was updated."
        : "Azerite candidate intake was already set to that mode.",
      formatAzeriteIntake(
        store.getConfig(),
      ),
      ingestionEnabled
        ? "Posts accumulated while intake was paused will not be backfilled."
        : "No new Azerite candidates will be processed until intake is enabled again.",
    ].join("\n");
  }

  throw new Error(
    "Unknown Azerite intake action.",
  );
}

export interface RecruitmentConfigCommandCallbacks {
  onAzeriteIngestionEnabled?:
    () => void | Promise<void>;
}

export async function registerRecruitmentConfigCommand(
  guild: Guild,
): Promise<void> {
  const existingCommands =
    await guild.commands.fetch();

  const existingCommand =
    existingCommands.find(
      (currentCommand) =>
        currentCommand.name ===
        commandName,
    );

  if (existingCommand) {
    await existingCommand.edit(
      command,
    );
  } else {
    await guild.commands.create(
      command,
    );
  }

  console.log(
    `Registered /${commandName} in ${guild.name}.`,
  );
}

export async function handleRecruitmentConfigInteraction(
  interaction: Interaction,
  store: RecruitmentConfigStore,
  officerThreadManager:
    OfficerThreadManager,
  callbacks:
    RecruitmentConfigCommandCallbacks = {},
): Promise<boolean> {
  if (
    !interaction.isChatInputCommand() ||
    interaction.commandName !== commandName
  ) {
    return false;
  }

  if (
    !interaction.inGuild() ||
    !interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild,
    )
  ) {
    await interaction.reply({
      content:
        "You need the **Manage Server** permission to change recruitment configuration.",
      flags: MessageFlags.Ephemeral,
      allowedMentions: {
        parse: [],
      },
    });

    return true;
  }

  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });

  try {
    const group =
      interaction.options
        .getSubcommandGroup(true);
    const subcommand =
      interaction.options
        .getSubcommand(true);

    let content: string;

    switch (group) {
      case "officers":
        content =
          await handleOfficerCommand(
            interaction,
            store,
            subcommand,
          );
        break;

      case "queue":
        content =
          await handleQueueCommand(
            interaction,
            store,
            officerThreadManager,
            subcommand,
          );
        break;

      case "roster":
        content =
          await handleRosterCommand(
            interaction,
            store,
            subcommand,
          );
        break;

      case "azerite":
        content =
          await handleAzeriteCommand(
            interaction,
            store,
            subcommand,
            callbacks
              .onAzeriteIngestionEnabled,
          );
        break;

      default:
        throw new Error(
          "Unknown recruitment configuration group.",
        );
    }

    await interaction.editReply({
      content,
      allowedMentions: {
        parse: [],
      },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      "Recruitment configuration command failed:",
      error,
    );

    await interaction.editReply({
      content:
        `The recruitment configuration was not changed: ${errorMessage}`,
      allowedMentions: {
        parse: [],
      },
    });
  }

  return true;
}
