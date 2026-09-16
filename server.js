const express = require('express');
const fs = require('fs');
const path = require('path');

// Packaged builds (see package.json "build" script) run as a single
// executable with no real __dirname on disk — data/public/mock-data (and,
// below, csv-parse/csv-stringify) must be resolved next to the executable
// itself instead, so real user data stays a plain, writable, editable file.
const BASE_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;

// pkg's bundler can't follow csv-parse/csv-stringify's "exports"-mapped
// "/sync" subpath (its resolver predates conditional exports support), so a
// packaged build ships those two packages as real folders next to the
// executable (see package.json "build" script) instead of embedding them,
// and loads them here by absolute file path — which sidesteps both pkg's
// bundler and Node's own "exports" lookup, unlike the bare specifier below.
const { parse } = process.pkg
  ? require(path.join(BASE_DIR, 'node_modules/csv-parse/dist/cjs/sync.cjs'))
  : require('csv-parse/sync');
const { stringify } = process.pkg
  ? require(path.join(BASE_DIR, 'node_modules/csv-stringify/dist/cjs/sync.cjs'))
  : require('csv-stringify/sync');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(BASE_DIR, 'data');
const CSV_PATH = path.join(DATA_DIR, 'entries.csv');
const PROJECTS_CSV_PATH = path.join(DATA_DIR, 'projects.csv');
const SETTINGS_PATH = path.join(DATA_DIR, 'settings.json');
const HOLIDAYS_PATH = path.join(DATA_DIR, 'holidays.json');

// Fictional sample data committed to the repo (see mock-data/). Used only to
// seed data/ the first time it's missing a file — real data always wins.
const MOCK_DIR = path.join(BASE_DIR, 'mock-data');
const MOCK_CSV_PATH = path.join(MOCK_DIR, 'entries.csv');
const MOCK_PROJECTS_CSV_PATH = path.join(MOCK_DIR, 'projects.csv');

// Fixed column order for the CSV files.
const COLUMNS = [
  'id',
  'date',
  'project_id',
  'description',
  'start_time',
  'end_time',
  'duration_minutes',
];

const PROJECT_COLUMNS = ['id', 'project_name', 'color', 'ip_box', 'archived'];

const DEFAULT_PROJECT_COLOR = '#2a78d6';

const WEEKDAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// Functional default (not fictional sample data like mock-data/), seeded the first time
// settings.json is missing so a currently-active period always exists out of the box.
const DEFAULT_SETTINGS_PERIOD = {
  effective_date: '2000-01-01',
  hours_per_day: 8,
  work_days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
};

/**
 * Make sure data/entries.csv, data/projects.csv, data/settings.json and
 * data/holidays.json exist. A missing CSV is seeded from mock-data/ (fictional
 * sample data) when available, so a fresh clone has something to show;
 * otherwise it's created with just a header row. settings.json and
 * holidays.json have no mock-data counterpart — settings.json is seeded with
 * DEFAULT_SETTINGS_PERIOD (a real functional default) and holidays.json starts
 * out empty, since there's no sensible default holiday list.
 * Never touches a file that already exists, so real data is never overwritten.
 */
function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(PROJECTS_CSV_PATH)) {
    if (fs.existsSync(MOCK_PROJECTS_CSV_PATH)) {
      fs.copyFileSync(MOCK_PROJECTS_CSV_PATH, PROJECTS_CSV_PATH);
    } else {
      writeProjects([]);
    }
  }
  if (!fs.existsSync(CSV_PATH)) {
    if (fs.existsSync(MOCK_CSV_PATH)) {
      fs.copyFileSync(MOCK_CSV_PATH, CSV_PATH);
    } else {
      writeEntries([]);
    }
  }
  if (!fs.existsSync(SETTINGS_PATH)) {
    writeSettings([{ id: 1, ...DEFAULT_SETTINGS_PERIOD }]);
  }
  if (!fs.existsSync(HOLIDAYS_PATH)) {
    writeHolidays([]);
  }
}

