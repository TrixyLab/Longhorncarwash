import { state, showToast, confirmAppDialog } from './utils.js';

const checklistsContainer = document.getElementById('checklists-container');
const siteLogsContainer = document.getElementById('site-logs-container');
const btnShowMaintenanceForm = document.getElementById('btn-show-maintenance-form');
const btnShowIncidentForm = document.getElementById('btn-show-incident-form');
const modalMaintenance = document.getElementById('modal-maintenance');
const modalIncident = document.getElementById('modal-incident');
const btnSubmitMaint = document.getElementById('btn-submit-maint');
const btnSubmitIncident = document.getElementById('btn-submit-incident');
const btnCancelMaint = document.getElementById('btn-cancel-maint');
const btnCancelIncident = document.getElementById('btn-cancel-incident');
const maintPhotoInput = document.getElementById('maint-photo');
const incidentPhotoInput = document.getElementById('incident-photo');

const btnCreateChecklist = document.getElementById('btn-create-checklist');
const modalCreateChecklist = document.getElementById('modal-create-checklist');
const btnCancelCreateChecklist = document.getElementById('btn-cancel-create-checklist');
const btnSaveChecklist = document.getElementById('btn-save-checklist');
const checklistTitleInput = document.getElementById('checklist-title');
const checklistDescInput = document.getElementById('checklist-desc');
const checklistRoleInput = document.getElementById('checklist-role');
const btnAddTaskRow = document.getElementById('btn-add-task-row');
const checklistTasksInputContainer = document.getElementById('checklist-tasks-input-container');

const modalExecuteChecklist = document.getElementById('modal-execute-checklist');
const executeChecklistTitle = document.getElementById('execute-checklist-title');
const executeChecklistDesc = document.getElementById('execute-checklist-desc');
const executeChecklistTasks = document.getElementById('execute-checklist-tasks');
const btnCancelExecute = document.getElementById('btn-cancel-execute');
const btnSubmitCompletion = document.getElementById('btn-submit-completion');
const checklistHistoryContainer = document.getElementById('checklist-history-container');

const modalViewPhoto = document.getElementById('modal-view-photo');
const fullSizePhoto = document.getElementById('full-size-photo');
const btnClosePhoto = document.getElementById('btn-close-photo');

async function getBase64(file) {
  if (!file) return null;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (err) => reject(err);
  });
}

async function submitSiteLog(type, data) {
  try {
    const payload = {
      type,
      description: data.description,
      equipment_name: data.equipment_name || data.customer_name || null,
      photo_base64: data.photo_base64 || null,
      user_id: state.currentUser
        ? state.currentUser.id
        : state.currentManager
          ? state.currentManager.id
          : null,
    };
    const { error } = await window.supabaseClient.from('site_logs').insert([payload]);
    if (error) throw error;
    showToast(`${type} reported successfully!`, 'success');
    loadSiteLogs();
  } catch (e) {
    showToast('Failed to submit report. (Does "site_logs" table exist?)', 'error');
  }
}

export async function loadOps() {
  const opsManagerControls = document.getElementById('ops-manager-controls');
  if (opsManagerControls) {
    opsManagerControls.classList.toggle('hidden', !state.managerLoggedIn);
  }
  loadChecklists();
  loadSiteLogs();
  loadChecklistHistory();
}

