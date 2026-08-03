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
      "Manage recruitment officers and roster targets.",
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild,
    )
    .setDMPermission(false)
    .addSubcommandGroup((group) =>
      group
        .setName("officers")
        .setDescription(
          "Manage the officer rotation.",
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
              "Add a recruiter to future assignments.",
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
              "Remove a recruiter from future assignments.",
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

async function updateOfficerPool(
  store: RecruitmentConfigStore,
  officerThreadManager:
    OfficerThreadManager,
  nextOfficerIds: readonly string[],
): Promise<void> {
  const previousOfficerIds =
    store.getConfig().officerIds;

  await store.setOfficerIds(
    nextOfficerIds,
  );

  try {
    await officerThreadManager
      .updateOfficerIds(
        nextOfficerIds,
      );
  } catch (error) {
    await store.setOfficerIds(
      previousOfficerIds,
    );

    throw error;
  }
}

async function handleOfficerCommand(
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
      return `<@${officer.id}> is already in the recruitment rotation.`;
    }

    await updateOfficerPool(
      store,
      officerThreadManager,
      [
        ...config.officerIds,
        officer.id,
      ],
    );

    return [
      `Added <@${officer.id}> to future recruitment assignments.`,
      "Existing candidate assignments were not changed.",
    ].join("\n");
  }

  if (subcommand === "remove") {
    if (
      !config.officerIds.includes(
        officer.id,
      )
    ) {
      return `<@${officer.id}> is not in the recruitment rotation.`;
    }

    if (config.officerIds.length === 1) {
      throw new Error(
        "The final recruitment officer cannot be removed.",
      );
    }

    await updateOfficerPool(
      store,
      officerThreadManager,
      config.officerIds.filter(
        (officerId) =>
          officerId !== officer.id,
      ),
    );

    return [
      `Removed <@${officer.id}> from future recruitment assignments.`,
      "Existing candidate assignments remain with their current recruiter.",
    ].join("\n");
  }

  throw new Error(
    "Unknown officer configuration action.",
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

    const content =
      group === "officers"
        ? await handleOfficerCommand(
            interaction,
            store,
            officerThreadManager,
            subcommand,
          )
        : await handleRosterCommand(
            interaction,
            store,
            subcommand,
          );

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
