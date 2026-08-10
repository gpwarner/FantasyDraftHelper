import "dotenv/config";

import {
  REST,
  Routes,
} from "discord.js";

import {
  addToRecruitmentCommand,
  addToRecruitmentCommandName,
} from "../intake/recruitmentDiscordIntake.js";

function getRequiredEnvironmentVariable(
  name: string,
): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}. Check your .env file.`,
    );
  }

  return value;
}

async function main(): Promise<void> {
  const token =
    getRequiredEnvironmentVariable(
      "DISCORD_TOKEN",
    );
  const applicationId =
    getRequiredEnvironmentVariable(
      "DISCORD_APPLICATION_ID",
    );

  const rest = new REST({
    version: "10",
  }).setToken(token);

  await rest.post(
    Routes.applicationCommands(
      applicationId,
    ),
    {
      body:
        addToRecruitmentCommand.toJSON(),
    },
  );

  console.log(
    `Registered global message command: ${addToRecruitmentCommandName}`,
  );
}

main().catch((error: unknown) => {
  console.error(
    "Could not register global Discord commands:",
    error,
  );
  process.exitCode = 1;
});
