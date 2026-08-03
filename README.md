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

## Discord runtime configuration

Members with the Discord **Manage Server** permission can use the
`/recruitment-config` slash command. Changes take effect immediately and
are saved in `data/recruitment-config.json`, so they survive bot restarts.

Officer rotation commands:

```text
/recruitment-config officers list
/recruitment-config officers add officer:@User
/recruitment-config officers remove officer:@User
```

Removing an officer affects future assignments only. Existing candidate
cases remain assigned to their current recruiter.

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

In selected mode, a candidate is considered targeted when either their
role or their exact `Specialization Class` value matches. Add at least one
role or spec before enabling selected mode. The
`RECRUITMENT_OFFICER_IDS` environment variable is now the initial/default
officer list used when no saved runtime configuration exists.

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
