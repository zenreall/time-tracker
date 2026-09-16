const state = {
  entries: [],
  projects: [],
  holidays: [], // ISO date strings ("YYYY-MM-DD") marked as non-work days
  settingsPeriods: [], // from /api/settings — used to shade regular (non-holiday) non-work days
  modalEntryId: null, // null = the modal is creating a new entry; otherwise the entry id it's editing
  weekOffset: 0, // 0 = current week, -1 = previous week, +1 = next week
  calendarScrollTop: null, // null = not yet initialized (first render defaults to DEFAULT_SCROLL_HOUR)
};

const HOUR_HEIGHT = 56; // px per hour of the calendar grid; keep in sync with --hour-height in style.css
const DEFAULT_SCROLL_HOUR = 8; // default scroll position shows DEFAULT_SCROLL_HOUR..+visible-hours (8am-6pm)
const DEFAULT_PROJECT_COLOR = '#898781'; // shown for an entry whose project was deleted
const DRAG_THRESHOLD_PX = 4; // pointer movement past this counts as a drag, not a click
const MIN_ENTRY_MINUTES = 15; // matches the 15-minute snap grid
const COMPACT_EVENT_HEIGHT_PX = 26; // below this, drop the time line so the name stays fully visible

const els = {
  summaryToday: document.getElementById('summaryToday'),
  summaryWeek: document.getElementById('summaryWeek'),
  summaryProjects: document.getElementById('summaryProjects'),
  calendarGrid: document.getElementById('calendarGrid'),
  calendarError: document.getElementById('calendarError'),
  weekTitle: document.getElementById('weekTitle'),
  weekRangeLabel: document.getElementById('weekRangeLabel'),
  weekRangeField: document.getElementById('weekRangeField'),
  weekRangePopup: document.getElementById('weekRangePopup'),
  prevWeekBtn: document.getElementById('prevWeekBtn'),
  nextWeekBtn: document.getElementById('nextWeekBtn'),
  thisWeekBtn: document.getElementById('thisWeekBtn'),
};

const holidayModalEls = {
  dialog: document.getElementById('holidayModal'),
  title: document.getElementById('holidayModalTitle'),
  text: document.getElementById('holidayModalText'),
  confirmBtn: document.getElementById('holidayModalConfirmBtn'),
  cancelBtn: document.getElementById('holidayModalCancelBtn'),
  closeBtn: document.getElementById('holidayModalCloseBtn'),
};
let holidayModalDate = null;

const modalEls = {
  dialog: document.getElementById('entryModal'),
  title: document.getElementById('modalTitle'),
  closeBtn: document.getElementById('modalCloseBtn'),
  form: document.getElementById('modalEntryForm'),
  date: document.getElementById('modalDate'),
  dateField: document.getElementById('modalDateField'),
  datePopup: document.getElementById('modalDatePopup'),
  startTime: document.getElementById('modalStartTime'),
  endTime: document.getElementById('modalEndTime'),
  project: document.getElementById('modalProject'),
  projectInput: document.getElementById('modalProjectInput'),
  projectPopup: document.getElementById('modalProjectPopup'),
  description: document.getElementById('modalDescription'),
  submitBtn: document.getElementById('modalSubmitBtn'),
  optionsWrapper: document.getElementById('modalOptionsWrapper'),
  optionsBtn: document.getElementById('modalOptionsBtn'),
  optionsMenu: document.getElementById('modalOptionsMenu'),
  duplicateBtn: document.getElementById('modalDuplicateBtn'),
  deleteBtn: document.getElementById('modalDeleteBtn'),
  formError: document.getElementById('modalFormError'),
};

let dragState = { phase: 'idle' };
// The calendar-event-preview shown behind the "New Entry" modal while it's open, if any.
// Separate from dragState.previewEl, which only lives for the duration of the drag gesture itself.
let openCreatePreviewEl = null;

function clearOpenCreatePreview() {
  if (openCreatePreviewEl) {
    const dayColEl = openCreatePreviewEl.parentElement;
    openCreatePreviewEl.remove();
    openCreatePreviewEl = null;
    if (dayColEl) resetDayLayout(dayColEl);
  }
}

