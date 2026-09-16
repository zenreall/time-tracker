const state = {
  projects: [],
  sort: { column: null, direction: 'asc' },
};

// Fixed categorical order (see dataviz skill's palette) used to suggest a new project's default color.
const CATEGORICAL_PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

const els = {
  projectForm: document.getElementById('projectForm'),
  projectName: document.getElementById('projectName'),
  projectColor: document.getElementById('projectColor'),
  projectIpBox: document.getElementById('projectIpBox'),
  projectFormError: document.getElementById('projectFormError'),
  projectsBody: document.getElementById('projectsBody'),
  projectsHead: document.querySelector('#projectsTable thead'),
};

async function fetchProjects() {
  const res = await fetch('/api/projects');
  if (!res.ok) throw new Error('Failed to load projects');
  state.projects = await res.json();
  renderProjectsAdmin();
  els.projectColor.value = CATEGORICAL_PALETTE[state.projects.length % CATEGORICAL_PALETTE.length];
}

function getSortedProjects() {
  const { column, direction } = state.sort;
  if (!column) return state.projects;
  const sign = direction === 'asc' ? 1 : -1;
  return [...state.projects].sort((a, b) => {
    const cmp =
      column === 'archived'
        ? Number(a.archived) - Number(b.archived)
        : String(a[column] || '').localeCompare(String(b[column] || ''), undefined, { sensitivity: 'base' });
    return cmp * sign;
  });
}

function updateSortIndicators() {
  els.projectsHead.querySelectorAll('th.sortable').forEach((th) => {
    th.classList.remove('sort-asc', 'sort-desc');
    if (th.dataset.sort === state.sort.column) {
      th.classList.add(state.sort.direction === 'asc' ? 'sort-asc' : 'sort-desc');
    }
  });
}

function handleSortClick(event) {
  const th = event.target.closest('th.sortable');
  if (!th) return;
  const column = th.dataset.sort;
  if (state.sort.column === column) {
    state.sort.direction = state.sort.direction === 'asc' ? 'desc' : 'asc';
  } else {
    state.sort.column = column;
    state.sort.direction = 'asc';
  }
  renderProjectsAdmin();
}

function renderProjectsAdmin() {
  updateSortIndicators();
  if (!state.projects.length) {
    els.projectsBody.innerHTML = '<tr><td colspan="5" class="empty">No projects yet.</td></tr>';
    return;
  }
  els.projectsBody.innerHTML = getSortedProjects()
    .map(
      (p) => `
      <tr>
        <td data-label="Name"><input type="text" class="project-name-input" value="${escapeHtml(p.project_name)}" /></td>
        <td data-label="Color"><input type="color" class="project-color-input" value="${escapeHtml(p.color)}" /></td>
        <td data-label="IP Box"><input type="checkbox" class="project-ipbox-input" ${p.ip_box ? 'checked' : ''} /></td>
        <td data-label="Archived">${p.archived ? 'Yes' : 'No'}</td>
        <td>
          <div class="row-actions">
            <button type="button" class="secondary" data-action="save" data-id="${p.id}">Save</button>
            <button type="button" class="secondary ${p.archived ? 'btn-restore' : 'btn-archive'}" data-action="toggle-archive" data-id="${p.id}">${
        p.archived ? 'Restore' : 'Archive'
      }</button>
          </div>
        </td>
      </tr>`
    )
    .join('');
}

async function handleProjectSubmit(event) {
  event.preventDefault();
  els.projectFormError.textContent = '';

  const payload = {
    project_name: els.projectName.value.trim(),
    color: els.projectColor.value,
    ip_box: els.projectIpBox.checked,
  };

  if (!payload.project_name) {
    els.projectFormError.textContent = 'Project name is required.';
    return;
  }

  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Request failed');
    }
    els.projectForm.reset();
    await fetchProjects();
  } catch (err) {
    els.projectFormError.textContent = err.message;
  }
}

async function handleProjectsTableClick(event) {
  const btn = event.target.closest('button[data-action]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  const project = state.projects.find((p) => p.id === id);
  if (!project) return;

  if (btn.dataset.action === 'toggle-archive') {
    const res = await fetch(`/api/projects/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: !project.archived }),
    });
    if (res.ok) await fetchProjects();
  } else if (btn.dataset.action === 'save') {
    const row = btn.closest('tr');
    const projectName = row.querySelector('.project-name-input').value.trim();
    if (!projectName) return;
    const payload = {
      project_name: projectName,
      color: row.querySelector('.project-color-input').value,
      ip_box: row.querySelector('.project-ipbox-input').checked,
    };
    const res = await fetch(`/api/projects/${id}`, {
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
      await fetchProjects();
    }
  }
}

function handleProjectsTableInput(event) {
  const row = event.target.closest('tr');
  if (row) row.classList.add('row-dirty');
}

els.projectForm.addEventListener('submit', handleProjectSubmit);
els.projectsBody.addEventListener('click', handleProjectsTableClick);
els.projectsBody.addEventListener('input', handleProjectsTableInput);
els.projectsHead.addEventListener('click', handleSortClick);

fetchProjects().catch((err) => {
  els.projectFormError.textContent = err.message;
});
