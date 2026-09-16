const state = {
  entries: [],
  projects: [],
  holidays: [], // ISO date strings — excluded from the working-day counts below
  settingsPeriods: [], // from /api/settings — supplies each date's expected work days
  granularity: 'week', // 'day' | 'week' | 'month' | 'year'
  anchorDate: todayISO(),
  trendStackByProject: false,
};

const MAX_PROJECT_ROWS = 7; // top-N projects shown individually; the rest fold into "Other"
const DEFAULT_PROJECT_COLOR = '#898781'; // shown for an entry whose project was deleted
const CHART_HEIGHT_PX = 160; // px height of the trend chart's bar area
const MIN_BAR_COLUMN_PX = 24; // px min width per trend bar before the chart scrolls horizontally

const els = {
  periodTitle: document.getElementById('periodTitle'),
  periodRangeLabel: document.getElementById('periodRangeLabel'),
  periodRangeField: document.getElementById('periodRangeField'),
  periodRangePopup: document.getElementById('periodRangePopup'),
  granularityTabs: document.getElementById('granularityTabs'),
  prevPeriodBtn: document.getElementById('prevPeriodBtn'),
  nextPeriodBtn: document.getElementById('nextPeriodBtn'),
  thisPeriodBtn: document.getElementById('thisPeriodBtn'),
  summaryTotal: document.getElementById('summaryTotal'),
  summaryAvgPerDay: document.getElementById('summaryAvgPerDay'),
  summaryActiveDays: document.getElementById('summaryActiveDays'),
  projectBreakdown: document.getElementById('projectBreakdown'),
  ipBoxMinutes: document.getElementById('ipBoxMinutes'),
  nonIpBoxMinutes: document.getElementById('nonIpBoxMinutes'),
  ipBoxPercent: document.getElementById('ipBoxPercent'),
  ipBoxRatioBar: document.getElementById('ipBoxRatioBar'),
  ipBoxTrendChart: document.getElementById('ipBoxTrendChart'),
  trendStackByProject: document.getElementById('trendStackByProject'),
  trendNotApplicable: document.getElementById('trendNotApplicable'),
  trendChartScroll: document.getElementById('trendChartScroll'),
  trendChart: document.getElementById('trendChart'),
};

// ---- Period / granularity model -------------------------------------------------

function periodRange(granularity, anchorDate) {
  if (granularity === 'day') return { start: anchorDate, end: anchorDate };
  if (granularity === 'week') {
    const start = mondayOf(anchorDate);
    return { start, end: addDays(start, 6) };
  }
  if (granularity === 'month') {
    return { start: startOfMonth(anchorDate), end: endOfMonth(anchorDate) };
  }
  return { start: startOfYear(anchorDate), end: endOfYear(anchorDate) }; // year
}

function shiftPeriod(granularity, anchorDate, direction) {
  if (granularity === 'day') return addDays(anchorDate, direction);
  if (granularity === 'week') return addDays(anchorDate, direction * 7);
  if (granularity === 'month') return addMonths(anchorDate, direction);
  return addYears(anchorDate, direction); // year
}

function periodLabel(granularity, range) {
  const today = todayISO();
  if (granularity === 'day') {
    return range.start === today ? 'Today' : formatDateShort(range.start);
  }
  if (granularity === 'week') {
    const thisWeekStart = mondayOf(today);
    if (range.start === thisWeekStart) return 'This Week';
    if (range.start === addDays(thisWeekStart, -7)) return 'Last Week';
    if (range.start === addDays(thisWeekStart, 7)) return 'Next Week';
    return `Week ${formatDateShort(range.start)} – ${formatDateShort(range.end)}`;
  }
  if (granularity === 'month') {
    if (range.start === startOfMonth(today)) return 'This Month';
    const [y, m] = range.start.split('-');
    return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
  }
  // year
  const y = range.start.slice(0, 4);
  return y === today.slice(0, 4) ? 'This Year' : y;
}