export async function loadChecklists() {
  try {
    const { data: checklists, error } = await window.supabaseClient
      .from('checklists')
      .select('id, title, description, role_required, tasks')
      .order('created_at', { ascending: true });
    if (error) throw error;

    checklistsContainer.innerHTML = '';
    if (checklists.length === 0) {
      checklistsContainer.innerHTML =
        '<div style="text-align: center; padding: 20px; color: var(--text-muted);">No checklists available.</div>';
      return;
    }

    checklists.forEach((list) => {
      const div = document.createElement('div');
      div.className = 'action-card';
      div.style =
        'background: var(--card); padding: 20px; border-radius: 12px; border: 1px solid var(--border); cursor: pointer; flex-direction: column; align-items: flex-start; position: relative;';

      const titleEl = document.createElement('h4');
      titleEl.style = 'margin: 0; color: var(--primary);';
      titleEl.textContent = list.title;

      const roleSpan = document.createElement('span');
      roleSpan.style =
        'font-size: 0.8rem; background: var(--surface); padding: 2px 8px; border-radius: 10px; border: 1px solid var(--border);';
      roleSpan.textContent = list.role_required;

      const header = document.createElement('div');
      header.style =
        'display: flex; justify-content: space-between; width: 100%; margin-bottom: 10px;';

      const btnGroup = document.createElement('div');
      btnGroup.style = 'display: flex; gap: 8px; align-items: center;';
      btnGroup.appendChild(roleSpan);

      if (state.managerLoggedIn) {
        const editBtn = document.createElement('button');
        editBtn.className = 'btn-edit-checklist';
        editBtn.style = 'background: none; border: none; cursor: pointer; font-size: 1rem;';
        editBtn.title = 'Edit';
        editBtn.textContent = 'Edit';

        const delBtn = document.createElement('button');
        delBtn.className = 'btn-delete-checklist';
        delBtn.style = 'background: none; border: none; cursor: pointer; font-size: 1rem;';
        delBtn.title = 'Delete';
        delBtn.textContent = 'Del';

        btnGroup.appendChild(editBtn);
        btnGroup.appendChild(delBtn);
      }

      header.appendChild(titleEl);
      header.appendChild(btnGroup);

      const descEl = document.createElement('p');
      descEl.style = 'font-size: 0.85rem; color: var(--text-muted); margin: 0;';
      descEl.textContent = list.description || 'No description';

      const taskCount = document.createElement('p');
      taskCount.style = 'font-size: 0.75rem; color: var(--text-muted); margin-top: 5px;';
      taskCount.textContent = `Tasks: ${Array.isArray(list.tasks) ? list.tasks.length : 0}`;

      div.appendChild(header);
      div.appendChild(descEl);
      div.appendChild(taskCount);

      div.addEventListener('click', (e) => {
        if (e.target.closest('.btn-edit-checklist')) {
          editChecklist(list);
        } else if (e.target.closest('.btn-delete-checklist')) {
          deleteChecklist(list.id, list.title);
        } else {
          showChecklistExecution(list);
        }
      });

      checklistsContainer.appendChild(div);
    });
  } catch (e) {
    checklistsContainer.innerHTML =
      '<div style="text-align: center; padding: 20px; color: var(--danger);">Failed to load checklists.</div>';
  }
}

async function deleteChecklist(id, title) {
  const ok = await confirmAppDialog({
    title: 'Delete Checklist',
    message: `Are you sure you want to delete the "${title}" checklist?`,
    confirmLabel: 'Delete Checklist',
  });
  if (!ok) return;
  try {
    const { error } = await window.supabaseClient.from('checklists').delete().eq('id', id);
    if (error) throw error;
    showToast('Checklist deleted', 'success');
    loadChecklists();
  } catch (e) {
    showToast('Failed to delete checklist', 'error');
  }
}

function editChecklist(list) {
  state.editingChecklistId = list.id;
  checklistTitleInput.value = list.title;
  checklistDescInput.value = list.description || '';
  checklistRoleInput.value = list.role_required;

  checklistTasksInputContainer.innerHTML = '';
  const tasks = list.tasks || [];
  if (tasks.length === 0) {
    checklistTasksInputContainer.innerHTML =
      '<input type="text" class="input-field checklist-task-item-input" placeholder="Task 1" style="margin-bottom: 0;" />';
  } else {
    tasks.forEach((task) => {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'input-field checklist-task-item-input';
      input.value = task;
      input.style = 'margin-bottom: 0;';
      checklistTasksInputContainer.appendChild(input);
    });
  }

  document.querySelector('#modal-create-checklist h3').textContent = 'Edit Checklist';
  btnSaveChecklist.textContent = 'Update Checklist';
  modalCreateChecklist.classList.remove('hidden');
}