/** Read and parse the whole CSV file into an array of entry objects. */
function readEntries() {
  ensureDataFile();
  const raw = fs.readFileSync(CSV_PATH, 'utf8');
  if (!raw.trim()) {
    return [];
  }
  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true,
  });
  return records.map((r) => ({
    ...r,
    id: Number(r.id),
    project_id: Number(r.project_id),
    duration_minutes: r.duration_minutes === '' ? 0 : Number(r.duration_minutes),
  }));
}

/** Rewrite the whole CSV file from an array of entry objects. */
function writeEntries(entries) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const csv = stringify(entries, {
    header: true,
    columns: COLUMNS,
  });
  fs.writeFileSync(CSV_PATH, csv, 'utf8');
}

/** Read and parse the whole projects CSV file into an array of project objects. */
function readProjects() {
  ensureDataFile();
  const raw = fs.readFileSync(PROJECTS_CSV_PATH, 'utf8');
  if (!raw.trim()) {
    return [];
  }
  const records = parse(raw, {
    columns: true,
    skip_empty_lines: true,
  });
  return records.map((r) => ({
    ...r,
    id: Number(r.id),
    ip_box: r.ip_box === 'true',
    archived: r.archived === 'true',
  }));
}

/** Rewrite the whole projects CSV file from an array of project objects. */
function writeProjects(projects) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const csv = stringify(projects, {
    header: true,
    columns: PROJECT_COLUMNS,
    cast: { boolean: (value) => (value ? 'true' : 'false') },
  });
  fs.writeFileSync(PROJECTS_CSV_PATH, csv, 'utf8');
}

/** Read settings.json and return its periods as a plain array (unwraps the on-disk { periods } shape). */
function readSettings() {
  ensureDataFile();
  const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
  if (!raw.trim()) return [];
  const parsed = JSON.parse(raw);
  return parsed.periods || [];
}

/** Rewrite settings.json from an array of period objects, always stored in chronological order. */
function writeSettings(periods) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const sorted = [...periods].sort((a, b) => a.effective_date.localeCompare(b.effective_date));
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify({ periods: sorted }, null, 2), 'utf8');
}

// Descending by effective_date (most recent/future first) — mirrors the newest-first sort
// GET /api/entries already applies.
function sortByEffectiveDate(periods) {
  return [...periods].sort((a, b) => b.effective_date.localeCompare(a.effective_date));
}

// Dedupes and orders a work_days array to canonical Mon->Sun order regardless of input order.
function normalizeWorkDays(work_days) {
  return WEEKDAY_KEYS.filter((key) => work_days.includes(key));
}

// Returns an error string, or null if the payload is valid. excludeId lets PUT validate
// against every *other* period when checking for a duplicate effective_date.
function validateSettingsPeriod({ effective_date, hours_per_day, work_days }, existingPeriods, excludeId) {
  if (!effective_date) return 'effective_date is required';
  if (typeof hours_per_day !== 'number' || !Number.isFinite(hours_per_day) || hours_per_day <= 0 || hours_per_day > 24) {
    return 'hours_per_day must be a number greater than 0 and at most 24';
  }
  if (!Array.isArray(work_days) || work_days.length === 0) {
    return 'work_days must include at least one day';
  }
  if (work_days.some((d) => !WEEKDAY_KEYS.includes(d))) {
    return 'work_days contains an invalid day';
  }
  if (existingPeriods.some((p) => p.effective_date === effective_date && p.id !== excludeId)) {
    return 'A period with this effective date already exists';
  }
  return null;
}

/** Read holidays.json and return its dates as a plain array (unwraps the on-disk { dates } shape). */
function readHolidays() {
  ensureDataFile();
  const raw = fs.readFileSync(HOLIDAYS_PATH, 'utf8');
  if (!raw.trim()) return [];
  const parsed = JSON.parse(raw);
  return parsed.dates || [];
}