// The exact date(s) shown next to the Prev/Next arrows — always the concrete range,
// unlike periodLabel's friendly "This Week"/"Today" shortcuts above it.
function periodRangeText(granularity, range) {
  if (granularity === 'day') {
    const [y, m, d] = range.start.split('-').map(Number);
    return `${MONTH_NAMES[m - 1].slice(0, 3)} ${d}, ${y}`;
  }
  if (granularity === 'week') {
    return `${formatDateShort(range.start)} – ${formatDateShort(range.end)}`;
  }
  if (granularity === 'month') {
    const [y, m] = range.start.split('-');
    return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
  }
  // year
  return range.start.slice(0, 4);
}

// ---- Aggregation ------------------------------------------------------------------

function filterEntriesInRange(entries, range) {
  return entries.filter((e) => e.date >= range.start && e.date <= range.end);
}

function projectsById(projects) {
  return new Map(projects.map((p) => [p.id, p]));
}

function sumMinutes(entries) {
  return entries.reduce((sum, e) => sum + (Number(e.duration_minutes) || 0), 0);
}

function groupByProject(entries) {
  const map = new Map();
  for (const e of entries) {
    map.set(e.project_id, (map.get(e.project_id) || 0) + (Number(e.duration_minutes) || 0));
  }
  return map;
}

// Walks every date in range once, counting only working days (not a holiday, not off per the
// active settings period) — both as the average's divisor and as the "days with entries"
// denominator, so a holiday/non-work day never inflates either figure. A day off that happens to
// have logged entries anyway (e.g. on-call work) still contributes its minutes to totalMinutes
// elsewhere, it just isn't counted as one of the "expected" working days here.
function totalsFor(entries, range, holidays, settingsPeriods) {
  const totalMinutes = sumMinutes(entries);
  const datesWithEntries = new Set(entries.map((e) => e.date));

  let workingDayCount = 0;
  let activeDayCount = 0;
  for (let d = range.start; d <= range.end; d = addDays(d, 1)) {
    if (isOffDay(d, holidays, settingsPeriods)) continue;
    workingDayCount++;
    if (datesWithEntries.has(d)) activeDayCount++;
  }

  return {
    totalMinutes,
    workingDayCount,
    activeDayCount,
    avgPerDayMinutes: workingDayCount > 0 ? totalMinutes / workingDayCount : 0,
  };
}

// An entry whose project was deleted counts as non-IP-box, matching the calendar's existing
// fallback for a missing project (app.js's DEFAULT_PROJECT_COLOR / "Unknown" name).
function splitByIpBox(entries, projById) {
  let ipBoxMinutes = 0;
  let nonIpBoxMinutes = 0;
  for (const e of entries) {
    const minutes = Number(e.duration_minutes) || 0;
    const project = projById.get(e.project_id);
    if (project && project.ip_box) {
      ipBoxMinutes += minutes;
    } else {
      nonIpBoxMinutes += minutes;
    }
  }
  return { ipBoxMinutes, nonIpBoxMinutes };
}

// ---- Bucketing (for the trend charts) ----------------------------------------------

function pickBucketUnit(granularity) {
  if (granularity === 'day') return null;
  if (granularity === 'week' || granularity === 'month') return 'day';
  return 'month'; // year
}

function bucketKeyFor(dateStr, unit) {
  if (unit === 'day') return dateStr;
  if (unit === 'week') return mondayOf(dateStr);
  if (unit === 'month') return startOfMonth(dateStr);
  return startOfYear(dateStr);
}

// Every bucket start in range, including ones with no entries, so empty buckets still
// render as a visible zero bar instead of being silently skipped.
function enumerateBuckets(range, unit) {
  if (!unit) return [];
  const buckets = [];
  let cursor = bucketKeyFor(range.start, unit);
  while (cursor <= range.end) {
    buckets.push(cursor);
    cursor =
      unit === 'day' ? addDays(cursor, 1)
      : unit === 'week' ? addDays(cursor, 7)
      : unit === 'month' ? addMonths(cursor, 1)
      : addYears(cursor, 1);
  }
  return buckets;
}