export async function loadSiteLogs() {
  try {
    const { data: logs, error } = await window.supabaseClient
      .from('site_logs')
      .select('id, type, description, equipment_name, photo_base64, created_at')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;

    siteLogsContainer.innerHTML = '';
    if (logs.length === 0) {
      siteLogsContainer.innerHTML =
        '<div style="text-align: center; padding: 20px; color: var(--text-muted);">No reports yet.</div>';
      return;
    }

    logs.forEach((log) => {
      const date = new Date(log.created_at).toLocaleString();
      const typeColor = log.type === 'Maintenance' ? '#fb8c00' : '#e53935';
      const div = document.createElement('div');
      div.style = `background: var(--surface); padding: 15px; border-radius: 10px; border-left: 4px solid ${typeColor};`;

      const topRow = document.createElement('div');
      topRow.style = 'display: flex; justify-content: space-between; margin-bottom: 5px;';

      const typeLabel = document.createElement('strong');
      typeLabel.style = `color: ${typeColor}`;
      typeLabel.textContent = log.type;

      const dateLabel = document.createElement('span');
      dateLabel.style = 'font-size: 0.75rem; color: var(--text-muted);';
      dateLabel.textContent = date;

      topRow.appendChild(typeLabel);
      topRow.appendChild(dateLabel);

      const descEl = document.createElement('p');
      descEl.style = 'font-size: 0.9rem; margin-bottom: 5px;';
      if (log.equipment_name) {
        const strong = document.createElement('strong');
        strong.textContent = `${log.equipment_name}: `;
        descEl.appendChild(strong);
      }
      descEl.appendChild(document.createTextNode(log.description || ''));

      div.appendChild(topRow);
      div.appendChild(descEl);

      if (log.photo_base64) {
        const img = document.createElement('img');
        img.src = log.photo_base64;
        img.style =
          'width: 100px; height: 60px; object-fit: cover; border-radius: 4px; margin-top: 5px; cursor: pointer;';
        img.dataset.fullPhoto = 'true';
        img.dataset.src = log.photo_base64;
        img.addEventListener('click', () => openFullPhoto(log.photo_base64));
        div.appendChild(img);
      }

      siteLogsContainer.appendChild(div);
    });
  } catch (e) {
    console.error('Failed to load site logs:', e);
  }
}

function openFullPhoto(src) {
  if (modalViewPhoto && fullSizePhoto) {
    fullSizePhoto.src = src;
    modalViewPhoto.classList.remove('hidden');
  }
}

export function showChecklistExecution(list) {
  executeChecklistTitle.textContent = list.title;
  executeChecklistDesc.textContent = list.description || '';
  executeChecklistTasks.innerHTML = '';

  const tasks = list.tasks || [];
  if (tasks.length === 0) {
    executeChecklistTasks.innerHTML =
      '<p style="color: var(--text-muted); text-align: center;">No tasks in this checklist.</p>';
  } else {
    tasks.forEach((task, idx) => {
      const div = document.createElement('div');
      div.style =
        'display: flex; align-items: center; gap: 12px; background: var(--surface); padding: 12px; border-radius: 8px; border: 1px solid var(--border); transition: background 0.2s;';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = `task-${idx}`;
      cb.className = 'checklist-checkbox';
      cb.style = 'width: 20px; height: 20px; cursor: pointer; accent-color: var(--primary);';

      const label = document.createElement('label');
      label.htmlFor = `task-${idx}`;
      label.style = 'cursor: pointer; flex: 1; font-size: 0.95rem;';
      label.textContent = task;

      cb.addEventListener('change', () => {
        div.style.background = cb.checked ? 'rgba(46, 204, 113, 0.1)' : 'var(--surface)';
      });

      div.appendChild(cb);
      div.appendChild(label);
      executeChecklistTasks.appendChild(div);
    });
  }

  modalExecuteChecklist.dataset.listId = list.id;
  document.getElementById('execute-closers-names').value = '';
  modalExecuteChecklist.classList.remove('hidden');
}

