const state = { periods: [] };

const DEFAULT_ADD_WORK_DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

const els = {
  settingsForm: document.getElementById('settingsForm'),
  settingsEffectiveDate: document.getElementById('settingsEffectiveDate'),
  settingsDateField: document.getElementById('settingsDateField'),
  settingsDatePopup: document.getElementById('settingsDatePopup'),
  settingsHoursPerDay: document.getElementById('settingsHoursPerDay'),
  addWeekdayGroup: document.getElementById('addWeekdayGroup'),
  addDayCount: document.getElementById('addDayCount'),
  settingsFormError: document.getElementById('settingsFormError'),
  settingsBody: document.getElementById('settingsBody'),
};

let addFormSelectedDate = null;

function weekdayToggleGroupHtml(selectedDays) {
  return WEEKDAY_KEYS.map(
    (key, i) => `<button type="button" class="weekday-toggle${selectedDays.includes(key) ? ' active' : ''}" data-day="${key}">${WEEKDAY_NAMES[i]}</button>`
  ).join('');
}

function getSelectedDays(container) {
  return [...container.querySelectorAll('.weekday-toggle.active')].map((btn) => btn.dataset.day);
}

function updateDayCount(container, labelEl) {
  labelEl.textContent = `${getSelectedDays(container).length} days/week`;
}

function renderAddWeekdayGroup(selectedDays) {
  els.addWeekdayGroup.innerHTML = weekdayToggleGroupHtml(selectedDays);
  updateDayCount(els.addWeekdayGroup, els.addDayCount);
}

async function fetchSettings() {
  const res = await fetch('/api/settings');
  if (!res.ok) throw new Error('Failed to load settings');
  state.periods = await res.json();
  renderSettingsAdmin();
}

function renderSettingsAdmin() {
  if (!state.periods.length) {
    els.settingsBody.innerHTML = '<tr><td colspan="4" class="empty">No settings periods yet.</td></tr>';
    return;
  }
  const activePeriod = getActiveSettingsPeriod(state.periods, todayISO());
  els.settingsBody.innerHTML = state.periods
    .map((p) => {
      const isActive = Boolean(activePeriod) && p.id === activePeriod.id;
      return `
      <tr class="${isActive ? 'settings-row-active' : ''}">
        <td data-label="Effective from">${p.effective_date}${isActive ? '<span class="settings-active-badge">Active</span>' : ''}</td>
        <td data-label="Hours/day"><input type="number" class="settings-hours-input" min="0.5" max="24" step="0.5" value="${p.hours_per_day}" /></td>
        <td data-label="Work days">
          <div class="weekday-toggle-group">${weekdayToggleGroupHtml(p.work_days)}</div>
          <span class="weekday-count">${p.work_days.length} days/week</span>
        </td>
        <td>
          <div class="row-actions">
            <button type="button" class="secondary" data-action="save" data-id="${p.id}">Save</button>
            <button type="button" class="danger" data-action="delete" data-id="${p.id}">Delete</button>
          </div>
        </td>
      </tr>`;
    })
    .join('');
}

async function handleSettingsSubmit(event) {
  event.preventDefault();
  els.settingsFormError.textContent = '';

  const effective_date = addFormSelectedDate;
  const hours_per_day = Number(els.settingsHoursPerDay.value);
  const work_days = getSelectedDays(els.addWeekdayGroup);

  if (!effective_date) {
    els.settingsFormError.textContent = 'Effective date is required.';
    return;
  }
  if (!work_days.length) {
    els.settingsFormError.textContent = 'Select at least one work day.';
    return;
  }

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ effective_date, hours_per_day, work_days }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Request failed');
    }
    els.settingsForm.reset();
    addFormSelectedDate = null;
    els.settingsEffectiveDate.value = '';
    renderAddWeekdayGroup(DEFAULT_ADD_WORK_DAYS);
    await fetchSettings();
  } catch (err) {
    els.settingsFormError.textContent = err.message;
  }
}

function handleAddWeekdayClick(event) {
  const btn = event.target.closest('.weekday-toggle');
  if (!btn) return;
  btn.classList.toggle('active');
  updateDayCount(els.addWeekdayGroup, els.addDayCount);
}

async function handleSettingsTableClick(event) {
  const toggleBtn = event.target.closest('.weekday-toggle');
  if (toggleBtn) {
    toggleBtn.classList.toggle('active');
    const group = toggleBtn.closest('.weekday-toggle-group');
    const row = toggleBtn.closest('tr');
    row.classList.add('row-dirty');
    updateDayCount(group, row.querySelector('.weekday-count'));
    return;
  }

  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const period = state.periods.find((p) => p.id === id);
  if (!period) return;

  if (btn.dataset.action === 'delete') {
    if (!confirm(`Delete the period starting ${period.effective_date}?`)) return;
    const res = await fetch(`/api/settings/${id}`, { method: 'DELETE' });
    if (res.ok) await fetchSettings();
  } else if (btn.dataset.action === 'save') {
    const row = btn.closest('tr');
    const workDays = getSelectedDays(row.querySelector('.weekday-toggle-group'));
    if (!workDays.length) return;
    const payload = {
      hours_per_day: Number(row.querySelector('.settings-hours-input').value),
      work_days: workDays,
    };
    const res = await fetch(`/api/settings/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      row.classList.remove('row-dirty');
      btn.classList.add('save-success');
      btn.textContent = 'Saved';
      btn.disabled = true;
      await new Promise((resolve) => setTimeout(resolve, 600));
      await fetchSettings();
    }
  }
}

function handleSettingsTableInput(event) {
  const row = event.target.closest('tr');
  if (row) row.classList.add('row-dirty');
}

createDatePicker({
  input: els.settingsEffectiveDate,
  field: els.settingsDateField,
  popup: els.settingsDatePopup,
  getSelectedDate: () => addFormSelectedDate,
  onSelect: (date) => {
    addFormSelectedDate = date;
    els.settingsEffectiveDate.value = date;
  },
});

renderAddWeekdayGroup(DEFAULT_ADD_WORK_DAYS);
els.settingsForm.addEventListener('submit', handleSettingsSubmit);
els.addWeekdayGroup.addEventListener('click', handleAddWeekdayClick);
els.settingsBody.addEventListener('click', handleSettingsTableClick);
els.settingsBody.addEventListener('input', handleSettingsTableInput);

fetchSettings().catch((err) => {
  els.settingsFormError.textContent = err.message;
});
