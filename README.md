# Fantasy Football Draft Helper

A React + Vite + TypeScript app scaffold for a Sleeper fantasy football draft assistant.

## Project Goal

This project is intended to become a local live draft dashboard for a Sleeper redraft league with the following features:

- Live Sleeper draft synchronization
- User roster and opponent roster tracking
- League-specific scoring and valuation
- Draft board and positional tiers
- Two-player pair optimization for back-to-back picks
- Data persistence and override support

## Available Scripts

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`

## Project Structure

- `src/` — React application source files
- `src/App.tsx` — main draft helper UI
- `src/main.tsx` — app entry point
- `src/types.ts` — shared TypeScript model types
- `src/config/leagueConfig.ts` — league IDs and scoring configuration
- `src/services/scoring.ts` — fantasy-point calculation logic
- `src/services/sleeper.ts` — Sleeper API client helpers
- `src/index.css` — global styles
- `src/App.css` — component styles

## Build Spec

The application is being developed according to `fantasy_draft_assistant_spec.md`, which defines:

- Sleeper league/draft IDs
- League scoring rules and roster structure
- Draft slot and turn optimization requirements
- Player valuation, tiering, return probability, and pair optimization concepts

## Getting Started

1. Install dependencies: `npm install`
2. Run development server: `npm run dev`
3. Open the local URL shown in the terminal

## Notes

The current scaffold includes the core architecture for:

- league constants and draft sequence
- Sleeper API access
- scoring calculation based on league rules
- type-safe data models for players, projections, and draft state