export async function loadChecklistHistory() {
  if (!checklistHistoryContainer) return;
  try {
    const { data: completions, error } = await window.supabaseClient
      .from('checklist_completions')
      .select('*, checklists (title), users (name)')
      .order('completed_at', { ascending: false })
      .limit(20);

    if (error) throw error;

    checklistHistoryContainer.innerHTML = '';
    if (completions.length === 0) {
      checklistHistoryContainer.innerHTML =
        '<div style="text-align: center; padding: 20px; color: var(--text-muted);">No completed checklists yet.</div>';
      return;
    }

    completions.forEach((comp) => {
      const date = new Date(comp.completed_at).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
      const title = comp.checklists ? comp.checklists.title : 'Deleted Checklist';
      const completedBy = comp.users
        ? comp.users.name
        : comp.closers_names
          ? comp.closers_names.split(',')[0]
          : 'Unknown';

      const div = document.createElement('div');
      div.style =
        'background: var(--surface); padding: 12px; border-radius: 10px; border: 1px solid var(--border);';

      const header = document.createElement('div');
      header.style =
        'display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 5px;';

      const titleEl = document.createElement('strong');
      titleEl.style = 'color: var(--primary); font-size: 0.9rem;';
      titleEl.textContent = title;

      const dateEl = document.createElement('span');
      dateEl.style = 'font-size: 0.75rem; color: var(--text-muted);';
      dateEl.textContent = date;

      header.appendChild(titleEl);
      header.appendChild(dateEl);

      const byEl = document.createElement('div');
      byEl.style = 'font-size: 0.8rem; color: var(--text);';
      byEl.textContent = `Completed by: `;
      const byName = document.createElement('span');
      byName.style = 'font-weight: 600;';
      byName.textContent = completedBy;
      byEl.appendChild(byName);

      div.appendChild(header);
      div.appendChild(byEl);

      if (comp.closers_names) {
        const closersEl = document.createElement('div');
        closersEl.style = 'font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;';
        closersEl.textContent = `Closers: ${comp.closers_names}`;
        div.appendChild(closersEl);
      }

      checklistHistoryContainer.appendChild(div);
    });
  } catch (e) {
    console.error('History Error:', e);
  }
}