// Auto-inserts the colon as digits are typed/pasted, e.g. "1000" -> "10:00" mid-keystroke.
function handleTimeInput(event) {
  const input = event.target;
  const digits = input.value.replace(/\D/g, '').slice(0, 4);
  input.value = digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

// Catches whatever handleTimeInput didn't fully resolve (e.g. "9" or "930" left on blur)
// by treating the last two digits as minutes and the rest as hours, then clamping to a valid 24h time.
function handleTimeBlur(event) {
  const input = event.target;
  const digits = input.value.replace(/\D/g, '').slice(0, 4);
  if (!digits) return;
  const hh = digits.length > 2 ? digits.slice(0, -2) : digits;
  const mm = digits.length > 2 ? digits.slice(-2) : '0';
  const h = Math.min(Math.max(Number(hh) || 0, 0), 23);
  const m = Math.min(Math.max(Number(mm) || 0, 0), 59);
  input.value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function minutesOfDay(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function minutesToHHMM(totalMinutes) {
  const h = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const m = String(totalMinutes % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function snapMinutes(minutes) {
  return Math.round(minutes / 15) * 15;
}

function rawMinutesFromY(rect, clientY) {
  return clamp(((clientY - rect.top) / HOUR_HEIGHT) * 60, 0, 1439);
}

// Assigns each {start,end} item a side-by-side column so overlapping items don't render on
// top of each other, the way calendar apps do. Items are grouped into clusters of transitively
// overlapping items (A overlaps B, B overlaps C => all three share a cluster even if A and C
// don't directly overlap); columnCount is computed per cluster, so an entry only shrinks when
// something it actually overlaps is present — unrelated entries elsewhere in the day stay full
// width. Shared by the persisted-entry layout and the live drag-to-create preview so both use
// the same overlap rules.
function assignColumns(items) {
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);

  const columnEnds = []; // columnEnds[i] = end time of the last item placed in column i
  const clusters = [];
  let clusterStart = 0;
  let clusterEnd = -Infinity;

  sorted.forEach((item, i) => {
    if (item.start >= clusterEnd) {
      if (i > clusterStart) clusters.push(sorted.slice(clusterStart, i));
      clusterStart = i;
    }
    clusterEnd = Math.max(clusterEnd, item.end);

    let column = columnEnds.findIndex((end) => end <= item.start);
    if (column === -1) {
      column = columnEnds.length;
    }
    columnEnds[column] = item.end;
    item.column = column;
  });
  if (sorted.length > clusterStart) clusters.push(sorted.slice(clusterStart));

  return clusters.flatMap((cluster) => {
    const columnCount = Math.max(...cluster.map((item) => item.column)) + 1;
    return cluster.map((item) => ({ ...item, columnCount }));
  });
}

function layoutDayEvents(dayEntries) {
  const items = dayEntries.map((e) => {
    const start = minutesOfDay(e.start_time);
    const duration = Math.max(Number(e.duration_minutes) || 0, 1); // avoid a literal 0px block
    return { entry: e, start, end: start + duration };
  });
  return assignColumns(items);
}

// Same as layoutDayEvents, but with a synthetic item for the in-progress create-drag preview
// mixed in, so real entries that overlap it shrink to share space instead of being covered by it.
function layoutDayEventsWithPreview(dayEntries, previewStart, previewEnd) {
  const items = dayEntries.map((e) => {
    const start = minutesOfDay(e.start_time);
    const duration = Math.max(Number(e.duration_minutes) || 0, 1);
    return { entry: e, start, end: start + duration };
  });
  items.push({ isPreview: true, start: previewStart, end: Math.max(previewEnd, previewStart + 1) });
  return assignColumns(items);
}

function applyColumnPosition(el, item) {
  const widthPct = 100 / item.columnCount;
  const leftPct = item.column * widthPct;
  el.style.left = `calc(${leftPct}% + 2px)`;
  el.style.width = `calc(${widthPct}% - 4px)`;
}

// Re-lays-out a day column's real entries alongside the create preview so both fit side by
// side instead of overlapping. Called on every drag move, so it must stay cheap.
function updateDayLayoutForPreview(dayColEl, previewEl, previewStart, previewEnd) {
  const dayEntries = state.entries.filter((e) => e.date === dayColEl.dataset.date);
  const laidOut = layoutDayEventsWithPreview(dayEntries, previewStart, previewEnd);
  for (const item of laidOut) {
    if (item.isPreview) {
      applyColumnPosition(previewEl, item);
    } else {
      const el = dayColEl.querySelector(`.calendar-event[data-entry-id="${item.entry.id}"]`);
      if (el) applyColumnPosition(el, item);
    }
  }
}

// Restores a day column's real entries to their normal (no-preview) layout once the create
// preview is gone — e.g. drag cancelled, or the "New Entry" modal closed.
function resetDayLayout(dayColEl) {
  const dayEntries = state.entries.filter((e) => e.date === dayColEl.dataset.date);
  for (const item of layoutDayEvents(dayEntries)) {
    const el = dayColEl.querySelector(`.calendar-event[data-entry-id="${item.entry.id}"]`);
    if (el) applyColumnPosition(el, item);
  }
}

async function fetchEntries() {
  const res = await fetch('/api/entries');
  if (!res.ok) throw new Error('Failed to load entries');
  state.entries = await res.json();
  renderSummary();
  renderWeekTable();
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
  renderWeekTable();
}

async function fetchSettings() {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error('Failed to load settings');
  state.settingsPeriods = await res.json();
  renderWeekTable();
}

function findProjectById(id) {
  return state.projects.find((p) => p.id === Number(id));
}

// The calendar's on-event label: the entry's own description when set, else its project's name.
function entryLabel(entry, projectName) {
  const description = (entry.description || '').trim();
  return description || projectName;
}

// Projects the picker may show: active projects, plus the currently selected one even if it was
// since archived (so an existing entry doesn't silently lose its project out from under it).
function projectPickerPool() {
  const activeProjects = state.projects.filter((p) => !p.archived);
  const currentProject = modalEls.project.value ? findProjectById(modalEls.project.value) : null;
  return currentProject && currentProject.archived ? [...activeProjects, currentProject] : activeProjects;
}

// Sets both halves of the project combobox: the hidden id used by submit/duplicate, and the
// visible text. Passing '' clears the selection (used when creating a new entry, or when a stale
// selection no longer resolves to a real project).
function setModalProject(projectId) {
  const project = projectId ? findProjectById(projectId) : null;
  modalEls.project.value = project ? String(project.id) : '';
  modalEls.projectInput.value = project ? project.project_name : '';
}

function renderSummary() {
  const today = todayISO();
  const weekStart = mondayOf(today);
  const weekEnd = addDays(weekStart, 6);

  let todayMinutes = 0;
  let weekMinutes = 0;
  const perProject = new Map();

  for (const e of state.entries) {
    const minutes = Number(e.duration_minutes) || 0;
    if (e.date === today) todayMinutes += minutes;
    if (e.date >= weekStart && e.date <= weekEnd) {
      weekMinutes += minutes;
      perProject.set(e.project_id, (perProject.get(e.project_id) || 0) + minutes);
    }
  }

  els.summaryToday.textContent = formatMinutes(todayMinutes);
  els.summaryWeek.textContent = formatMinutes(weekMinutes);

  const sorted = [...perProject.entries()].sort((a, b) => b[1] - a[1]);
  els.summaryProjects.innerHTML = sorted.length
    ? sorted
        .map(([projectId, minutes]) => {
          const project = findProjectById(projectId);
          const projectName = project ? project.project_name : 'Unknown';
          const color = project ? project.color : DEFAULT_PROJECT_COLOR;
          return `<li><span><span class="color-dot" style="background:${color}"></span>${escapeHtml(projectName)}</span><span>${formatMinutes(minutes)}</span></li>`;
        })
        .join('')
    : '<li><span>No entries yet</span></li>';
}

function nowLineTopPx() {
  const now = new Date();
  return ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_HEIGHT;
}

function updateNowLine() {
  const line = els.calendarGrid.querySelector('.calendar-now-line');
  if (line) line.style.top = `${nowLineTopPx()}px`;
}

function renderWeekTable() {
  cancelActiveDrag(); // never rebuild the grid out from under an in-progress drag
  const today = todayISO();
  const weekStart = addDays(mondayOf(today), state.weekOffset * 7);
  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const weekRangeText = `${formatDateShort(weekDates[0])} – ${formatDateShort(weekDates[6])}`;
  const weekTitles = { '-1': 'Last Week', 0: 'This Week', 1: 'Next Week' };
  els.weekTitle.textContent = weekTitles[state.weekOffset] || `Week ${weekRangeText}`;
  els.weekRangeLabel.textContent = weekRangeText;

  const byDate = new Map(weekDates.map((d) => [d, []]));
  for (const e of state.entries) {
    if (byDate.has(e.date)) byDate.get(e.date).push(e);
  }

  // A holiday always wins over a regular Settings-schedule non-work day when a date is somehow
  // both, so each day only ever gets one of the two marker classes (see style.css for the colors).
  const dayMeta = weekDates.map((d, i) => {
    const isHoliday = state.holidays.includes(d);
    const activePeriod = getActiveSettingsPeriod(state.settingsPeriods, d);
    const isNonWorkDay = !isHoliday && Boolean(activePeriod) && !activePeriod.work_days.includes(WEEKDAY_KEYS[i]);
    return { date: d, isHoliday, isNonWorkDay };
  });

  const dayHeaders = dayMeta
    .map(
      ({ date: d, isHoliday, isNonWorkDay }, i) =>
        `<div class="calendar-day-header ${d === today ? 'today' : ''} ${isHoliday ? 'holiday' : ''} ${isNonWorkDay ? 'non-work-day' : ''}" data-date="${d}">${WEEKDAY_NAMES[i]}<br>${formatDateShort(d)}</div>`
    )
    .join('');

  const hourLabels = Array.from({ length: 24 }, (_, h) => {
    const label = `${String(h).padStart(2, '0')}:00`;
    return `<div class="hour-label" style="top:${h * HOUR_HEIGHT}px">${label}</div>`;
  }).join('');

  const dayColumns = dayMeta
    .map(({ date: d, isHoliday, isNonWorkDay }) => {
      const laidOut = layoutDayEvents(byDate.get(d));
      const events = laidOut
        .map(({ entry: e, start, end, column, columnCount }) => {
          const project = findProjectById(e.project_id);
          const projectName = project ? project.project_name : 'Unknown';
          const color = project ? project.color : DEFAULT_PROJECT_COLOR;
          const duration = end - start;
          const top = (start / 60) * HOUR_HEIGHT;
          const height = (duration / 60) * HOUR_HEIGHT;
          const widthPct = 100 / columnCount;
          const leftPct = column * widthPct;
          const label = entryLabel(e, projectName);
          const tooltip = `${label}\n${e.start_time}–${e.end_time} (${formatMinutes(duration)})`;
          const timeLine =
            height >= COMPACT_EVENT_HEIGHT_PX ? `<span class="ce-time">${e.start_time}–${e.end_time}</span>` : '';
          return `
            <div class="calendar-event" data-entry-id="${e.id}" style="top:${top}px; height:${height}px; left:calc(${leftPct}% + 2px); width:calc(${widthPct}% - 4px); border-left-color:${color}; background:color-mix(in srgb, ${color} 18%, var(--card-bg));" title="${escapeHtml(tooltip)}">
              <div class="event-resize-handle handle-top"></div>
              <span class="ce-project">${escapeHtml(label)}</span>
              ${timeLine}
              <div class="event-resize-handle handle-bottom"></div>
            </div>`;
        })
        .join('');
      const nowLine = d === today ? `<div class="calendar-now-line" style="top:${nowLineTopPx()}px"></div>` : '';
      const dayStateClass = `${isHoliday ? 'holiday' : ''} ${isNonWorkDay ? 'non-work-day' : ''}`;
      return `<div class="calendar-day-col ${d === today ? 'today' : ''} ${dayStateClass}" data-date="${d}">${events}${nowLine}</div>`;
    })
    .join('');

  const totalCells = weekDates
    .map((d) => {
      const total = byDate.get(d).reduce((sum, e) => sum + (Number(e.duration_minutes) || 0), 0);
      return `<div class="calendar-total-cell">${formatMinutes(total)}</div>`;
    })
    .join('');

  const previousScroll = els.calendarGrid.querySelector('.calendar-body-scroll');
  if (previousScroll) {
    state.calendarScrollTop = previousScroll.scrollTop;
  }

  els.calendarGrid.innerHTML = `
    <div class="calendar-inner">
      <div class="calendar-header-grid">
        <div class="calendar-corner"></div>
        ${dayHeaders}
      </div>
      <div class="calendar-body-scroll">
        <div class="calendar-body-grid">
          <div class="calendar-time-axis">${hourLabels}</div>
          ${dayColumns}
        </div>
      </div>
      <div class="calendar-totals-grid">
        <div class="calendar-corner"></div>
        ${totalCells}
      </div>
    </div>
  `;

  const bodyScroll = els.calendarGrid.querySelector('.calendar-body-scroll');
  bodyScroll.scrollTop = state.calendarScrollTop !== null ? state.calendarScrollTop : DEFAULT_SCROLL_HOUR * HOUR_HEIGHT;

  // The header/totals rows sit outside the scrollable body, so they don't lose width to its
  // scrollbar; without compensating, their columns drift out of alignment with the day columns.
  const scrollbarWidth = bodyScroll.offsetWidth - bodyScroll.clientWidth;
  els.calendarGrid.querySelector('.calendar-inner').style.setProperty('--scrollbar-width', `${scrollbarWidth}px`);
}

// ---- Week range picker (click the date range to jump to a specific week) ------------------

let weekPickerViewMonth = null; // ISO YYYY-MM-01 for the month currently shown in the popup

function isWeekPickerOpen() {
  return !els.weekRangePopup.hidden;
}

function closeWeekPicker() {
  els.weekRangePopup.hidden = true;
}

function currentWeekStart() {
  return addDays(mondayOf(todayISO()), state.weekOffset * 7);
}

function openWeekPicker() {
  weekPickerViewMonth = `${currentWeekStart().slice(0, 7)}-01`;
  renderWeekPicker();
  const rect = els.weekRangeLabel.getBoundingClientRect();
  els.weekRangePopup.style.top = `${rect.bottom + 4}px`;
  els.weekRangePopup.style.left = `${rect.left}px`;
  els.weekRangePopup.hidden = false;
}

function selectWeekDate(dateStr) {
  const thisWeekStart = mondayOf(todayISO());
  const pickedWeekStart = mondayOf(dateStr);
  state.weekOffset = Math.round(
    (Date.parse(`${pickedWeekStart}T00:00:00`) - Date.parse(`${thisWeekStart}T00:00:00`)) / (7 * 86400000)
  );
  closeWeekPicker();
  renderWeekTable();
}

function renderWeekPicker() {
  const [y, m] = weekPickerViewMonth.split('-').map(Number);
  const gridStart = mondayOf(weekPickerViewMonth);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const today = todayISO();
  const selectedWeekStart = currentWeekStart();
  const selectedWeekEnd = addDays(selectedWeekStart, 6);

  const weekdayHeaders = WEEKDAY_NAMES.map((n) => `<div class="date-picker-weekday">${n}</div>`).join('');
  const dayCells = days
    .map((d) => {
      const classes = ['date-picker-day'];
      if (Number(d.slice(5, 7)) !== m) classes.push('outside');
      if (d === today) classes.push('today');
      if (d >= selectedWeekStart && d <= selectedWeekEnd) classes.push('selected');
      return `<button type="button" class="${classes.join(' ')}" data-date="${d}">${Number(d.slice(8, 10))}</button>`;
    })
    .join('');

  els.weekRangePopup.innerHTML = `
    <div class="date-picker-header">
      <button type="button" class="date-picker-nav" data-nav="prev" aria-label="Previous month">&lsaquo;</button>
      <span class="date-picker-month-label">${MONTH_NAMES[m - 1]} ${y}</span>
      <button type="button" class="date-picker-nav" data-nav="next" aria-label="Next month">&rsaquo;</button>
    </div>
    <div class="date-picker-grid">${weekdayHeaders}${dayCells}</div>
  `;
}

function clearWeekHover() {
  els.weekRangePopup.querySelectorAll('.week-hover').forEach((el) => el.classList.remove('week-hover'));
}

els.weekRangeLabel.addEventListener('click', (event) => {
  event.stopPropagation();
  if (isWeekPickerOpen()) closeWeekPicker();
  else openWeekPicker();
});

els.weekRangePopup.addEventListener('click', (event) => {
  // Stop here so the outside-click listener below never sees this event — prev/next re-render
  // the popup, which detaches the clicked button, making a contains() check on it unreliable.
  event.stopPropagation();

  const dayBtn = event.target.closest('[data-date]');
  if (dayBtn) {
    selectWeekDate(dayBtn.dataset.date);
    return;
  }
  const navBtn = event.target.closest('.date-picker-nav');
  if (navBtn) {
    weekPickerViewMonth = addMonths(weekPickerViewMonth, navBtn.dataset.nav === 'prev' ? -1 : 1);
    renderWeekPicker();
  }
});

// Hovering any day highlights its whole Mon–Sun week, not just that cell.
els.weekRangePopup.addEventListener('mouseover', (event) => {
  const dayBtn = event.target.closest('[data-date]');
  if (!dayBtn) {
    clearWeekHover();
    return;
  }
  const hoveredWeekStart = mondayOf(dayBtn.dataset.date);
  const hoveredWeekEnd = addDays(hoveredWeekStart, 6);
  els.weekRangePopup.querySelectorAll('[data-date]').forEach((el) => {
    el.classList.toggle('week-hover', el.dataset.date >= hoveredWeekStart && el.dataset.date <= hoveredWeekEnd);
  });
});

els.weekRangePopup.addEventListener('mouseleave', clearWeekHover);

document.addEventListener('click', (event) => {
  if (isWeekPickerOpen() && !els.weekRangeField.contains(event.target)) closeWeekPicker();
});

// ---- Holiday modal (click a day header to mark/unmark it as a non-work day) ---------------

function openHolidayModal(date) {
  holidayModalDate = date;
  const isHoliday = state.holidays.includes(date);
  holidayModalEls.title.textContent = isHoliday ? 'Remove Holiday?' : 'Mark as Holiday?';
  holidayModalEls.text.textContent = isHoliday
    ? `${date} is currently marked as a holiday.`
    : `Mark ${date} as a holiday? It will show as a non-work day on the calendar.`;
  holidayModalEls.confirmBtn.textContent = isHoliday ? 'Remove Holiday' : 'Mark as Holiday';
  holidayModalEls.confirmBtn.classList.toggle('danger', isHoliday);
  holidayModalEls.dialog.showModal();
}

async function handleHolidayModalConfirm() {
  const isHoliday = state.holidays.includes(holidayModalDate);
  const res = isHoliday
    ? await fetch(`/api/holidays/${holidayModalDate}`, { method: 'DELETE' })
    : await fetch('/api/holidays', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: holidayModalDate }),
      });
  if (res.ok) {
    holidayModalEls.dialog.close();
    await fetchHolidays();
  }
}

function handleCalendarHeaderClick(event) {
  const header = event.target.closest('.calendar-day-header');
  if (!header) return;
  openHolidayModal(header.dataset.date);
}

holidayModalEls.confirmBtn.addEventListener('click', handleHolidayModalConfirm);
holidayModalEls.cancelBtn.addEventListener('click', () => holidayModalEls.dialog.close());
holidayModalEls.closeBtn.addEventListener('click', () => holidayModalEls.dialog.close());
holidayModalEls.dialog.addEventListener('click', (event) => {
  if (event.target === holidayModalEls.dialog) holidayModalEls.dialog.close();
});

function closeModalOptionsMenu() {
  modalEls.optionsMenu.hidden = true;
  modalEls.optionsBtn.setAttribute('aria-expanded', 'false');
}

const modalDatePicker = createDatePicker({
  input: modalEls.date,
  field: modalEls.dateField,
  popup: modalEls.datePopup,
  getSelectedDate: () => modalEls.date.value,
  onSelect: (date) => {
    modalEls.date.value = date;
  },
});

// Type-to-filter replacement for a plain <select> of projects: `input` shows/edits the search
// text, `hiddenInput` is the actual form value (a project id, or '' when nothing valid is picked),
// and `getPool` supplies the candidate projects fresh on every render (it may change as
// state.projects loads or the current entry's project gets archived).
function createProjectPicker({ input, hiddenInput, popup, getPool }) {
  let highlighted = -1;
  let matches = [];

  function isOpen() {
    return !popup.hidden;
  }

  function selectedProject() {
    return hiddenInput.value ? findProjectById(hiddenInput.value) : null;
  }

  function render(query) {
    const trimmed = query.trim().toLowerCase();
    matches = getPool().filter((p) => p.project_name.toLowerCase().includes(trimmed));
    // Only pre-highlight a match once the user has actually typed a filter — otherwise Enter on
    // a freshly focused (but unchanged) field would silently swap its project for the first one
    // in the list instead of just submitting the form.
    highlighted = matches.length && trimmed ? 0 : -1;
    paint();
  }

  function paint() {
    popup.innerHTML = matches.length
      ? matches
          .map(
            (p, i) =>
              `<button type="button" class="project-picker-option ${i === highlighted ? 'highlighted' : ''}" data-id="${p.id}">${escapeHtml(p.project_name)}${p.archived ? ' (archived)' : ''}</button>`
          )
          .join('')
      : '<div class="project-picker-empty">No matching projects</div>';
  }

  function open(query) {
    render(query);
    const rect = input.getBoundingClientRect();
    popup.style.top = `${rect.bottom + 4}px`;
    popup.style.left = `${rect.left}px`;
    popup.style.width = `${rect.width}px`;
    popup.hidden = false;
  }

  function close() {
    popup.hidden = true;
  }

  function commit(project) {
    hiddenInput.value = String(project.id);
    input.value = project.project_name;
    close();
  }

  // Discards unconfirmed typing: back to the selected project's name, or blank if none.
  function revert() {
    const project = selectedProject();
    input.value = project ? project.project_name : '';
  }

  input.addEventListener('focus', () => {
    input.select();
    open('');
  });

  input.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!isOpen()) open('');
  });

  input.addEventListener('blur', () => {
    close();
    revert();
  });

  // Without this, clicking a popup option blurs the input first (revert/close) and only then
  // fires the option's click — harmless in practice since commit() runs right after, but this
  // keeps the two from racing at all.
  popup.addEventListener('mousedown', (event) => event.preventDefault());

  input.addEventListener('input', () => {
    hiddenInput.value = ''; // typing invalidates the previous pick until a match is chosen again
    open(input.value);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen()) return open(input.value);
      if (matches.length) {
        highlighted = (highlighted + 1) % matches.length;
        paint();
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!isOpen()) return open(input.value);
      if (matches.length) {
        highlighted = (highlighted - 1 + matches.length) % matches.length;
        paint();
      }
    } else if (event.key === 'Enter') {
      if (isOpen() && highlighted >= 0) {
        event.preventDefault();
        commit(matches[highlighted]);
      }
    }
    // Escape is handled by the dialog's 'cancel' listener below, like the date picker.
  });

  popup.addEventListener('click', (event) => {
    event.stopPropagation();
    const optionBtn = event.target.closest('.project-picker-option');
    if (optionBtn) commit(matches.find((p) => String(p.id) === optionBtn.dataset.id));
  });

  return { open, close, isOpen, revert };
}