function bucketLabel(bucketStart, unit) {
  if (unit === 'day' || unit === 'week') return formatDateShort(bucketStart);
  if (unit === 'month') return MONTH_NAMES[Number(bucketStart.slice(5, 7)) - 1].slice(0, 3);
  return bucketStart.slice(0, 4);
}

function groupByBucket(entries, unit) {
  const map = new Map();
  for (const e of entries) {
    const key = bucketKeyFor(e.date, unit);
    map.set(key, (map.get(key) || 0) + (Number(e.duration_minutes) || 0));
  }
  return map;
}

function groupByBucketAndProject(entries, unit) {
  const map = new Map();
  for (const e of entries) {
    const key = bucketKeyFor(e.date, unit);
    if (!map.has(key)) map.set(key, new Map());
    const inner = map.get(key);
    inner.set(e.project_id, (inner.get(e.project_id) || 0) + (Number(e.duration_minutes) || 0));
  }
  return map;
}

function ipBoxTrendByBucket(entries, unit, projById) {
  const map = new Map();
  for (const e of entries) {
    const key = bucketKeyFor(e.date, unit);
    if (!map.has(key)) map.set(key, { ipBoxMinutes: 0, nonIpBoxMinutes: 0 });
    const bucket = map.get(key);
    const minutes = Number(e.duration_minutes) || 0;
    const project = projById.get(e.project_id);
    if (project && project.ip_box) bucket.ipBoxMinutes += minutes;
    else bucket.nonIpBoxMinutes += minutes;
  }
  return map;
}

// ---- Rendering ----------------------------------------------------------------------

function renderPeriodHeader(range) {
  els.periodTitle.textContent = periodLabel(state.granularity, range);
  els.periodRangeLabel.textContent = periodRangeText(state.granularity, range);
  const thisLabels = { day: 'Today', week: 'This week', month: 'This month', year: 'This year' };
  els.thisPeriodBtn.textContent = thisLabels[state.granularity];
}

function renderSummaryTiles(entries, range, holidays, settingsPeriods) {
  const { totalMinutes, workingDayCount, activeDayCount, avgPerDayMinutes } = totalsFor(
    entries,
    range,
    holidays,
    settingsPeriods
  );
  els.summaryTotal.textContent = formatMinutes(totalMinutes);
  els.summaryAvgPerDay.textContent = formatMinutes(avgPerDayMinutes);
  els.summaryActiveDays.textContent = `${activeDayCount} / ${workingDayCount}`;
}

function renderBreakdownRow(name, color, minutes, pct) {
  return `
    <li class="bar-row">
      <div class="bar-row-header">
        <span><span class="color-dot" style="background:${color}"></span>${escapeHtml(name)}</span>
        <span>${formatMinutes(minutes)}</span>
      </div>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%; background:${color}"></div></div>
    </li>`;
}

function renderProjectBreakdown(entries, projById) {
  const grouped = groupByProject(entries);
  const total = sumMinutes(entries);
  const sorted = [...grouped.entries()].sort((a, b) => b[1] - a[1]);

  if (!sorted.length) {
    els.projectBreakdown.innerHTML = '<li><span>No entries in this period</span></li>';
    return;
  }

  const top = sorted.slice(0, MAX_PROJECT_ROWS);
  const rest = sorted.slice(MAX_PROJECT_ROWS);

  const rows = top.map(([projectId, minutes]) => {
    const project = projById.get(projectId);
    const name = project ? project.project_name : 'Unknown';
    const color = project ? project.color : DEFAULT_PROJECT_COLOR;
    const pct = total > 0 ? (minutes / total) * 100 : 0;
    return renderBreakdownRow(name, color, minutes, pct);
  });

  if (rest.length) {
    const otherMinutes = rest.reduce((sum, [, minutes]) => sum + minutes, 0);
    const pct = total > 0 ? (otherMinutes / total) * 100 : 0;
    rows.push(renderBreakdownRow('Other', 'var(--muted)', otherMinutes, pct));
  }

  els.projectBreakdown.innerHTML = rows.join('');
}

