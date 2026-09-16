# Time Tracker

A small local time-tracking web app. Log work entries through a form (or a
Start/Stop timer), see them in a table with running totals, and everything is
saved to plain CSV files you can reopen, edit in Excel, or back up.

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

## Data & privacy

Data lives in two places, kept deliberately separate so your real, private
entries never end up in git history or on GitHub:

- **`data/`** — your real entries and projects (`data/entries.csv`,
  `data/projects.csv`). This folder is listed in `.gitignore`, so it's never
  committed or pushed. It's created automatically the first time the server
  runs.
- **`mock-data/`** — fictional example projects and entries, committed to
  the repo. It exists so a fresh clone has something to look at, and so
  anyone browsing the source on GitHub sees realistic-looking CSVs instead of
  your actual logged hours.

The first time the server starts and finds `data/entries.csv` or
`data/projects.csv` missing, it copies the matching file from `mock-data/` to
seed it. After that, the app only ever reads/writes `data/`, and `mock-data/`
is left untouched — your real data is never overwritten by this.

To wipe your local data and start over from the sample set, stop the server
and delete the `data/` folder; it'll be recreated from `mock-data/` on the
next run. **This permanently deletes anything in `data/`**, so make sure
there's nothing you still need in there first.

## CSV format

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
storing its own copy. Projects are editable (name, color, IP Box) from the
Projects card in the UI. Archiving a project hides it from the "New Entry"
picker without touching entries that already reference it.

- Times are 24h `HH:MM`; entries are assumed to start and end on the same day.
- You can open/edit these CSV files directly in Excel/Sheets. Keep the header
  row and column order intact, and reload the app's page after editing them
  externally while the server is running.

## Current limits

- Single user, no authentication — meant to run on your own machine.
- No overnight (cross-midnight) entries yet.
- "This week" in the summary panel is the Monday-through-today range.

## Possible next steps

Filtering by date/project, exporting a filtered view, importing an existing
CSV to seed data, one CSV file per month, charts on the summary panel.