const modalProjectPicker = createProjectPicker({
  input: modalEls.projectInput,
  hiddenInput: modalEls.project,
  popup: modalEls.projectPopup,
  getPool: projectPickerPool,
});

function openModalForEdit(entry) {
  state.modalEntryId = entry.id;
  modalEls.form.reset();
  modalEls.formError.textContent = '';
  modalEls.title.textContent = 'Edit Entry';
  modalEls.date.value = entry.date;
  modalEls.startTime.value = entry.start_time;
  modalEls.endTime.value = entry.end_time;
  setModalProject(entry.project_id);
  modalEls.description.value = entry.description;
  modalEls.optionsWrapper.hidden = false;
  closeModalOptionsMenu();
  modalEls.dialog.showModal();
}

function openModalForCreate(date, startTime, endTime) {
  state.modalEntryId = null;
  modalEls.form.reset();
  modalEls.formError.textContent = '';
  modalEls.title.textContent = 'New Entry';
  modalEls.date.value = date;
  modalEls.startTime.value = startTime;
  modalEls.endTime.value = endTime;
  setModalProject(''); // force blank — form.reset() may have left a stale selection
  modalEls.description.value = '';
  modalEls.optionsWrapper.hidden = true;
  closeModalOptionsMenu();
  modalEls.dialog.showModal();
}