function renderIpBoxCard(entries, range, projById) {
  const { ipBoxMinutes, nonIpBoxMinutes } = splitByIpBox(entries, projById);
  const total = ipBoxMinutes + nonIpBoxMinutes;
  const pct = total > 0 ? (ipBoxMinutes / total) * 100 : 0;

  els.ipBoxMinutes.textContent = formatMinutes(ipBoxMinutes);
  els.nonIpBoxMinutes.textContent = formatMinutes(nonIpBoxMinutes);
  els.ipBoxPercent.textContent = `${Math.round(pct)}%`;

  els.ipBoxRatioBar.innerHTML =
    total > 0
      ? `<div class="ipbox-bar-segment ipbox-swatch-yes" style="width:${pct}%"></div>
         <div class="ipbox-bar-segment ipbox-swatch-no" style="width:${100 - pct}%"></div>`
      : '';

  const unit = pickBucketUnit(state.granularity) || 'day';
  const buckets = enumerateBuckets(range, unit);
  const trend = ipBoxTrendByBucket(entries, unit, projById);

  els.ipBoxTrendChart.innerHTML = buckets
    .map((bucketStart) => {
      const b = trend.get(bucketStart) || { ipBoxMinutes: 0, nonIpBoxMinutes: 0 };
      const bTotal = b.ipBoxMinutes + b.nonIpBoxMinutes;
      const yesPct = bTotal > 0 ? (b.ipBoxMinutes / bTotal) * 100 : 0;
      const tooltip = `${bucketLabel(bucketStart, unit)}: ${formatMinutes(b.ipBoxMinutes)} IP Box, ${formatMinutes(b.nonIpBoxMinutes)} non-IP Box`;
      const segments =
        bTotal > 0
          ? `<div class="ipbox-bar-segment ipbox-swatch-yes" style="height:${yesPct}%"></div>
             <div class="ipbox-bar-segment ipbox-swatch-no" style="height:${100 - yesPct}%"></div>`
          : '';
      return `
        <div class="ipbox-trend-col" title="${escapeHtml(tooltip)}">
          <div class="ipbox-trend-bar">${segments}</div>
        </div>`;
    })
    .join('');
}

function renderTrendChart(entries, range, projById) {
  const unit = pickBucketUnit(state.granularity);
  if (!unit) {
    els.trendNotApplicable.hidden = false;
    els.trendChartScroll.hidden = true;
    return;
  }
  els.trendNotApplicable.hidden = true;
  els.trendChartScroll.hidden = false;

  const buckets = enumerateBuckets(range, unit);
  const totalsByBucket = groupByBucket(entries, unit);
  const maxMinutes = Math.max(1, ...buckets.map((b) => totalsByBucket.get(b) || 0));

  const stacked = state.trendStackByProject;
  let topProjectIds = [];
  let byBucketAndProject = null;
  if (stacked) {
    const overallGrouped = groupByProject(entries);
    topProjectIds = [...overallGrouped.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_PROJECT_ROWS)
      .map(([id]) => id);
    byBucketAndProject = groupByBucketAndProject(entries, unit);
  }

  const showAllLabels = buckets.length <= 14;
  const labelStep = showAllLabels ? 1 : Math.ceil(buckets.length / 10);

  els.trendChart.innerHTML = buckets
    .map((bucketStart, index) => {
      const bucketMinutes = totalsByBucket.get(bucketStart) || 0;
      const barHeight = bucketMinutes > 0 ? Math.max((bucketMinutes / maxMinutes) * CHART_HEIGHT_PX, 2) : 0;
      const label = bucketLabel(bucketStart, unit);
      const showLabel = index % labelStep === 0;

      let barInner = '';
      if (stacked && bucketMinutes > 0) {
        const projectMinutesMap = byBucketAndProject.get(bucketStart) || new Map();
        let otherMinutes = 0;
        const segments = [];
        for (const [projectId, minutes] of projectMinutesMap.entries()) {
          if (topProjectIds.includes(projectId)) {
            segments.push({ projectId, minutes });
          } else {
            otherMinutes += minutes;
          }
        }
        segments.sort((a, b) => topProjectIds.indexOf(a.projectId) - topProjectIds.indexOf(b.projectId));
        if (otherMinutes > 0) segments.push({ projectId: null, minutes: otherMinutes });

        barInner = segments
          .map((seg) => {
            const project = seg.projectId !== null ? projById.get(seg.projectId) : null;
            const color = project ? project.color : 'var(--muted)';
            const name = project ? project.project_name : 'Other';
            const pct = (seg.minutes / bucketMinutes) * 100;
            const segTooltip = `${name}: ${formatMinutes(seg.minutes)}`;
            return `<div class="trend-segment" style="height:${pct}%; background:${color};" title="${escapeHtml(segTooltip)}"></div>`;
          })
          .join('');
      }

      const tooltip = `${label}: ${formatMinutes(bucketMinutes)}`;
      return `
        <div class="trend-col">
          <div class="trend-bar-area">
            <div class="trend-bar" style="height:${barHeight}px" title="${escapeHtml(tooltip)}">${barInner}</div>
          </div>
          <span class="trend-bar-label">${showLabel ? escapeHtml(label) : ''}</span>
        </div>`;
    })
    .join('');

  els.trendChart.style.minWidth = `${buckets.length * MIN_BAR_COLUMN_PX}px`;
}

