# Time Tracker

A small local time-tracking web app. Log work entries on a weekly calendar
(click or drag to create/resize/move them), see analytics and trends in a
Recap page, and everything is saved to plain CSV/JSON files you can reopen,
edit, or back up.

You can run it directly with Node, or in a preconfigured Dev Container /
GitHub Codespace — both are covered below.

## Prerequisites

Pick one:

- **Run directly:** Node.js LTS (v20+).
- **Run in a container:** [Docker](https://www.docker.com/) plus either
  [VS Code](https://code.visualstudio.com/) with the
  [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers),
  or a GitHub Codespace — no local Node install needed either way.

## Running locally

```
npm install
npm start
```

Then open http://localhost:3000 in your browser. Stop the server with
`Ctrl+C` in the terminal.

## Running in a Dev Container

This repo includes a `.devcontainer/devcontainer.json` (Node 24 image, runs
`npm install` automatically, forwards port 3000 and opens it in your browser).

**VS Code:**

1. Install the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers).
2. Open this folder in VS Code.
3. Run **Dev Containers: Reopen in Container** from the command palette (or
   click the prompt that pops up automatically).
4. Once the container finishes building, run `npm start` in the integrated
   terminal.

**GitHub Codespaces** (once this repo is on GitHub): open the repo, click
**Code → Codespaces → Create codespace on main**. The same devcontainer
config applies, so it's ready to go — just run `npm start`.

## Standalone builds (no Node install needed)

For sharing the app with someone who doesn't have Node installed, build
standalone executables for Windows, macOS, and Linux:

```
npm install
npm run build
```

This produces one self-contained folder per platform under `dist/`:

```
dist/time-tracker-win-x64/time-tracker.exe
dist/time-tracker-macos-x64/time-tracker
dist/time-tracker-macos-arm64/time-tracker   (Apple Silicon)
dist/time-tracker-linux-x64/time-tracker
```

Each folder is self-contained — zip it up and send it, or copy it to a USB
drive. To run it, the recipient just needs the matching platform's whole
folder (not only the executable — `public/`, `mock-data/`, and
`node_modules/` next to it are required too), then double-click the
executable (or run it from a terminal). It starts a local server and opens
your default browser to it automatically; a `data/` folder appears next to
the executable on first run, exactly like `data/` does when running via
`npm start`.

**macOS note:** these builds are unsigned (built from Linux, with no Apple
Developer account), so Gatekeeper will refuse to open them with a "damaged"
or "unidentified developer" warning. The recipient needs to right-click the
executable → **Open** (once), or run
`xattr -d com.apple.quarantine time-tracker` in Terminal first.

**Windows note:** same story — the `.exe` is unsigned, so Windows
SmartScreen will show a "Windows protected your PC" warning on first run.
Click **More info → Run anyway** once.

Rebuild after any code change — `dist/` isn't kept in sync automatically and
isn't committed to git (see `.gitignore`).

## Using the app

The app has four pages, linked from the top nav:

- **Time Tracker** (`/`) — a weekly calendar. Click an empty slot to create
  an entry, or click-and-drag to set its start/end time directly; drag an
  existing entry to move it, or drag its edge to resize it. Click an entry to
  edit it, duplicate it, or delete it. The Summary card shows today's and
  this week's totals, broken down by project. Clicking a day's header
  toggles it as a holiday (see below).
- **Recap** (`/recap`) — analytics across a day/week/month/year range you
  pick: total and average time, a per-project breakdown, an IP Box vs.
  non-IP Box split (see below), and a trend chart (optionally stacked by
  project).
- **Projects** (`/projects`) — add, rename, recolor, archive, or delete
  projects, and toggle each one's IP Box flag. Archiving hides a project
  from the "New Entry" picker without touching entries that already
  reference it.
- **Settings** (`/settings`) — define your work schedule as a sequence of
  time-bound periods (each with an effective start date, hours/day, and
  which weekdays count as work days). This drives which days the calendar
  and Recap treat as expected working days — e.g. Recap's "days with
  entries" and daily average are computed only over expected work days, and
  the calendar shades non-work days. Multiple periods let the schedule
  change over time (e.g. going part-time from a given date) without losing
  history.

**Holidays:** clicking a day's header on the calendar marks/unmarks it as a
holiday (stored in `data/holidays.json`). Holidays are shaded on the
calendar and excluded from Recap's expected-work-day calculations, same as
a Settings-defined non-work day.

**IP Box:** a per-project flag for Poland's IP Box (Innovation Box)
preferential tax regime for qualified IP/R&D income. Flagging a project lets
the Recap page split logged hours into IP Box vs. non-IP Box time for tax
reporting, without needing to categorize each entry individually — an entry
inherits the flag from its project.

## Data & privacy

Data lives in two places, kept deliberately separate so your real, private
entries never end up in git history or on GitHub:

- **`data/`** — your real data (`data/entries.csv`, `data/projects.csv`,
  `data/settings.json`, `data/holidays.json`). This folder is listed in
  `.gitignore`, so it's never committed or pushed. It's created
  automatically the first time the server runs.
- **`mock-data/`** — fictional example projects and entries, committed to
  the repo. It exists so a fresh clone has something to look at, and so
  anyone browsing the source on GitHub sees realistic-looking CSVs instead of
  your actual logged hours.

The first time the server starts:

- If `data/entries.csv` or `data/projects.csv` is missing, it's seeded by
  copying the matching file from `mock-data/`.
- If `data/settings.json` is missing, it's created with one default period
  (8 hours/day, Monday–Friday, effective from 2000-01-01) — a functional
  default, not fictional sample data, since the app needs some notion of
  "expected work day" to function out of the box.
- If `data/holidays.json` is missing, it's created empty — there's no
  sensible default holiday list.

After that, the app only ever reads/writes `data/`, and `mock-data/` is left
untouched — your real data is never overwritten by this.

To wipe your local data and start over from the sample set, stop the server
and delete the `data/` folder; it'll be recreated on the next run (entries
and projects reseeded from `mock-data/`, settings/holidays reset to the
defaults above). **This permanently deletes anything in `data/`**, so make
sure there's nothing you still need in there first.

## CSV / JSON format

Entries (`data/entries.csv`):

```
id, date, project_id, description, start_time, end_time, duration_minutes
```

Projects (`data/projects.csv`):

```
id, project_name, color, ip_box, archived
```

Each entry's `project_id` references a row in `data/projects.csv` by `id`.
`ip_box` and `color` live only on the project — an entry inherits both for
display (the calendar colors its events by the project's `color`) rather than
storing its own copy.

- Times are 24h `HH:MM`; entries are assumed to start and end on the same day.
- You can open/edit these CSV files directly in Excel/Sheets. Keep the header
  row and column order intact, and reload the app's page after editing them
  externally while the server is running.

Settings (`data/settings.json`) — a list of work-schedule periods, sorted
chronologically:

```json
{
  "periods": [
    { "id": 1, "effective_date": "2000-01-01", "hours_per_day": 8, "work_days": ["monday", "tuesday", "wednesday", "thursday", "friday"] }
  ]
}
```

A period applies from its `effective_date` until the next period's
`effective_date` (or indefinitely, for the last one).

Holidays (`data/holidays.json`) — a flat list of ISO dates:

```json
{ "dates": ["2026-01-01", "2026-12-25"] }
```

## Current limits

- Single user, no authentication — meant to run on your own machine.
- No overnight (cross-midnight) entries yet — an end time before the start
  time on the same day is treated as 0 duration.

## Possible next steps

Filtering the calendar by project, exporting a filtered view, importing an
existing CSV to seed data, one CSV file per month.