// Reproduces the exact original click-to-create rounding (rounded start, default 60-min length),
// unchanged from before drag support existed. Kept literal — do not "simplify" against the new
// drag constants, since 24*60-15 and 1439-15 are not the same number.
function openCreateFromClick(dayCol, clientY) {
  const rect = dayCol.getBoundingClientRect();
  const rawMinutes = ((clientY - rect.top) / HOUR_HEIGHT) * 60;
  const roundedMinutes = Math.min(Math.max(Math.round(rawMinutes / 15) * 15, 0), 24 * 60 - 15);
  const endMinutes = Math.min(roundedMinutes + 60, 24 * 60 - 1);
  clearOpenCreatePreview();
  openCreatePreviewEl = createDayPreviewEl(dayCol);
  positionPreviewEl(openCreatePreviewEl, roundedMinutes, endMinutes);
  openModalForCreate(dayCol.dataset.date, minutesToHHMM(roundedMinutes), minutesToHHMM(endMinutes));
}

function findDayColAtX(dayCols, clientX) {
  const match = dayCols.find((d) => clientX >= d.rect.left && clientX < d.rect.right);
  if (match) return match;
  return clientX < dayCols[0].rect.left ? dayCols[0] : dayCols[dayCols.length - 1];
}

function removeCreatePreview() {
  if (dragState.previewEl) {
    const dayColEl = dragState.previewEl.parentElement;
    dragState.previewEl.remove();
    dragState.previewEl = null;
    if (dayColEl) resetDayLayout(dayColEl);
  }
}