function renderAll() {
  const range = periodRange(state.granularity, state.anchorDate);
  const entries = filterEntriesInRange(state.entries, range);
  const projById = projectsById(state.projects);

  renderPeriodHeader(range);
  renderSummaryTiles(entries, range, state.holidays, state.settingsPeriods);
  renderProjectBreakdown(entries, projById);
  renderIpBoxCard(entries, range, projById);
  renderTrendChart(entries, range, projById);
}

// ---- Data fetching --------------------------------------------------------------------

async function fetchEntries() {
  const res = await fetch('/api/entries');
  if (!res.ok) throw new Error('Failed to load entries');
  state.entries = await res.json();
}

async function fetchProjects() {
  const res = await fetch('/api/projects');
  if (!res.ok) throw new Error('Failed to load projects');
  state.projects = await res.json();
}

async function fetchHolidays() {
  const res = await fetch('/api/holidays');
  if (!res.ok) throw new Error('Failed to load holidays');
  state.holidays = await res.json();
}

async function fetchSettings() {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error('Failed to load settings');
  state.settingsPeriods = await res.json();
}

// ---- Period range picker (click the date range to jump to a specific period) --------------

// Navigation cursor for whichever grid is currently open — separate from state so paging
// through months/years in the popup doesn't change the selected period until a cell is clicked.
const periodPicker = {
  mode: null, // 'day' | 'week' | 'month' | 'year' — mirrors state.granularity while open
  viewMonth: null, // ISO YYYY-MM-01, used by the day/week grid
  viewYear: null, // number, used by the month grid
  viewYearsStart: null, // number, first year shown by the year grid (12 per page)
};

function isPeriodPickerOpen() {
  return !els.periodRangePopup.hidden;
}

function closePeriodPicker() {
  els.periodRangePopup.hidden = true;
}

function openPeriodPicker() {
  periodPicker.mode = state.granularity;
  if (periodPicker.mode === 'day' || periodPicker.mode === 'week') {
    periodPicker.viewMonth = `${state.anchorDate.slice(0, 7)}-01`;
  } else if (periodPicker.mode === 'month') {
    periodPicker.viewYear = Number(state.anchorDate.slice(0, 4));
  } else if (periodPicker.mode === 'year') {
    const y = Number(state.anchorDate.slice(0, 4));
    periodPicker.viewYearsStart = y - (y % 12);
  }
  renderPeriodPicker();
  const rect = els.periodRangeLabel.getBoundingClientRect();
  els.periodRangePopup.style.top = `${rect.bottom + 4}px`;
  els.periodRangePopup.style.left = `${rect.left}px`;
  els.periodRangePopup.hidden = false;
}