/** Rewrite holidays.json from an array of date strings, deduped and sorted chronologically. */
function writeHolidays(dates) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const sorted = [...new Set(dates)].sort();
  fs.writeFileSync(HOLIDAYS_PATH, JSON.stringify({ dates: sorted }, null, 2), 'utf8');
}

/** Minutes between "HH:MM" start/end on the same day. Negative spans clamp to 0 (no overnight entries yet). */
function computeDurationMinutes(startTime, endTime) {
  const [sh, sm] = String(startTime).split(':').map(Number);
  const [eh, em] = String(endTime).split(':').map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) {
    return 0;
  }
  const minutes = eh * 60 + em - (sh * 60 + sm);
  return minutes >= 0 ? minutes : 0;
}

function nextId(items) {
  return items.reduce((max, e) => Math.max(max, e.id || 0), 0) + 1;
}

app.use(express.json());
app.use(express.static(path.join(BASE_DIR, 'public')));

app.get('/recap', (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'public', 'recap.html'));
});

app.get('/projects', (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'public', 'projects.html'));
});

app.get('/settings', (req, res) => {
  res.sendFile(path.join(BASE_DIR, 'public', 'settings.html'));
});

app.get('/api/projects', (req, res) => {
  res.json(readProjects());
});

app.post('/api/projects', (req, res) => {
  const { project_name, color, ip_box } = req.body || {};
  if (!project_name) {
    return res.status(400).json({ error: 'project_name is required' });
  }

  const projects = readProjects();
  const project = {
    id: nextId(projects),
    project_name,
    color: color || DEFAULT_PROJECT_COLOR,
    ip_box: Boolean(ip_box),
    archived: false,
  };
  projects.push(project);
  writeProjects(projects);
  res.status(201).json(project);
});

