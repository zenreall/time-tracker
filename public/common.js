// Shared pure helpers (date/format/escaping) used by index.html, projects.html, recap.html and settings.html.
// No state, no DOM access — load this before each page's own script.

const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
// Index-aligned with WEEKDAY_NAMES above, for zipping labels with the values settings periods store.
const WEEKDAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function todayISO() {
  return new Date().toLocaleDateString('sv-SE'); // local YYYY-MM-DD
}

function mondayOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return d.toLocaleDateString('sv-SE');
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('sv-SE');
}

function addMonths(dateStr, months) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString('sv-SE');
}

function addYears(dateStr, years) {
  return addMonths(dateStr, years * 12);
}

function startOfMonth(dateStr) {
  return `${dateStr.slice(0, 7)}-01`;
}

function endOfMonth(dateStr) {
  return addDays(addMonths(startOfMonth(dateStr), 1), -1);
}

function startOfYear(dateStr) {
  return `${dateStr.slice(0, 4)}-01-01`;
}

function endOfYear(dateStr) {
  return `${dateStr.slice(0, 4)}-12-31`;
}

// Returns the settings period (as returned by GET /api/settings) that applies on dateStr —
// the one with the latest effective_date that's still <= dateStr — or null if none apply.
function getActiveSettingsPeriod(periods, dateStr) {
  const applicable = periods.filter((p) => p.effective_date <= dateStr);
  if (!applicable.length) return null;
  return applicable.reduce((latest, p) => (p.effective_date > latest.effective_date ? p : latest));
}

// The WEEKDAY_KEYS entry (e.g. "monday") for an arbitrary date string.
function weekdayKeyOf(dateStr) {
  const jsDay = new Date(`${dateStr}T00:00:00`).getDay(); // 0=Sun..6=Sat
  return WEEKDAY_KEYS[(jsDay + 6) % 7]; // remap to Monday-first, matching WEEKDAY_KEYS' order
}

// True if dateStr is an explicit holiday, or falls on a weekday the active settings period
// (see getActiveSettingsPeriod) doesn't list as a work day. False if neither applies, including
// when no settings period covers the date at all.
function isOffDay(dateStr, holidays, settingsPeriods) {
  if (holidays.includes(dateStr)) return true;
  const period = getActiveSettingsPeriod(settingsPeriods, dateStr);
  return period ? !period.work_days.includes(weekdayKeyOf(dateStr)) : false;
}

function formatDateShort(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}

function formatMinutes(totalMinutes) {
  const mins = Math.max(0, Math.round(totalMinutes || 0));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

// Custom Monday-first calendar popup for a text-input date field — a native <input type="date">'s
// picker follows the browser/OS locale, which we can't force to start on Monday. `input` is the
// text field that opens it, `field` is its wrapping element (used for the outside-click check),
// and `popup` is the element the calendar itself is rendered into. Every page using this shares
// the .date-field/.date-picker*/.date-picker-day CSS in style.css.
function createDatePicker({ input, field, popup, getSelectedDate, onSelect }) {
  let viewMonth = null; // ISO date (YYYY-MM-01) for the month currently shown in the popup

  function isOpen() {
    return !popup.hidden;
  }

  function render() {
    const [y, m] = viewMonth.split('-').map(Number);
    const gridStart = mondayOf(viewMonth);
    const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
    const selected = getSelectedDate();
    const today = todayISO();

    const weekdayHeaders = WEEKDAY_NAMES.map((n) => `<div class="date-picker-weekday">${n}</div>`).join('');
    const dayCells = days
      .map((d) => {
        const classes = ['date-picker-day'];
        if (Number(d.slice(5, 7)) !== m) classes.push('outside');
        if (d === today) classes.push('today');
        if (d === selected) classes.push('selected');
        return `<button type="button" class="${classes.join(' ')}" data-date="${d}">${Number(d.slice(8, 10))}</button>`;
      })
      .join('');

    popup.innerHTML = `
      <div class="date-picker-header">
        <button type="button" class="date-picker-nav" data-nav="prev" aria-label="Previous month">&lsaquo;</button>
        <span class="date-picker-month-label">${MONTH_NAMES[m - 1]} ${y}</span>
        <button type="button" class="date-picker-nav" data-nav="next" aria-label="Next month">&rsaquo;</button>
      </div>
      <div class="date-picker-grid">${weekdayHeaders}${dayCells}</div>
    `;
  }

  function open() {
    const base = getSelectedDate() || todayISO();
    viewMonth = `${base.slice(0, 7)}-01`;
    render();
    const rect = input.getBoundingClientRect();
    popup.style.top = `${rect.bottom + 4}px`;
    popup.style.left = `${rect.left}px`;
    popup.hidden = false;
  }

  function close() {
    popup.hidden = true;
  }

  input.addEventListener('click', (event) => {
    event.stopPropagation();
    if (isOpen()) {
      close();
    } else {
      open();
    }
  });

  popup.addEventListener('click', (event) => {
    // Stop here so the outside-click listener below never sees this event — prev/next re-render
    // the popup, which detaches the clicked button, making a contains() check on it unreliable.
    event.stopPropagation();
    const dayBtn = event.target.closest('.date-picker-day');
    if (dayBtn) {
      onSelect(dayBtn.dataset.date);
      close();
      return;
    }
    const navBtn = event.target.closest('.date-picker-nav');
    if (navBtn) {
      viewMonth = addMonths(viewMonth, navBtn.dataset.nav === 'prev' ? -1 : 1);
      render();
    }
  });

  document.addEventListener('click', (event) => {
    if (isOpen() && !field.contains(event.target)) close();
  });

  return { open, close, isOpen };
}
