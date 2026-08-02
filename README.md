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