// Takes an explicit snapshot rather than reading the module-level dragState, because by the time
// an async save fails and calls this as its revert callback, pointerup has already reset dragState
// to idle — the snapshot is what keeps a failed save able to restore the right visual state.
function revertDraggedEvent(snapshot) {
  const el = snapshot.eventEl;
  if (!el) return;
  el.classList.remove('dragging');
  el.style.top = `${snapshot.originalTop}px`;
  el.style.height = `${snapshot.originalHeight}px`;
  el.style.left = snapshot.originalLeft;
  el.style.width = snapshot.originalWidth;
  const timeEl = el.querySelector('.ce-time');
  if (timeEl) timeEl.textContent = `${snapshot.entry.start_time}–${snapshot.entry.end_time}`;
  if (el.parentElement !== snapshot.originalParent) {
    snapshot.originalParent.appendChild(el);
  }
}

function cancelActiveDrag() {
  if (dragState.phase === 'idle') return;
  if (dragState.kind === 'create') {
    removeCreatePreview();
  } else {
    revertDraggedEvent(dragState);
  }
  dragState = { phase: 'idle' };
}

function showCalendarError(message) {
  els.calendarError.textContent = message;
  clearTimeout(showCalendarError.timeoutId);
  showCalendarError.timeoutId = setTimeout(() => {
    els.calendarError.textContent = '';
  }, 4000);
}