app.put('/api/projects/:id', (req, res) => {
  const id = Number(req.params.id);
  const projects = readProjects();
  const idx = projects.findIndex((p) => p.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const updated = { ...projects[idx], ...req.body, id };
  updated.ip_box = Boolean(updated.ip_box);
  updated.archived = Boolean(updated.archived);
  projects[idx] = updated;
  writeProjects(projects);
  res.json(updated);
});

app.delete('/api/projects/:id', (req, res) => {
  const id = Number(req.params.id);
  const projects = readProjects();
  const filtered = projects.filter((p) => p.id !== id);
  if (filtered.length === projects.length) {
    return res.status(404).json({ error: 'Project not found' });
  }
  writeProjects(filtered);
  res.status(204).end();
});

app.get('/api/settings', (req, res) => {
  res.json(sortByEffectiveDate(readSettings()));
});

app.post('/api/settings', (req, res) => {
  const { effective_date, hours_per_day, work_days } = req.body || {};
  const periods = readSettings();
  const error = validateSettingsPeriod({ effective_date, hours_per_day, work_days }, periods, null);
  if (error) {
    return res.status(400).json({ error });
  }

  const period = {
    id: nextId(periods),
    effective_date,
    hours_per_day: Number(hours_per_day),
    work_days: normalizeWorkDays(work_days),
  };
  periods.push(period);
  writeSettings(periods);
  res.status(201).json(period);
});

app.put('/api/settings/:id', (req, res) => {
  const id = Number(req.params.id);
  const periods = readSettings();
  const idx = periods.findIndex((p) => p.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Settings period not found' });
  }

  const merged = { ...periods[idx], ...req.body, id };
  const error = validateSettingsPeriod(merged, periods, id);
  if (error) {
    return res.status(400).json({ error });
  }

  merged.hours_per_day = Number(merged.hours_per_day);
  merged.work_days = normalizeWorkDays(merged.work_days);
  periods[idx] = merged;
  writeSettings(periods);
  res.json(merged);
});

app.delete('/api/settings/:id', (req, res) => {
  const id = Number(req.params.id);
  const periods = readSettings();
  const filtered = periods.filter((p) => p.id !== id);
  if (filtered.length === periods.length) {
    return res.status(404).json({ error: 'Settings period not found' });
  }
  writeSettings(filtered);
  res.status(204).end();
});

app.get('/api/holidays', (req, res) => {
  res.json(readHolidays());
});

app.post('/api/holidays', (req, res) => {
  const { date } = req.body || {};
  if (!date) {
    return res.status(400).json({ error: 'date is required' });
  }
  const dates = readHolidays();
  if (!dates.includes(date)) {
    dates.push(date);
    writeHolidays(dates);
  }
  res.status(201).json({ date });
});

app.delete('/api/holidays/:date', (req, res) => {
  const { date } = req.params;
  const dates = readHolidays();
  const filtered = dates.filter((d) => d !== date);
  if (filtered.length === dates.length) {
    return res.status(404).json({ error: 'Holiday not found' });
  }
  writeHolidays(filtered);
  res.status(204).end();
});

app.get('/api/entries', (req, res) => {
  const entries = readEntries();
  entries.sort((a, b) => `${b.date} ${b.start_time}`.localeCompare(`${a.date} ${a.start_time}`));
  res.json(entries);
});

app.post('/api/entries', (req, res) => {
  const { date, project_id, description, start_time, end_time } = req.body || {};
  if (!date || !project_id || !start_time || !end_time) {
    return res.status(400).json({ error: 'date, project_id, start_time and end_time are required' });
  }

  const matchedProject = readProjects().find((p) => p.id === Number(project_id));
  if (!matchedProject) {
    return res.status(400).json({ error: 'Unknown project' });
  }

  const entries = readEntries();
  const entry = {
    id: nextId(entries),
    date,
    project_id: matchedProject.id,
    description: description || '',
    start_time,
    end_time,
    duration_minutes: computeDurationMinutes(start_time, end_time),
  };
  entries.push(entry);
  writeEntries(entries);
  res.status(201).json(entry);
});

app.put('/api/entries/:id', (req, res) => {
  const id = Number(req.params.id);
  const entries = readEntries();
  const idx = entries.findIndex((e) => e.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: 'Entry not found' });
  }

  const updated = { ...entries[idx], ...req.body, id };
  if (req.body && req.body.project_id !== undefined) {
    const matchedProject = readProjects().find((p) => p.id === Number(req.body.project_id));
    if (!matchedProject) {
      return res.status(400).json({ error: 'Unknown project' });
    }
    updated.project_id = matchedProject.id;
  }
  updated.duration_minutes = computeDurationMinutes(updated.start_time, updated.end_time);
  entries[idx] = updated;
  writeEntries(entries);
  res.json(updated);
});

app.delete('/api/entries/:id', (req, res) => {
  const id = Number(req.params.id);
  const entries = readEntries();
  const filtered = entries.filter((e) => e.id !== id);
  if (filtered.length === entries.length) {
    return res.status(404).json({ error: 'Entry not found' });
  }
  writeEntries(filtered);
  res.status(204).end();
});

/** Best-effort open the given URL in the user's default browser. Only used for
 * packaged builds, where there's no terminal-savvy developer to navigate
 * there manually; failures are silently ignored. */
function openBrowser(url) {
  const { spawn } = require('child_process');
  const [command, args] =
    process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '""', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { stdio: 'ignore', detached: true });
    // spawn() reports a missing/failed opener asynchronously via this event,
    // not by throwing — without a listener that would crash the process.
    child.on('error', () => {});
    child.unref();
  } catch {
    // No browser to open automatically; the user can still navigate there.
  }
}

ensureDataFile();
app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Time Tracker running at ${url}`);
  console.log(`Data file: ${CSV_PATH}`);
  console.log(`Projects file: ${PROJECTS_CSV_PATH}`);
  console.log(`Settings file: ${SETTINGS_PATH}`);
  console.log(`Holidays file: ${HOLIDAYS_PATH}`);
  if (process.pkg) {
    openBrowser(url);
  }
});
