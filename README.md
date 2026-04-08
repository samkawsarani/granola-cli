# granola-cli

[![npm version](https://img.shields.io/npm/v/@samkawsarani/granola-cli)](https://www.npmjs.com/package/@samkawsarani/granola-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> [!IMPORTANT]
> **Disclaimer**: This is an **unofficial, open-source community project** and is **not affiliated with, endorsed by, or connected to Granola Labs, Inc.** (the company behind [Granola.ai](https://www.granola.ai/)). Granola is a registered trademark of Granola Labs, Inc. This CLI is an independent tool that uses the publicly available Granola API to provide command-line access to your own meeting data.

> [!NOTE]
> This tool has only been tested on **macOS**. It may work on Windows and Linux, but this has not been verified.

A command-line interface for [Granola](https://www.granola.ai/) meeting notes.

Access your meetings, notes, and transcripts directly from the terminal. Built with TypeScript and designed for both interactive use and scripting.

## Installation

```bash
npm install -g @samkawsarani/granola-cli
# or
bun install -g @samkawsarani/granola-cli
```

## Quick Start

```bash
# Interactive setup 
granola init

# List notes
granola list-notes
granola list-notes --limit 25
granola list-notes --after 2026-01-01

# Get a single note
granola get-note --id not_1d3tmYTlCICgjy
granola get-note --id not_1d3tmYTlCICgjy --transcript

# Sync notes to local Markdown files
granola sync-notes
granola sync-notes --after 2026-01-01
granola sync-notes --format json
granola sync-notes --force

# Install agent skill (for Claude Code / Cursor agents)
granola install-skill
granola install-skill --global
granola install-skill --claude              # create .claude symlink without prompting
```

## Library Usage

```typescript
import { listNotes, listAllNotes, getNote, syncNotes } from "@samkawsarani/granola-cli";

// List recent notes (single page)
const page = await listNotes({ pageSize: 10 });

// All notes, auto-paginated
const notes = await listAllNotes({ after: "2026-01-01" });

// Single note with transcript
const note = await getNote("not_1d3tmYTlCICgjy", true);

// Sync notes to local files
const result = await syncNotes({
  notesDir: "~/granola-notes",
  syncContent: "transcript", // "transcript" | "summary" | "both"
});
console.log(result); // { synced: 5, skipped: 12, moved: 0 }
```

## Configuration

Run `granola init` for interactive setup, or set environment variables directly.

| Variable | Default | Description |
|---|---|---|
| `GRANOLA_API_KEY` | — | Granola API key (required) |
| `GRANOLA_NOTES_DIR` | `~/granola-notes` | Directory for synced notes |
| `GRANOLA_FILENAME_FORMAT` | `{date}-{title}` | Filename template |
| `GRANOLA_USE_FOLDERS` | `false` | Organise into folder subfolders |
| `GRANOLA_SYNC_CONTENT` | `transcript` | `transcript` / `summary` / `both` |

Config is written to `~/.config/granola/.env`. A local `.env` in the current directory overrides it.

## Sync behaviour

`sync-notes` is idempotent:
- New notes are fetched and written
- Notes with a changed `updated_at` are re-fetched and overwritten
- Notes that moved folders (when `GRANOLA_USE_FOLDERS=true`) are relocated automatically
- Unchanged notes are skipped

State is persisted in `{GRANOLA_NOTES_DIR}/sync-state.json`. Use `--force` to re-sync everything.

## License

[MIT](LICENSE) — Copyright (c) 2024-2026 Sam Kawsarani