export function init() {
  if (btnShowMaintenanceForm) {
    btnShowMaintenanceForm.addEventListener('click', () =>
      modalMaintenance.classList.remove('hidden'),
    );
  }
  if (btnShowIncidentForm) {
    btnShowIncidentForm.addEventListener('click', () => modalIncident.classList.remove('hidden'));
  }
  if (btnCancelMaint) {
    btnCancelMaint.addEventListener('click', () => modalMaintenance.classList.add('hidden'));
  }
  if (btnCancelIncident) {
    btnCancelIncident.addEventListener('click', () => modalIncident.classList.add('hidden'));
  }

  if (btnCreateChecklist) {
    btnCreateChecklist.addEventListener('click', () => {
      state.editingChecklistId = null;
      checklistTitleInput.value = '';
      checklistDescInput.value = '';
      checklistRoleInput.value = 'Employee';
      checklistTasksInputContainer.innerHTML =
        '<input type="text" class="input-field checklist-task-item-input" placeholder="Task 1" style="margin-bottom: 0;" />';
      document.querySelector('#modal-create-checklist h3').textContent = 'Create New Checklist';
      btnSaveChecklist.textContent = 'Create Checklist';
      modalCreateChecklist.classList.remove('hidden');
    });
  }

  if (btnCancelCreateChecklist) {
    btnCancelCreateChecklist.addEventListener('click', () =>
      modalCreateChecklist.classList.add('hidden'),
    );
  }

  if (btnAddTaskRow) {
    btnAddTaskRow.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'input-field checklist-task-item-input';
      input.placeholder = `Task ${document.querySelectorAll('.checklist-task-item-input').length + 1}`;
      input.style = 'margin-bottom: 0;';
      checklistTasksInputContainer.appendChild(input);
    });
  }

  if (btnSaveChecklist) {
    btnSaveChecklist.addEventListener('click', async () => {
      const title = checklistTitleInput.value.trim();
      const desc = checklistDescInput.value.trim();
      const role = checklistRoleInput.value;
      const taskInputs = document.querySelectorAll('.checklist-task-item-input');
      const tasks = Array.from(taskInputs)
        .map((inp) => inp.value.trim())
        .filter((t) => t !== '');

      if (!title) {
        showToast('Please enter a title', 'error');
        return;
      }

      try {
        const payload = { title, description: desc, role_required: role, tasks };
        let error;
        if (state.editingChecklistId) {
          const res = await window.supabaseClient
            .from('checklists')
            .update(payload)
            .eq('id', state.editingChecklistId);
          error = res.error;
        } else {
          const res = await window.supabaseClient.from('checklists').insert([payload]);
          error = res.error;
        }
        if (error) throw error;
        showToast(
          state.editingChecklistId ? 'Checklist updated!' : 'Checklist created!',
          'success',
        );
        modalCreateChecklist.classList.add('hidden');
        state.editingChecklistId = null;
        loadChecklists();
      } catch (e) {
        showToast('Failed to save checklist', 'error');
      }
    });
  }

  if (btnSubmitMaint) {
    btnSubmitMaint.addEventListener('click', async () => {
      const equipment = document.getElementById('maint-equipment').value.trim();
      const desc = document.getElementById('maint-desc').value.trim();
      if (!equipment || !desc) {
        showToast('Please fill in both fields', 'error');
        return;
      }
      const photo = await getBase64(maintPhotoInput.files[0]);
      await submitSiteLog('Maintenance', {
        equipment_name: equipment,
        description: desc,
        photo_base64: photo,
      });
      modalMaintenance.classList.add('hidden');
      document.getElementById('maint-equipment').value = '';
      document.getElementById('maint-desc').value = '';
      maintPhotoInput.value = '';
    });
  }

  if (btnSubmitIncident) {
    btnSubmitIncident.addEventListener('click', async () => {
      const customer = document.getElementById('incident-customer').value.trim();
      const desc = document.getElementById('incident-desc').value.trim();
      if (!customer || !desc) {
        showToast('Please fill in both fields', 'error');
        return;
      }
      const photo = await getBase64(incidentPhotoInput.files[0]);
      await submitSiteLog('Incident', {
        customer_name: customer,
        description: desc,
        photo_base64: photo,
      });
      modalIncident.classList.add('hidden');
      document.getElementById('incident-customer').value = '';
      document.getElementById('incident-desc').value = '';
      incidentPhotoInput.value = '';
    });
  }

  if (btnCancelExecute) {
    btnCancelExecute.addEventListener('click', () => modalExecuteChecklist.classList.add('hidden'));
  }

  if (btnSubmitCompletion) {
    btnSubmitCompletion.addEventListener('click', async () => {
      const listId = modalExecuteChecklist.dataset.listId;
      const closers = document.getElementById('execute-closers-names').value.trim();
      const checkboxes = document.querySelectorAll('.checklist-checkbox');
      const allChecked = Array.from(checkboxes).every((cb) => cb.checked);

      if (!closers) {
        showToast('Please enter the names of the closers', 'error');
        return;
      }
      if (!allChecked) {
        const ok = await confirmAppDialog({
          title: 'Incomplete Checklist',
          message: 'Not all tasks are checked. Complete anyway?',
          confirmLabel: 'Complete Anyway',
          tone: 'primary',
        });
        if (!ok) return;
      }

      try {
        const payload = {
          checklist_id: listId,
          user_id: state.currentUser
            ? state.currentUser.id
            : state.currentManager
              ? state.currentManager.id
              : state.currentPortalEmployee
                ? state.currentPortalEmployee.id
                : null,
          completed_at: new Date().toISOString(),
          closers_names: closers,
        };
        const { error } = await window.supabaseClient
          .from('checklist_completions')
          .insert([payload]);
        if (error) throw error;
        showToast('Checklist completed!', 'success');
        modalExecuteChecklist.classList.add('hidden');
        loadChecklistHistory();
      } catch (e) {
        showToast('Failed to save completion.', 'error');
      }
    });
  }

  if (btnClosePhoto) {
    btnClosePhoto.addEventListener('click', () => {
      if (modalViewPhoto) modalViewPhoto.classList.add('hidden');
    });
  }

  if (modalViewPhoto) {
    modalViewPhoto.addEventListener('click', (e) => {
      if (e.target === modalViewPhoto) modalViewPhoto.classList.add('hidden');
    });
  }
}
