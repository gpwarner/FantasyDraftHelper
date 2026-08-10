# RG Recruitment Bot

A Discord recruitment bot that watches an Azerite recruitment feed,
evaluates candidates against guild requirements, enriches evaluations
with Warcraft Logs data, and manages officer-specific recruitment
workflows.

## Features

- Candidate parsing and evaluation
- Warcraft Logs enrichment
- PASS and manual-review officer workflows
- Persistent recruitment case state
- Contact-evidence collection through recruiter DMs
- Duplicate applicant suppression by character name and realm
- Startup and reconnect history reconciliation
- Windows system-tray launcher
- Docker/Kubernetes deployment support

## Local setup

Install a supported Node.js LTS release, then install dependencies:

```sh
npm ci
```

Copy `.env.example` to `.env` and populate the required Discord and
Warcraft Logs configuration. Never commit the populated `.env` file.

Run the bot:

```sh
npm start
```

Useful validation commands:

```sh
npm run check
npm run build
```

## Recruitment Discord intake

The global message command `Add to Recruitment` lets an authorized
recruitment officer submit one selected message from another Discord
server. It captures and normalizes the selected message, conservatively
parses labeled fields and character links, and presents an ephemeral
confirmation before anything is added internally. One discovered
identity is preselected, ambiguous identities use a selection menu, and
missing or incorrect identity data can be entered through an edit form.

Both individual posts and numbered group posts are recognized. Group
members keep separate class/spec, progression, availability, links, and
character identity candidates. Group posts are treated as package deals:
they have no per-raider selection or automated individual pass/fail
decision, and create one manual-review output plus one officer case for
the whole group. Confirmed individual candidates use the existing
Warcraft Logs evaluation, private output channel, duplicate character
check, and officer workflow. Source-message imports are saved
in `data/recruitment-discord-intakes.json`, preventing the same external
post from being imported twice. Pending confirmation screens expire
after 30 minutes and do not survive a bot restart.

Add the application ID from Discord's **General Information** page to
`.env` as `DISCORD_APPLICATION_ID`, then explicitly deploy the global
command:

```sh
npm run register:commands
```

In the Discord Developer Portal **Installation** page:

1. Enable both **User Install** and **Guild Install**.
2. Use a Discord-provided install link.
3. Give User Install the `applications.commands` scope.
4. Keep the existing Guild Install `applications.commands` and `bot`
   scopes and existing bot permissions.
5. Save the settings, open the install link, and choose **Add to my
   apps** for each authorized recruiter.

After the command is deployed and the running bot has been restarted,
an authorized ID from the active recruitment-officer configuration can
right-click a message in a guild channel and choose **Apps** > **Add to
Recruitment**. The response is ephemeral. Unauthorized users receive an
ephemeral rejection and nothing is posted internally. Pausing Azerite
intake does not pause this recruiter-initiated intake path.

## Discord runtime configuration

Members with the Discord **Manage Server** permission can use the
`/recruitment-config` slash command. Changes take effect immediately and
are saved in `data/recruitment-config.json`, so they survive bot restarts.

Recruitment authorization commands:

```text
/recruitment-config officers list
/recruitment-config officers add officer:@User
/recruitment-config officers remove officer:@User
```

These commands control who may use recruiter actions, including **Add to
Recruitment**. An officer cannot be removed while they are still in the
assignment queue.

Round-robin assignment commands:

```text
/recruitment-config queue list
/recruitment-config queue add assignee:@User
/recruitment-config queue remove assignee:@User
```

Queue assignees must also be authorized recruitment officers. Queue
changes affect future assignments only; existing candidate cases remain
assigned to their current recruiter.

Roster-target commands:

```text
/recruitment-config roster show
/recruitment-config roster add-role role:Healer
/recruitment-config roster remove-role role:Healer
/recruitment-config roster add-spec spec:Balance Druid
/recruitment-config roster remove-spec spec:Balance Druid
/recruitment-config roster mode value:Selected roles/specs only
/recruitment-config roster mode value:All classes/specs/roles
```

Azerite candidate-intake commands:

```text
/recruitment-config azerite status
/recruitment-config azerite mode value:Paused
/recruitment-config azerite mode value:Enabled
```

Pausing Azerite intake stops startup history scans, reconnect and
periodic reconciliation, and live candidate processing. Existing
officer cases, workflow buttons, reminders, and evidence DMs continue
working. When intake is enabled again, messages accumulated during the
pause are skipped rather than backfilled. Deployments upgrading from a
configuration without this setting start paused so stale feed history
cannot be processed before an administrator checks the setting.

In selected mode, a candidate is considered targeted when either their
role or their exact `Specialization Class` value matches. Add at least one
role or spec before enabling selected mode. The
`RECRUITMENT_OFFICER_IDS` is the initial/default list of everyone who may
submit and manage candidates. `RECRUITMENT_QUEUE_ASSIGNEES` is the
initial/default subset participating in round-robin assignments. Both
variables use comma-separated Discord user IDs, and every queue assignee
must also appear in the officer list. Once runtime configuration has been
saved, it takes precedence over these defaults. Existing saved
configuration is migrated to use `RECRUITMENT_QUEUE_ASSIGNEES` the first
time this version starts.

## Windows tray launcher

Run `Install Startup.cmd` to register the lightweight tray launcher for
the current Windows user. The tray menu can start, stop, restart, and
open the bot log.

## Container deployment

See [CONTAINER.md](CONTAINER.md) for Docker/OCI image and Kubernetes
instructions. Kubernetes deployments must use a single replica and
persistent storage mounted at `/app/data`.

## Runtime state

Recruitment workflow state is written to
`data/officer-thread-state.json`. The `data` directory, logs, local
environment configuration, dependencies, and compiled output are
excluded from Git.