function selectPeriodDate(dateStr) {
  state.anchorDate = dateStr;
  closePeriodPicker();
  renderAll();
}

function renderPeriodPicker() {
  if (periodPicker.mode === 'day' || periodPicker.mode === 'week') renderDayGridPicker();
  else if (periodPicker.mode === 'month') renderMonthGridPicker();
  else if (periodPicker.mode === 'year') renderYearGridPicker();
}

function renderDayGridPicker() {
  const [y, m] = periodPicker.viewMonth.split('-').map(Number);
  const gridStart = mondayOf(periodPicker.viewMonth);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = todayISO();
  const weekRange = periodPicker.mode === 'week' ? periodRange('week', state.anchorDate) : null;

  const weekdayHeaders = WEEKDAY_NAMES.map((n) => `<div class="date-picker-weekday">${n}</div>`).join('');
  const dayCells = days
    .map((d) => {
      const classes = ['date-picker-day'];
      if (Number(d.slice(5, 7)) !== m) classes.push('outside');
      if (d === today) classes.push('today');
      if (periodPicker.mode === 'day' && d === state.anchorDate) classes.push('selected');
      if (weekRange && d >= weekRange.start && d <= weekRange.end) classes.push('selected');
      return `<button type="button" class="${classes.join(' ')}" data-date="${d}">${Number(d.slice(8, 10))}</button>`;
    })
    .join('');

  els.periodRangePopup.innerHTML = `
    <div class="date-picker-header">
      <button type="button" class="date-picker-nav" data-nav="prev" aria-label="Previous month">&lsaquo;</button>
      <span class="date-picker-month-label">${MONTH_NAMES[m - 1]} ${y}</span>
      <button type="button" class="date-picker-nav" data-nav="next" aria-label="Next month">&rsaquo;</button>
    </div>
    <div class="date-picker-grid">${weekdayHeaders}${dayCells}</div>
  `;
}

function renderMonthGridPicker() {
  const year = periodPicker.viewYear;
  const today = todayISO();
  const selectedYearMonth = state.granularity === 'month' ? state.anchorDate.slice(0, 7) : null;

  const cells = MONTH_NAMES.map((name, idx) => {
    const ym = `${year}-${String(idx + 1).padStart(2, '0')}`;
    const classes = ['date-picker-day'];
    if (ym === today.slice(0, 7)) classes.push('today');
    if (ym === selectedYearMonth) classes.push('selected');
    return `<button type="button" class="${classes.join(' ')}" data-year-month="${ym}">${name.slice(0, 3)}</button>`;
  }).join('');

  els.periodRangePopup.innerHTML = `
    <div class="date-picker-header">
      <button type="button" class="date-picker-nav" data-nav="prev" aria-label="Previous year">&lsaquo;</button>
      <span class="date-picker-month-label">${year}</span>
      <button type="button" class="date-picker-nav" data-nav="next" aria-label="Next year">&rsaquo;</button>
    </div>
    <div class="date-picker-grid-months">${cells}</div>
  `;
}

function renderYearGridPicker() {
  const startYear = periodPicker.viewYearsStart;
  const years = Array.from({ length: 12 }, (_, i) => startYear + i);
  const todayYear = todayISO().slice(0, 4);
  const selectedYear = state.granularity === 'year' ? state.anchorDate.slice(0, 4) : null;

  const cells = years
    .map((yr) => {
      const classes = ['date-picker-day'];
      if (String(yr) === todayYear) classes.push('today');
      if (String(yr) === selectedYear) classes.push('selected');
      return `<button type="button" class="${classes.join(' ')}" data-year="${yr}">${yr}</button>`;
    })
    .join('');

  els.periodRangePopup.innerHTML = `
    <div class="date-picker-header">
      <button type="button" class="date-picker-nav" data-nav="prev" aria-label="Previous years">&lsaquo;</button>
      <span class="date-picker-month-label">${years[0]} – ${years[years.length - 1]}</span>
      <button type="button" class="date-picker-nav" data-nav="next" aria-label="Next years">&rsaquo;</button>
    </div>
    <div class="date-picker-grid-months">${cells}</div>
  `;
}

