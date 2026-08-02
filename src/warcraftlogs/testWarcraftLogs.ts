import "dotenv/config";

import {
  getCharacterRankings,
} from "./warcraftLogsClient.js";

async function main(): Promise<void> {
  console.log(
    "Requesting Myixi's healing rankings...",
  );

  const result =
    await getCharacterRankings({
      characterName: "Myixi",
      realm: "Zul'jin",
      region: "US",
      specName: "Discipline",
      role: "HEALING",
    });

  console.log(
    "\n=== WARCRAFT LOGS RESULT ===",
  );

  console.log(
    JSON.stringify(
      result,
      null,
      2,
    ),
  );

  console.log(
    "=== END WARCRAFT LOGS RESULT ===\n",
  );
}

main().catch((error: unknown) => {
  console.error(
    "Warcraft Logs test failed:",
    error,
  );

  process.exitCode = 1;
});