async function saveDragChange(entryId, payload, revert) {
  if (payload.start_time !== undefined && payload.end_time !== undefined && payload.start_time >= payload.end_time) {
    revert();
    return;
  }
  try {
    const res = await fetch(`/api/entries/${entryId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Request failed');
    }
    await fetchEntries();
  } catch (err) {
    revert();
    showCalendarError(err.message);
  }
}

function createDayPreviewEl(dayColEl) {
  const el = document.createElement('div');
  el.className = 'calendar-event calendar-event-preview';
  el.innerHTML = '<span class="ce-project">New Entry</span><span class="ce-time"></span>';
  dayColEl.appendChild(el);
  return el;
}

function positionPreviewEl(el, startMin, endMin) {
  const height = ((endMin - startMin) / 60) * HOUR_HEIGHT;
  el.style.top = `${(startMin / 60) * HOUR_HEIGHT}px`;
  el.style.height = `${height}px`;
  const timeEl = el.querySelector('.ce-time');
  const showTime = height >= COMPACT_EVENT_HEIGHT_PX;
  timeEl.hidden = !showTime;
  timeEl.textContent = showTime ? `${minutesToHHMM(startMin)}–${minutesToHHMM(endMin)}` : '';
  updateDayLayoutForPreview(el.parentElement, el, startMin, endMin);
}

function updateCreateDrag(event) {
  const currentMin = rawMinutesFromY(dragState.dayColRect, event.clientY);
  const anchor = dragState.anchorMinutes;
  const start = clamp(snapMinutes(Math.min(anchor, currentMin)), 0, 1439 - MIN_ENTRY_MINUTES);
  const end = clamp(snapMinutes(Math.max(anchor, currentMin)), start + MIN_ENTRY_MINUTES, 1439);
  dragState.currentStartMin = start;
  dragState.currentEndMin = end;
  positionPreviewEl(dragState.previewEl, start, end);
}

function finalizeCreateDrag() {
  const { dayCol, currentStartMin, currentEndMin, previewEl } = dragState;
  // Hand the preview off to the modal's lifecycle instead of removing it — it stays
  // visible behind the "New Entry" modal until that modal is closed or saved.
  clearOpenCreatePreview();
  openCreatePreviewEl = previewEl;
  openModalForCreate(dayCol.dataset.date, minutesToHHMM(currentStartMin), minutesToHHMM(currentEndMin));
}

function updateMoveDrag(event) {
  const deltaMin = ((event.clientY - dragState.startClientY) / HOUR_HEIGHT) * 60;
  const duration = dragState.entry.duration_minutes;
  const newStart = clamp(snapMinutes(dragState.originalStartMinutes + deltaMin), 0, 1439 - duration);
  const newEnd = newStart + duration;
  const targetCol = findDayColAtX(dragState.dayCols, event.clientX);

  dragState.currentStartMin = newStart;
  dragState.currentDate = targetCol.date;

  const el = dragState.eventEl;
  if (el.parentElement !== targetCol.el) {
    targetCol.el.appendChild(el);
  }
  el.style.top = `${(newStart / 60) * HOUR_HEIGHT}px`;
  el.style.left = '2px';
  el.style.width = 'calc(100% - 4px)';
  el.querySelector('.ce-time').textContent = `${minutesToHHMM(newStart)}–${minutesToHHMM(newEnd)}`;
}

function finalizeMoveDrag() {
  const el = dragState.eventEl;
  el.classList.remove('dragging');
  const duration = dragState.entry.duration_minutes;
  const payload = {
    date: dragState.currentDate,
    start_time: minutesToHHMM(dragState.currentStartMin),
    end_time: minutesToHHMM(dragState.currentStartMin + duration),
  };
  const snapshot = { ...dragState };
  saveDragChange(dragState.entry.id, payload, () => revertDraggedEvent(snapshot));
}

function updateResizeDrag(event) {
  const deltaMin = ((event.clientY - dragState.startClientY) / HOUR_HEIGHT) * 60;
  const el = dragState.eventEl;
  const timeEl = el.querySelector('.ce-time');
  if (dragState.kind === 'resize-top') {
    const newStart = clamp(
      snapMinutes(dragState.originalStartMinutes + deltaMin),
      0,
      dragState.originalEndMinutes - MIN_ENTRY_MINUTES
    );
    dragState.currentStartMin = newStart;
    el.style.top = `${(newStart / 60) * HOUR_HEIGHT}px`;
    el.style.height = `${((dragState.originalEndMinutes - newStart) / 60) * HOUR_HEIGHT}px`;
    timeEl.textContent = `${minutesToHHMM(newStart)}–${minutesToHHMM(dragState.originalEndMinutes)}`;
  } else {
    const newEnd = clamp(
      snapMinutes(dragState.originalEndMinutes + deltaMin),
      dragState.originalStartMinutes + MIN_ENTRY_MINUTES,
      1439
    );
    dragState.currentEndMin = newEnd;
    el.style.height = `${((newEnd - dragState.originalStartMinutes) / 60) * HOUR_HEIGHT}px`;
    timeEl.textContent = `${minutesToHHMM(dragState.originalStartMinutes)}–${minutesToHHMM(newEnd)}`;
  }
}

function finalizeResizeDrag() {
  const el = dragState.eventEl;
  el.classList.remove('dragging');
  const payload =
    dragState.kind === 'resize-top'
      ? { start_time: minutesToHHMM(dragState.currentStartMin), end_time: dragState.entry.end_time }
      : { start_time: dragState.entry.start_time, end_time: minutesToHHMM(dragState.currentEndMin) };
  const snapshot = { ...dragState };
  saveDragChange(dragState.entry.id, payload, () => revertDraggedEvent(snapshot));
}

function beginEventDrag(kind, event, eventEl, entry) {
  event.preventDefault(); // suppress native text selection / drag-image ghosting
  els.calendarGrid.setPointerCapture(event.pointerId);
  const startMinutes = minutesOfDay(entry.start_time);
  dragState = {
    phase: 'pending',
    kind,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    eventEl,
    entry,
    originalTop: parseFloat(eventEl.style.top),
    originalHeight: parseFloat(eventEl.style.height),
    originalLeft: eventEl.style.left,
    originalWidth: eventEl.style.width,
    originalParent: eventEl.parentElement,
    originalStartMinutes: startMinutes,
    originalEndMinutes: startMinutes + entry.duration_minutes,
    dayCols: Array.from(document.querySelectorAll('.calendar-day-col')).map((el) => ({
      el,
      date: el.dataset.date,
      rect: el.getBoundingClientRect(),
    })),
  };
}

function beginCreateDrag(event, dayCol) {
  event.preventDefault(); // suppress native text selection / drag-image ghosting
  els.calendarGrid.setPointerCapture(event.pointerId);
  const rect = dayCol.getBoundingClientRect();
  dragState = {
    phase: 'pending',
    kind: 'create',
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    dayCol,
    dayColRect: rect,
    anchorMinutes: rawMinutesFromY(rect, event.clientY),
    previewEl: null,
  };
}

function handleCalendarPointerDown(event) {
  if (dragState.phase !== 'idle') return;
  if (event.button !== 0) return; // primary button/touch only

  const handle = event.target.closest('.event-resize-handle');
  const eventEl = event.target.closest('.calendar-event');
  if (handle && eventEl) {
    const entry = state.entries.find((e) => e.id === Number(eventEl.dataset.entryId));
    if (!entry) return;
    beginEventDrag(handle.classList.contains('handle-top') ? 'resize-top' : 'resize-bottom', event, eventEl, entry);
    return;
  }
  if (eventEl) {
    const entry = state.entries.find((e) => e.id === Number(eventEl.dataset.entryId));
    if (!entry) return;
    beginEventDrag('move', event, eventEl, entry);
    return;
  }
  const dayCol = event.target.closest('.calendar-day-col');
  if (dayCol) {
    beginCreateDrag(event, dayCol);
  }
}

function handleCalendarPointerMove(event) {
  if (dragState.phase === 'idle' || event.pointerId !== dragState.pointerId) return;

  if (dragState.phase === 'pending') {
    const dx = event.clientX - dragState.startClientX;
    const dy = event.clientY - dragState.startClientY;
    if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    dragState.phase = 'dragging';
    if (dragState.kind === 'create') {
      dragState.previewEl = createDayPreviewEl(dragState.dayCol);
    } else {
      dragState.eventEl.classList.add('dragging');
    }
  }

  if (dragState.kind === 'create') {
    updateCreateDrag(event);
  } else if (dragState.kind === 'move') {
    updateMoveDrag(event);
  } else {
    updateResizeDrag(event);
  }
}

function handleCalendarPointerUp(event) {
  if (dragState.phase === 'idle' || event.pointerId !== dragState.pointerId) return;
  els.calendarGrid.releasePointerCapture(event.pointerId);

  if (dragState.phase === 'pending') {
    // No real movement — reproduce today's plain-click behavior exactly.
    if (dragState.kind === 'create') {
      openCreateFromClick(dragState.dayCol, event.clientY);
    } else {
      openModalForEdit(dragState.entry);
    }
    dragState = { phase: 'idle' };
    return;
  }

  if (dragState.kind === 'create') {
    finalizeCreateDrag();
  } else if (dragState.kind === 'move') {
    finalizeMoveDrag();
  } else {
    finalizeResizeDrag();
  }
  dragState = { phase: 'idle' };
}

function handleCalendarPointerCancel(event) {
  if (dragState.phase === 'idle' || event.pointerId !== dragState.pointerId) return;
  cancelActiveDrag();
}

async function handleModalSubmit(event) {
  event.preventDefault();
  modalEls.formError.textContent = '';

  const payload = {
    date: modalEls.date.value,
    start_time: modalEls.startTime.value,
    end_time: modalEls.endTime.value,
    project_id: modalEls.project.value ? Number(modalEls.project.value) : null,
    description: modalEls.description.value.trim(),
  };

  if (!payload.date || !payload.project_id || !payload.start_time || !payload.end_time) {
    modalEls.formError.textContent = 'Date, project, start and end time are required.';
    return;
  }

  const isEdit = state.modalEntryId !== null;
  const url = isEdit ? `/api/entries/${state.modalEntryId}` : '/api/entries';
  const method = isEdit ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Request failed');
    }
    modalEls.dialog.close();
    await fetchEntries();
  } catch (err) {
    modalEls.formError.textContent = err.message;
  }
}

async function handleModalDuplicate() {
  closeModalOptionsMenu();
  modalEls.formError.textContent = '';

  const payload = {
    date: modalEls.date.value,
    start_time: modalEls.startTime.value,
    end_time: modalEls.endTime.value,
    project_id: modalEls.project.value ? Number(modalEls.project.value) : null,
    description: modalEls.description.value.trim(),
  };

  if (!payload.date || !payload.project_id || !payload.start_time || !payload.end_time) {
    modalEls.formError.textContent = 'Date, project, start and end time are required.';
    return;
  }

  try {
    const res = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Request failed');
    }
    modalEls.dialog.close();
    await fetchEntries();
  } catch (err) {
    modalEls.formError.textContent = err.message;
  }
}

async function handleModalDelete() {
  closeModalOptionsMenu();
  if (state.modalEntryId === null) return;
  const entry = state.entries.find((e) => e.id === state.modalEntryId);
  if (!entry) return;
  const project = findProjectById(entry.project_id);
  if (!confirm(`Delete the entry for "${project ? project.project_name : 'Unknown'}" on ${entry.date}?`)) return;

  const res = await fetch(`/api/entries/${state.modalEntryId}`, { method: 'DELETE' });
  if (res.ok) {
    modalEls.dialog.close();
    await fetchEntries();
  }
}

els.prevWeekBtn.addEventListener('click', () => {
  state.weekOffset -= 1;
  closeWeekPicker();
  renderWeekTable();
});
els.nextWeekBtn.addEventListener('click', () => {
  state.weekOffset += 1;
  closeWeekPicker();
  renderWeekTable();
});
els.thisWeekBtn.addEventListener('click', () => {
  state.weekOffset = 0;
  closeWeekPicker();
  renderWeekTable();
});
els.calendarGrid.addEventListener('click', handleCalendarHeaderClick);
els.calendarGrid.addEventListener('pointerdown', handleCalendarPointerDown);
els.calendarGrid.addEventListener('pointermove', handleCalendarPointerMove);
els.calendarGrid.addEventListener('pointerup', handleCalendarPointerUp);
els.calendarGrid.addEventListener('pointercancel', handleCalendarPointerCancel);
window.addEventListener('blur', cancelActiveDrag);
setInterval(updateNowLine, 60 * 1000);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    cancelActiveDrag();
    closeWeekPicker();
  }
});

modalEls.startTime.addEventListener('input', handleTimeInput);
modalEls.startTime.addEventListener('blur', handleTimeBlur);
modalEls.endTime.addEventListener('input', handleTimeInput);
modalEls.endTime.addEventListener('blur', handleTimeBlur);
modalEls.form.addEventListener('submit', handleModalSubmit);
modalEls.duplicateBtn.addEventListener('click', handleModalDuplicate);
modalEls.deleteBtn.addEventListener('click', handleModalDelete);
modalEls.optionsBtn.addEventListener('click', (event) => {
  event.stopPropagation();
  const isOpen = !modalEls.optionsMenu.hidden;
  modalEls.optionsMenu.hidden = isOpen;
  modalEls.optionsBtn.setAttribute('aria-expanded', String(!isOpen));
});
document.addEventListener('click', (event) => {
  if (!modalEls.optionsMenu.hidden && !modalEls.optionsWrapper.contains(event.target)) {
    closeModalOptionsMenu();
  }
});
// Escape closes an open popup rather than the whole modal — the dialog's own Escape handling
// fires 'cancel' first, so we can intercept it there.
modalEls.dialog.addEventListener('cancel', (event) => {
  if (modalDatePicker.isOpen()) {
    event.preventDefault();
    modalDatePicker.close();
  } else if (modalProjectPicker.isOpen()) {
    event.preventDefault();
    modalProjectPicker.close();
    modalProjectPicker.revert();
  }
});
modalEls.closeBtn.addEventListener('click', () => modalEls.dialog.close());
modalEls.dialog.addEventListener('click', (event) => {
  if (event.target === modalEls.dialog) modalEls.dialog.close();
});
// Fires however the dialog closes — Cancel, backdrop click, Escape, or a successful save —
// so this is the one place that needs to clean up the create-preview left visible behind it.
modalEls.dialog.addEventListener('close', () => {
  clearOpenCreatePreview();
  closeModalOptionsMenu();
  modalDatePicker.close();
  modalProjectPicker.close();
});

Promise.all([fetchProjects(), fetchHolidays(), fetchSettings()])
  .then(fetchEntries)
  .catch((err) => {
    showCalendarError(err.message);
  });