els.periodRangeLabel.addEventListener('click', (event) => {
  event.stopPropagation();
  if (isPeriodPickerOpen()) closePeriodPicker();
  else openPeriodPicker();
});

els.periodRangePopup.addEventListener('click', (event) => {
  // Stop here so the outside-click listener below never sees this event — prev/next re-render
  // the popup, which detaches the clicked button, making a contains() check on it unreliable.
  event.stopPropagation();

  const dayBtn = event.target.closest('[data-date]');
  if (dayBtn) {
    selectPeriodDate(dayBtn.dataset.date);
    return;
  }
  const monthBtn = event.target.closest('[data-year-month]');
  if (monthBtn) {
    selectPeriodDate(`${monthBtn.dataset.yearMonth}-01`);
    return;
  }
  const yearBtn = event.target.closest('[data-year]');
  if (yearBtn) {
    selectPeriodDate(`${yearBtn.dataset.year}-01-01`);
    return;
  }
  const navBtn = event.target.closest('.date-picker-nav');
  if (navBtn) {
    const dir = navBtn.dataset.nav === 'prev' ? -1 : 1;
    if (periodPicker.mode === 'day' || periodPicker.mode === 'week') {
      periodPicker.viewMonth = addMonths(periodPicker.viewMonth, dir);
    } else if (periodPicker.mode === 'month') {
      periodPicker.viewYear += dir;
    } else if (periodPicker.mode === 'year') {
      periodPicker.viewYearsStart += dir * 12;
    }
    renderPeriodPicker();
  }
});

function clearWeekHover() {
  els.periodRangePopup.querySelectorAll('.week-hover').forEach((el) => el.classList.remove('week-hover'));
}

// In week mode, hovering any day highlights its whole Mon–Sun week, not just that cell.
els.periodRangePopup.addEventListener('mouseover', (event) => {
  if (periodPicker.mode !== 'week') return;
  const dayBtn = event.target.closest('[data-date]');
  if (!dayBtn) {
    clearWeekHover();
    return;
  }
  const hoveredWeek = periodRange('week', dayBtn.dataset.date);
  els.periodRangePopup.querySelectorAll('[data-date]').forEach((el) => {
    el.classList.toggle('week-hover', el.dataset.date >= hoveredWeek.start && el.dataset.date <= hoveredWeek.end);
  });
});

els.periodRangePopup.addEventListener('mouseleave', clearWeekHover);

document.addEventListener('click', (event) => {
  if (isPeriodPickerOpen() && !els.periodRangeField.contains(event.target)) closePeriodPicker();
});

// ---- Event wiring ---------------------------------------------------------------------

els.granularityTabs.addEventListener('click', (event) => {
  const btn = event.target.closest('button[data-granularity]');
  if (!btn) return;
  state.granularity = btn.dataset.granularity;
  for (const b of els.granularityTabs.querySelectorAll('button')) {
    b.classList.toggle('active', b === btn);
  }
  closePeriodPicker();
  renderAll();
});

function applyPeriodChange(nextAnchorDate) {
  state.anchorDate = nextAnchorDate;
  closePeriodPicker();
  renderAll();
}

els.prevPeriodBtn.addEventListener('click', () => {
  applyPeriodChange(shiftPeriod(state.granularity, state.anchorDate, -1));
});
els.nextPeriodBtn.addEventListener('click', () => {
  applyPeriodChange(shiftPeriod(state.granularity, state.anchorDate, 1));
});
els.thisPeriodBtn.addEventListener('click', () => {
  applyPeriodChange(todayISO());
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closePeriodPicker();
});

els.trendStackByProject.addEventListener('change', () => {
  state.trendStackByProject = els.trendStackByProject.checked;
  renderAll();
});

Promise.all([fetchProjects(), fetchEntries(), fetchHolidays(), fetchSettings()])
  .then(() => {
    renderAll();
  })
  .catch((err) => {
    els.periodTitle.textContent = 'Failed to load';
    console.error(err);
  });
