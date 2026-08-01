import { state, showToast, parseShiftHours, confirmAppDialog, normalizeScheduleCellValue } from './utils.js';

function updateCellStyles(input) {
  const val = input.value.trim().toUpperCase();
  input.style.fontWeight = 'bold';
  input.style.borderRadius = '6px';
  input.style.border = '1px solid var(--border)';
  input.style.textAlign = 'center';
  input.style.width = '80px';
  input.style.padding = '6px';
  if (!val || val === '-' || val === 'OFF') {
    input.style.background = 'rgba(231, 76, 60, 0.15)';
    input.style.color = 'var(--danger)';
    input.style.borderColor = 'var(--danger)';
  } else if (val === 'OC') {
    input.style.background = 'rgba(243, 156, 18, 0.15)';
    input.style.color = '#f39c12';
    input.style.borderColor = '#f39c12';
  } else {
    input.style.background = 'rgba(46, 204, 113, 0.15)';
    input.style.color = 'var(--success)';
    input.style.borderColor = 'var(--success)';
  }
}

function recalculateRowTotal(tr) {
  let rowTotal = 0;
  tr.querySelectorAll('.sched-cell').forEach((inp) => {
    rowTotal += parseShiftHours(inp.value);
  });
  const totalCell = tr.cells[tr.cells.length - 1];
  if (totalCell) {
    totalCell.textContent = rowTotal.toFixed(1);
    if (rowTotal > 40) {
      totalCell.style.color = 'var(--danger)';
    } else {
      totalCell.style.color = 'var(--text)';
    }
  }
}

function bindEditorRowEvents(tr) {
  tr.querySelectorAll('.sched-cell').forEach((input) => {
    if (!input.placeholder) input.placeholder = '7am-8pm';
    updateCellStyles(input);
    input.addEventListener('input', () => {
      updateCellStyles(input);
      recalculateRowTotal(tr);
    });
    input.addEventListener('blur', () => {
      const next = normalizeScheduleCellValue(input.value);
      if (next !== input.value) input.value = next;
      updateCellStyles(input);
      recalculateRowTotal(tr);
    });
  });
}

export async function loadSchedules() {
  const scheduleList = document.getElementById('schedule-list');
  if (!scheduleList) return;

  try {
    const [schedulesRes, usersRes, logsRes] = await Promise.all([
      window.supabaseClient.from('schedules').select('*'),
      window.supabaseClient.from('users').select('id, name, role, avatar'),
      window.supabaseClient
        .from('time_logs')
        .select('user_id, action, created_at')
        .order('created_at', { ascending: true }),
    ]);

    if (schedulesRes.error) throw schedulesRes.error;
    const rawData = schedulesRes.data;

    const userStatus = {};
    if (logsRes.data) {
      logsRes.data.forEach((log) => {
        userStatus[log.user_id] = log.action;
      });
    }

    const employeeInfoByName = {};
    if (usersRes.data) {
      usersRes.data.forEach((u) => {
        const lastAction = userStatus[u.id] || 'OUT';
        const isClockedIn =
          lastAction === 'IN' || lastAction === 'END_LUNCH' || lastAction === 'CLOCK_IN';
        let displayRole;
        let roleClass;
        const normRole = (u.role || '').trim().toLowerCase();

        if (normRole === 'site manager') {
          displayRole = 'Site Manager';
          roleClass = 'role-site-manager';
        } else if (normRole === 'assistant site manager' || normRole === 'asst. site manager') {
          displayRole = 'Asst. Site Manager';
          roleClass = 'role-asst-site-manager';
        } else if (normRole === 'supervisor') {
          displayRole = 'Supervisor';
          roleClass = 'role-supervisor';
        } else if (normRole === 'employee') {
          displayRole = 'Attendant';
          roleClass = 'role-attendant';
        } else {
          displayRole = u.role || 'Attendant';
          roleClass = 'role-generic';
        }

        employeeInfoByName[u.name.trim().toLowerCase()] = {
          role: displayRole,
          roleClass: roleClass,
          isClockedIn: isClockedIn,
          avatar: u.avatar || null,
        };
      });
    }

    // Pending schedules are drafts: only visible to a logged-in manager so they
    // can review and edit before publishing. Everyone else sees live schedules.
    const visibleData = state.managerLoggedIn
      ? rawData
      : rawData.filter((s) => s.status !== 'pending');

    const data = visibleData.sort((a, b) => {
      function getStart(sched) {
        try {
          const content = JSON.parse(sched.content);
          const match = (content.weekRange || '').match(/(\d+)\/(\d+)/);
          if (match) {
            const year = new Date(sched.created_at).getFullYear();
            return new Date(year, parseInt(match[1]) - 1, parseInt(match[2]));
          }
        } catch (e) {
          console.error('Failed to parse schedule date for sort:', e);
        }
        return new Date(sched.created_at);
      }
      return getStart(a) - getStart(b);
    });

    const scheduleSelector = document.getElementById('schedule-selector');
    if (scheduleSelector) scheduleSelector.innerHTML = '';
    scheduleList.innerHTML = '';

    if (!data || data.length === 0) {
      scheduleList.innerHTML =
        '<div style="background:var(--card);padding:30px;border-radius:15px;text-align:center;color:var(--text-muted);">No schedules posted yet.</div>';
      return;
    }

    data.forEach((sched, index) => {
      let parsed;
      try {
        parsed = JSON.parse(sched.content);
      } catch (e) {
        parsed = null;
      }
      const weekRange = parsed ? parsed.weekRange || 'Weekly Schedule' : 'Weekly Schedule';
      const isPending = sched.status === 'pending';

      if (scheduleSelector) {
        const btn = document.createElement('button');
        btn.className = 'btn-ghost';
        btn.style.cssText =
          'padding:8px 15px;border:1px solid var(--border);border-radius:8px;cursor:pointer;font-size:0.9rem;transition:all 0.2s;';
        if (isPending) {
          btn.style.borderStyle = 'dashed';
          btn.style.borderColor = '#f39c12';
          btn.textContent = `${weekRange} (Draft)`;
        } else {
          btn.textContent = weekRange;
        }
        btn.onclick = () => {
          document.querySelectorAll('.schedule-card').forEach((c) => c.classList.add('hidden'));
          document.getElementById(`schedule-card-${sched.id}`)?.classList.remove('hidden');
          Array.from(scheduleSelector.children).forEach((b) => {
            b.style.borderColor = 'var(--border)';
            b.style.background = 'none';
          });
          btn.style.borderColor = 'var(--primary)';
          btn.style.background = 'rgba(169,59,47,0.1)';
        };
        if (index === data.length - 1) {
          btn.style.borderColor = 'var(--primary)';
          btn.style.background = 'rgba(169,59,47,0.1)';
        }
        scheduleSelector.appendChild(btn);
      }

      const div = document.createElement('div');
      div.id = `schedule-card-${sched.id}`;
      div.className = 'schedule-card' + (index === data.length - 1 ? '' : ' hidden');
      div.style.cssText = isPending
        ? 'background:var(--card);padding:20px;border-radius:12px;border:2px dashed #f39c12;margin-bottom:20px;'
        : 'background:var(--card);padding:20px;border-radius:12px;border:1px solid var(--border);margin-bottom:20px;';

      const time = new Date(sched.created_at).toLocaleString('en-US', {
        timeZone: 'America/Chicago',
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });

      let contentHtml;
      if (parsed) {
        try {
          const headersHtml = parsed.headers
            .map((h) => `<th class="sched-day-header">${h}</th>`)
            .join('');
          const activeRows = parsed.rows.filter((r) =>
            r.shifts.some((s) => s && s !== '-' && s.trim() !== ''),
          );

          const rowsHtml = activeRows
            .map((r) => {
              let rowTotal = 0;
              const cellsHtml = r.shifts
                .map((s) => {
                  rowTotal += parseShiftHours(s);
                  const isOff = !s || s === '-' || s.trim().toUpperCase() === 'OFF';
                  return `<td class="sched-shift-cell${isOff ? ' sched-off' : ''}">${s || '-'}</td>`;
                })
                .join('');
              const swapBtn =
                state.currentPortalEmployee &&
                r.employee
                  .toLowerCase()
                  .includes(state.currentPortalEmployee.name.toLowerCase().split(' ')[0])
                  ? `<button class="btn-request-swap btn-ghost" data-employee="${r.employee}" data-week="${parsed.weekRange}" style="padding:2px 5px;font-size:0.7rem;border:1px solid var(--border);border-radius:4px;">Request Swap</button>`
                  : '';
              return `<tr>
              <td class="sched-emp-cell"><div style="display:flex;align-items:center;justify-content:space-between;gap:6px;"><strong>${r.employee}</strong>
              <div style="display:flex;gap:4px;align-items:center;flex-shrink:0;">
                ${swapBtn}
              </div></div></td>
              ${cellsHtml}
              <td class="sched-total-cell">${rowTotal.toFixed(1)}</td>
            </tr>`;
            })
            .join('');

          // Helper to get tab labels (e.g. "Wed", "18")
          function getDayTabInfo(header) {
            const parts = header.trim().split(/\s+/);
            const name = parts[0].toUpperCase();
            let number = '';
            if (parts[1] && parts[1].includes('/')) {
              number = parts[1].split('/')[1];
            }
            return { name, number };
          }

          // Determine which day index to display by default (matching today's day name, otherwise 0)
          const dayMap = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
          const currentDayOfWeek = new Date().getDay();
          let activeDayIndex = 0; // fallback to index 0 (usually Wednesday)
          parsed.headers.forEach((h, idx) => {
            const tab = getDayTabInfo(h);
            if (dayMap[tab.name] === currentDayOfWeek) {
              activeDayIndex = idx;
            }
          });

          // Generate day tabs
          const dayTabsHtml = parsed.headers
            .map((h, idx) => {
              const tab = getDayTabInfo(h);
              const isActive = idx === activeDayIndex;
              return `
                <div class="sched-day-tab ${isActive ? 'active' : ''}" data-day-idx="${idx}" data-sched-id="${sched.id}">
                  <div class="sched-day-tab-name">${tab.name}</div>
                  <div class="sched-day-tab-date">${tab.number || idx + 1}</div>
                </div>
              `;
            })
            .join('');

          // Helper to sort shifts by start time
          function getShiftStartMinutes(s) {
            if (!s || s === '-' || s.toUpperCase() === 'OFF') return 9999;
            const timePart = s.split('-')[0].trim().toUpperCase();
            let [time, ampm] = timePart.split(/\s+/);
            if (!ampm && (timePart.endsWith('AM') || timePart.endsWith('PM'))) {
              ampm = timePart.slice(-2);
              time = timePart.slice(0, -2);
            }
            let [hours, minutes] = time.split(':').map(Number);
            if (isNaN(minutes)) minutes = 0;
            if (ampm === 'PM' && hours < 12) hours += 12;
            if (ampm === 'AM' && hours === 12) hours = 0;
            return hours * 60 + minutes;
          }

          // Generate daily rosters HTML
          const rostersHtml = parsed.headers
            .map((h, dayIdx) => {
              const isPaneHidden = dayIdx !== activeDayIndex ? 'hidden' : '';

              // Filter active rows that have a valid shift (not OFF) on this day
              const dayEmployees = activeRows.filter((r) => {
                const s = r.shifts[dayIdx];
                return s && s !== '-' && s.trim().toUpperCase() !== 'OFF';
              });

              // Sort chronologically by start time
              dayEmployees.sort((a, b) => {
                return (
                  getShiftStartMinutes(a.shifts[dayIdx]) - getShiftStartMinutes(b.shifts[dayIdx])
                );
              });

              const listItemsHtml =
                dayEmployees.length > 0
                  ? dayEmployees
                      .map((r) => {
                        const shift = r.shifts[dayIdx];
                        const normName = r.employee.trim().toLowerCase();
                        const info = employeeInfoByName[normName] || {
                          role: 'Attendant',
                          roleClass: 'role-attendant',
                          isClockedIn: false,
                        };

                        const initials = r.employee
                          .split(/\s+/)
                          .map((p) => p[0])
                          .join('')
                          .slice(0, 2)
                          .toUpperCase();

                        const swapBtn =
                          state.currentPortalEmployee &&
                          normName.includes(
                            state.currentPortalEmployee.name.toLowerCase().split(' ')[0],
                          )
                            ? `<button class="btn-request-swap btn-ghost" data-employee="${r.employee}" data-week="${parsed.weekRange}" style="padding:4px 8px;font-size:0.7rem;border:1px solid var(--border);border-radius:6px;cursor:pointer;">Request Swap</button>`
                            : '';

                        const avatarHtml = info.avatar
                          ? `<img class="sched-roster-avatar" src="${info.avatar}" alt="" />`
                          : `<div class="sched-roster-avatar">${initials}</div>`;

                        return `
                      <div class="sched-roster-item" style="display: flex; align-items: center; justify-content: flex-start; padding: 14px 20px; gap: 25px; flex-wrap: wrap;">
                        <div class="sched-roster-time" style="font-family: inherit; font-weight: 600; font-size: 0.95rem; color: var(--text-muted); flex: 0 0 110px; text-align: left; min-width: 110px;">${shift}</div>
                        <div class="sched-roster-emp" style="display: flex; align-items: center; gap: 12px; flex: 0 1 auto; min-width: 0;">
                          ${avatarHtml}
                          <div class="sched-roster-emp-meta" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <span class="sched-roster-name" style="font-weight: 600;">${r.employee}</span>
                            <span class="role-badge ${info.roleClass}">${info.role}</span>
                          </div>
                        </div>
                        <div class="sched-roster-actions" style="display: flex; align-items: center; justify-content: flex-start; gap: 15px; flex: 0 0 auto; min-width: fit-content; flex-shrink: 0;">
                          <div class="status-indicator ${info.isClockedIn ? 'clocked-in' : 'scheduled'}" style="display: flex; align-items: center; gap: 10px; font-size: 0.8rem; font-weight: 600; white-space: nowrap; flex-shrink: 0;">
                            <span class="status-dot"></span>
                            <span>${info.isClockedIn ? 'Clocked In' : 'Scheduled'}</span>
                          </div>
                          ${swapBtn}
                        </div>
                      </div>
                    `;
                      })
                      .join('')
                  : `<div style="text-align: center; color: var(--text-muted); padding: 30px; background: var(--surface); border-radius: 10px; border: 1px dashed var(--border);">No employees scheduled for this day.</div>`;

              return `
                <div class="sched-day-roster-pane ${isPaneHidden}" data-pane-day-idx="${dayIdx}" data-sched-id="${sched.id}">
                  <div style="font-size: 0.95rem; color: var(--text-muted); margin-bottom: 12px; font-weight: 600;">
                    ${h} | ${dayEmployees.length} Employees Scheduled
                  </div>
                  <div style="display: flex; flex-direction: column; gap: 10px;">
                    ${listItemsHtml}
                  </div>
                </div>
              `;
            })
            .join('');

          contentHtml = `
            <div class="schedule-day-tabs">
              ${dayTabsHtml}
            </div>
            <div class="sched-day-rosters">
              ${rostersHtml}
            </div>
            <div class="schedule-desktop-table" style="display: none;">
              <div class="sched-table-scroll">
                <table class="data-table schedule-full-table">
                  <thead>
                    <tr><th>Employee</th>${headersHtml}<th>Total</th></tr>
                  </thead>
                  <tbody>
                    ${rowsHtml}
                  </tbody>
                </table>
              </div>
            </div>
          `;
        } catch (e) {
          console.error(e);
          contentHtml = `<div style="white-space:pre-wrap;line-height:1.5;">${sched.content}</div>`;
        }
      } else {
        contentHtml = `<div style="white-space:pre-wrap;line-height:1.5;">${sched.content}</div>`;
      }

      const editBtn = state.managerLoggedIn
        ? `<button class="sched-action-btn sched-action-btn--ghost btn-edit-schedule" data-id="${sched.id}" data-status="${sched.status || 'published'}" data-publish-at="${sched.publish_at || ''}" data-content="${encodeURIComponent(sched.content)}">Edit</button>`
        : '';
      const publishBtn =
        state.managerLoggedIn && isPending
          ? `<button class="sched-action-btn sched-action-btn--publish btn-publish-schedule" data-id="${sched.id}">Publish / Go Live</button>`
          : '';
      const deleteBtn = state.managerLoggedIn
        ? `<button class="sched-action-btn sched-action-btn--danger btn-delete-schedule" data-id="${sched.id}">Delete</button>`
        : '';

      const scheduledPublishText =
        isPending && sched.publish_at
          ? ` · Auto-publishes ${new Date(sched.publish_at).toLocaleString('en-US', {
              timeZone: 'America/Chicago',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}`
          : '';
      const statusLabel = isPending
        ? `<span style="display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;"><span style="background:rgba(243,156,18,0.15);color:#f39c12;border:1px solid #f39c12;padding:2px 10px;border-radius:12px;font-weight:bold;font-size:0.7rem;text-transform:uppercase;letter-spacing:0.5px;">Pending · Not live</span><span>Draft created ${time}${scheduledPublishText}</span></span>`
        : `<span>Posted on ${time}</span>`;

      div.innerHTML = `<div style="color:var(--text-muted);font-size:0.85rem;margin-bottom:15px;border-bottom:1px solid var(--border);padding-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
        ${statusLabel}<div style="display:flex;gap:8px;flex-wrap:wrap;">${publishBtn}${editBtn}${deleteBtn}</div></div>${contentHtml}`;

      scheduleList.appendChild(div);
    });

    // Bind click handlers for roster day tabs
    document.querySelectorAll('.sched-day-tab').forEach((tab) => {
      tab.addEventListener('click', (e) => {
        const tabEl = e.currentTarget;
        const dayIdx = parseInt(tabEl.dataset.dayIdx);
        const schedId = tabEl.dataset.schedId;

        // Deactivate all sibling tabs for this schedule card
        document.querySelectorAll(`.sched-day-tab[data-sched-id="${schedId}"]`).forEach((t) => {
          t.classList.remove('active');
        });
        tabEl.classList.add('active');

        // Hide all panes for this schedule card and show the selected pane
        document
          .querySelectorAll(`.sched-day-roster-pane[data-sched-id="${schedId}"]`)
          .forEach((p) => {
            p.classList.add('hidden');
          });
        const activePane = document.querySelector(
          `.sched-day-roster-pane[data-sched-id="${schedId}"][data-pane-day-idx="${dayIdx}"]`,
        );
        if (activePane) {
          activePane.classList.remove('hidden');
        }
      });
    });
  } catch (e) {
    scheduleList.innerHTML =
      '<div style="background:var(--card);padding:30px;border-radius:15px;text-align:center;color:var(--danger);">Failed to load schedules.</div>';
  }
}

// --- Calendar Export ---
window.downloadCalendar = function downloadCalendar(encodedData) {
  try {
    const data = JSON.parse(decodeURIComponent(encodedData));
    const { employee, shifts, weekRange } = data;
    const year = new Date().getFullYear();
    let baseDate = new Date();

    try {
      const parts = weekRange.split('-').map((p) => p.trim());
      const startPart = parts[0];
      if (startPart.includes('/')) {
        const [m, d] = startPart.split('/').map(Number);
        if (!isNaN(m) && !isNaN(d)) baseDate = new Date(year, m - 1, d);
      } else {
        const p = new Date(`${startPart}, ${year}`);
        if (!isNaN(p.getTime())) baseDate = p;
      }
    } catch (e) {
      console.error('Failed to parse week range for calendar:', e);
    }

    let icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Longhorn Car Wash//Timeclock//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
    ];

    shifts.forEach((s, idx) => {
      if (!s || s === '-' || s.toLowerCase() === 'off' || s.toLowerCase() === 'oc') return;
      const hours = s.split('-');
      if (hours.length < 2) return;

      function parseTime(ts) {
        let [h, m] = ts.split(':').map(Number);
        if (isNaN(m)) m = 0;
        return { h, m };
      }

      const start = parseTime(hours[0].trim());
      const end = parseTime(hours[1].trim());
      let sh = start.h,
        eh = end.h;
      if (sh >= 1 && sh < 7) sh += 12;
      if (eh <= sh && eh !== 0) eh += 12;

      const formatDate = (offset, h, m) => {
        const d = new Date(baseDate);
        d.setDate(baseDate.getDate() + offset);
        d.setHours(h, m, 0);
        const pad = (n) => String(n).padStart(2, '0');
        return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`;
      };

      const dtStamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      const uid = `shift-${employee.replace(/\s+/g, '-')}-${idx}-${Date.now()}@longhorn.com`;
      icsContent.push(
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${dtStamp}`,
        `SUMMARY:Car Wash Shift: ${employee}`,
        `DTSTART:${formatDate(idx, sh, start.m)}`,
        `DTEND:${formatDate(idx, eh, end.m)}`,
        'LOCATION:Longhorn Car Wash',
        'END:VEVENT',
      );
    });

    icsContent.push('END:VCALENDAR');
    const content = icsContent.join('\r\n');
    const fileName = `${employee}_Schedule.ics`;
    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    if (isIOS) {
      window.location.href = `data:text/calendar;base64,${btoa(unescape(encodeURIComponent(content)))}`;
    } else {
      const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', fileName);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
    showToast('Calendar file generated!');
  } catch (err) {
    console.error(err);
    showToast('Failed to generate calendar file.', 'error');
  }
};

export function init() {
  const scheduleList = document.getElementById('schedule-list');
  const btnShowPostSchedule = document.getElementById('btn-show-post-schedule');
  const postScheduleSection = document.getElementById('post-schedule-section');
  const scheduleWeekRange = document.getElementById('schedule-week-range');
  const scheduleEditorBody = document.getElementById('schedule-editor-body');
  const btnSubmitSchedule = document.getElementById('btn-submit-schedule');
  const scheduleHeaderInputs = document.querySelectorAll('.schedule-header-input');
  const btnPrintSchedule = document.getElementById('btn-print-schedule');
  const btnScheduleManagerLogin = document.getElementById('btn-schedule-manager-login');
  const scheduleManagerAuth = document.getElementById('schedule-manager-auth');
  const schedulePublishAt = document.getElementById('schedule-publish-at');
  const scheduleAutopublishRow = document.getElementById('schedule-autopublish-row');

  // Convert a stored UTC ISO timestamp into the local `YYYY-MM-DDTHH:mm` value a
  // datetime-local input expects (and back-conversion happens via `new Date()`).
  function isoToLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  if (btnPrintSchedule) btnPrintSchedule.addEventListener('click', () => window.print());

  if (btnScheduleManagerLogin) {
    btnScheduleManagerLogin.addEventListener('click', () => {
      if (scheduleManagerAuth) scheduleManagerAuth.classList.toggle('hidden');
    });
  }

  if (btnShowPostSchedule) {
    btnShowPostSchedule.addEventListener('click', async () => {
      state.editingScheduleId = null;
      state.editingScheduleStatus = null;
      state.editingScheduleOriginalContent = null;
      if (btnSubmitSchedule) btnSubmitSchedule.textContent = 'Save Draft';
      if (scheduleWeekRange) scheduleWeekRange.value = '';
      if (schedulePublishAt) schedulePublishAt.value = '';
      if (scheduleAutopublishRow) scheduleAutopublishRow.classList.remove('hidden');
      if (postScheduleSection) postScheduleSection.classList.toggle('hidden');

      if (postScheduleSection && !postScheduleSection.classList.contains('hidden')) {
        try {
          const { data: users } = await window.supabaseClient
            .from('users')
            .select('name')
            .eq('is_approved', true)
            .order('name', { ascending: true });
          if (scheduleEditorBody) scheduleEditorBody.innerHTML = '';
          if (users) {
            users.forEach((u) => {
              const tr = document.createElement('tr');
              const inputs = Array(7)
                .fill(0)
                .map(
                  () =>
                    `<td><input type="text" class="input-field sched-cell" placeholder="7am-8pm" style="padding:5px;text-align:center;margin-bottom:0;"></td>`,
                )
                .join('');
              tr.innerHTML = `<td><strong>${u.name}</strong></td>${inputs}<td style="text-align:center;font-weight:bold;">-</td>`;
              scheduleEditorBody.appendChild(tr);
              bindEditorRowEvents(tr);
            });
          }
          scheduleHeaderInputs.forEach((inp, idx) => {
            inp.value = ['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue'][idx];
          });
        } catch (e) {
          showToast('Failed to load employees for schedule editor.', 'error');
        }
      }
    });
  }

  if (scheduleWeekRange) {
    scheduleWeekRange.addEventListener('input', () => {
      const val = scheduleWeekRange.value.trim();
      if (!val) return;
      try {
        const match = val.match(/(\d+)\/(\d+)/);
        if (!match) return;
        const startDate = new Date(
          new Date().getFullYear(),
          parseInt(match[1]) - 1,
          parseInt(match[2]),
        );
        if (isNaN(startDate.getTime())) return;
        scheduleHeaderInputs.forEach((inp, idx) => {
          const d = new Date(startDate);
          d.setDate(startDate.getDate() + idx);
          inp.value = `${['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue'][idx]} ${d.getMonth() + 1}/${d.getDate()}`;
        });
      } catch (e) {
        console.error('Failed to auto-fill schedule date headers:', e);
      }
    });
  }

  // Read the current state of the schedule editor into a plain object. Used
  // both to build what gets saved and to snapshot the editor when editing
  // begins, so an unchanged save can be detected reliably.
  function readScheduleEditor() {
    const weekRange = scheduleWeekRange
      ? scheduleWeekRange.value.trim() || 'Weekly Schedule'
      : 'Weekly Schedule';
    const headers = Array.from(document.querySelectorAll('.schedule-header-input')).map(
      (i) => i.value || '-',
    );
    const rows = [];
    scheduleEditorBody?.querySelectorAll('tr').forEach((tr) => {
      const employee = tr.querySelector('td strong')?.innerText || '';
      const shifts = Array.from(tr.querySelectorAll('.sched-cell')).map(
        (i) => normalizeScheduleCellValue(i.value || '-'),
      );
      rows.push({ employee, shifts });
    });
    return { weekRange, headers, rows };
  }

  if (btnSubmitSchedule) {
    btnSubmitSchedule.addEventListener('click', async () => {
      btnSubmitSchedule.disabled = true;
      btnSubmitSchedule.style.opacity = '0.5';

      const scheduleData = readScheduleEditor();
      const { weekRange, rows } = scheduleData;

      // Conflict detection
      try {
        const { data: timeoffs } = await window.supabaseClient
          .from('time_off_requests')
          .select('*')
          .eq('status', 'Approved');
        if (timeoffs) {
          const conflicts = rows
            .filter((row) => {
              const emp = Object.values(state.employeeMap).find(
                (e) => e.name.toLowerCase() === row.employee.toLowerCase(),
              );
              if (!emp) return false;
              const hasShifts = row.shifts.some((s) => s && s !== '-' && s.trim() !== '');
              return hasShifts && timeoffs.some((t) => t.user_id === emp.id);
            })
            .map((r) => r.employee);

          if (conflicts.length > 0) {
            const ok = await confirmAppDialog({
              title: 'Time-Off Conflict',
              message: `Warning: These employees have approved time-off: ${conflicts.join(', ')}. Proceed?`,
              confirmLabel: 'Proceed',
              tone: 'primary',
            });
            if (!ok) {
              btnSubmitSchedule.disabled = false;
              btnSubmitSchedule.style.opacity = '1';
              return;
            }
          }
        }
      } catch (e) {
        console.error('Conflict detection error', e);
      }

      try {
        const newContent = JSON.stringify(scheduleData);

        // When editing, compare against the snapshot taken when the editor was
        // opened. If the manager changed nothing, skip re-notifying everyone.
        // A brand-new post has no snapshot and always counts as changed.
        const contentChanged =
          !state.editingScheduleId ||
          state.editingScheduleOriginalContent == null ||
          newContent !== state.editingScheduleOriginalContent;

        // New schedules are saved as pending drafts so a manager can review and
        // adjust them before they go live. An edit keeps whatever status the
        // schedule already had (a draft stays a draft; a live one stays live).
        const isNew = !state.editingScheduleId;
        const isDraft = isNew || state.editingScheduleStatus === 'pending';

        // Optional auto-publish time only applies to drafts. Stored as UTC.
        const publishAtRaw = schedulePublishAt ? schedulePublishAt.value : '';
        const publishAtIso = isDraft && publishAtRaw ? new Date(publishAtRaw).toISOString() : null;

        let error;
        if (state.editingScheduleId) {
          // Editing a draft can change its auto-publish time; editing a live
          // schedule leaves publish workflow fields untouched.
          const updatePayload = isDraft
            ? { content: newContent, publish_at: publishAtIso }
            : { content: newContent };
          ({ error } = await window.supabaseClient
            .from('schedules')
            .update(updatePayload)
            .eq('id', state.editingScheduleId));
        } else {
          ({ error } = await window.supabaseClient
            .from('schedules')
            .insert([{ content: newContent, status: 'pending', publish_at: publishAtIso }]));
        }
        if (error) throw error;

        // Only a live schedule notifies employees, and only when it actually
        // changed. Draft saves stay silent — notifications fire when the draft
        // is published. Isolated so CORS/network failures don't block the save.
        if (!isDraft && contentChanged) {
          try {
            const employeeNames = rows.map((r) => r.employee);
            const { data: rpcData, error: rpcErr } = await window.supabaseClient.rpc(
              'send_schedule_notifications',
              { employee_names: employeeNames, week_range: weekRange },
            );

            if (rpcErr) {
              console.warn('Failed to send schedule notifications via database RPC:', rpcErr);
            } else {
              console.log('Schedule push notifications RPC result:', rpcData);
            }
          } catch (pushErr) {
            console.warn('Failed to invoke schedule notifications RPC:', pushErr);
          }
        }

        const scheduledNote = publishAtIso
          ? ` It will go live automatically on ${new Date(publishAtIso).toLocaleString('en-US', {
              timeZone: 'America/Chicago',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}.`
          : '';
        showToast(
          isNew
            ? `Draft saved. Review it, then Publish to go live.${scheduledNote}`
            : isDraft
              ? contentChanged
                ? `Draft updated. Publish when ready.${scheduledNote}`
                : 'No changes to save.'
              : contentChanged
                ? 'Schedule updated!'
                : 'No changes to save.',
        );
        state.editingScheduleId = null;
        state.editingScheduleStatus = null;
        state.editingScheduleOriginalContent = null;
        if (postScheduleSection) postScheduleSection.classList.add('hidden');
        loadSchedules();
      } catch (err) {
        showToast('Failed to save schedule.', 'error');
      } finally {
        btnSubmitSchedule.disabled = false;
        btnSubmitSchedule.style.opacity = '1';
      }
    });
  }

  // Schedule list delegation (edit, delete, calendar, swap)
  if (scheduleList) {
    scheduleList.addEventListener('click', async (e) => {
      if (e.target.classList.contains('btn-edit-schedule')) {
        state.editingScheduleId = e.target.dataset.id;
        state.editingScheduleStatus = e.target.dataset.status || 'published';
        state.editingScheduleOriginalContent = null;
        try {
          const parsed = JSON.parse(decodeURIComponent(e.target.dataset.content));
          if (scheduleWeekRange) scheduleWeekRange.value = parsed.weekRange || '';

          // Auto-publish is a draft-only control: show and prefill it for a
          // pending draft, hide it when editing a schedule that is already live.
          const editingDraft = state.editingScheduleStatus === 'pending';
          if (scheduleAutopublishRow)
            scheduleAutopublishRow.classList.toggle('hidden', !editingDraft);
          if (schedulePublishAt)
            schedulePublishAt.value = editingDraft
              ? isoToLocalInput(e.target.dataset.publishAt)
              : '';
          parsed.headers.forEach((h, idx) => {
            if (scheduleHeaderInputs[idx]) scheduleHeaderInputs[idx].value = h;
          });
          if (scheduleEditorBody) scheduleEditorBody.innerHTML = '';

          const { data: currentUsers } = await window.supabaseClient
            .from('users')
            .select('name')
            .eq('is_approved', true)
            .order('name', { ascending: true });
          (currentUsers || []).forEach((u) => {
            const savedRow = parsed.rows.find((r) => r.employee === u.name);
            const shifts = savedRow ? savedRow.shifts : ['-', '-', '-', '-', '-', '-', '-'];
            let rowTotal = 0;
            const cellsHtml = shifts
              .map((s) => {
                rowTotal += parseShiftHours(s);
                return `<td><input type="text" class="input-field sched-cell" value="${s}" placeholder="7am-8pm" style="padding:5px;text-align:center;margin-bottom:0;"></td>`;
              })
              .join('');
            const tr = document.createElement('tr');
            tr.innerHTML = `<td><strong>${u.name}</strong></td>${cellsHtml}<td style="text-align:center;font-weight:bold;">${rowTotal.toFixed(1)}</td>`;
            scheduleEditorBody?.appendChild(tr);
            bindEditorRowEvents(tr);
          });

          // Snapshot the freshly-populated editor; a save that matches this
          // exactly means nothing was changed and no notification is sent.
          state.editingScheduleOriginalContent = JSON.stringify(readScheduleEditor());

          if (btnSubmitSchedule)
            btnSubmitSchedule.textContent =
              state.editingScheduleStatus === 'pending' ? 'Save Draft' : 'Save Changes';
          if (postScheduleSection) {
            postScheduleSection.classList.remove('hidden');
            postScheduleSection.scrollIntoView({ behavior: 'smooth' });
          }
        } catch (err) {
          showToast('Could not load schedule for editing.', 'error');
        }
      } else if (e.target.classList.contains('btn-publish-schedule')) {
        const id = e.target.dataset.id;
        const ok = await confirmAppDialog({
          title: 'Publish Schedule',
          message: 'Publish this schedule? It will go live for employees and they will be notified.',
          confirmLabel: 'Publish',
          tone: 'primary',
        });
        if (!ok) return;
        e.target.disabled = true;
        e.target.style.opacity = '0.5';
        try {
          const { error } = await window.supabaseClient
            .from('schedules')
            .update({ status: 'published' })
            .eq('id', id);
          if (error) throw error;

          // Notify the scheduled employees now that the schedule is live.
          // Isolated so CORS/network failures don't block publishing.
          try {
            const { data: sched } = await window.supabaseClient
              .from('schedules')
              .select('content')
              .eq('id', id)
              .limit(1)
              .single();
            const parsed = sched ? JSON.parse(sched.content) : null;
            if (parsed) {
              const employeeNames = (parsed.rows || []).map((r) => r.employee);
              const { error: rpcErr } = await window.supabaseClient.rpc(
                'send_schedule_notifications',
                { employee_names: employeeNames, week_range: parsed.weekRange || '' },
              );
              if (rpcErr)
                console.warn('Failed to send schedule notifications via database RPC:', rpcErr);
            }
          } catch (pushErr) {
            console.warn('Failed to invoke schedule notifications RPC:', pushErr);
          }

          showToast('Schedule published! Employees have been notified.');
          loadSchedules();
        } catch (err) {
          showToast('Failed to publish schedule.', 'error');
          e.target.disabled = false;
          e.target.style.opacity = '1';
        }
      } else if (e.target.classList.contains('btn-delete-schedule')) {
        const ok = await confirmAppDialog({
          title: 'Delete Schedule',
          message: 'Delete this schedule?',
          confirmLabel: 'Delete Schedule',
        });
        if (!ok) return;
        try {
          const { error } = await window.supabaseClient
            .from('schedules')
            .delete()
            .eq('id', e.target.dataset.id);
          if (error) throw error;
          showToast('Schedule deleted');
          loadSchedules();
        } catch (err) {
          showToast('Failed to delete schedule.', 'error');
        }
      } else if (e.target.classList.contains('btn-request-swap')) {
        const emp = e.target.dataset.employee;
        const week = e.target.dataset.week;
        const modalShiftSwap = document.getElementById('modal-shift-swap');
        const swapTargetEmployee = document.getElementById('swap-target-employee');

        if (swapTargetEmployee) {
          try {
            const { data: users } = await window.supabaseClient
              .from('users')
              .select('name')
              .eq('is_approved', true);
            swapTargetEmployee.innerHTML = '<option value="">Select a teammate...</option>';
            (users || []).forEach((u) => {
              if (u.name !== emp) {
                const opt = document.createElement('option');
                opt.value = u.name;
                opt.textContent = u.name;
                swapTargetEmployee.appendChild(opt);
              }
            });
          } catch (e) {
            showToast('Failed to load employees for swap.', 'error');
          }
        }

        if (modalShiftSwap) {
          modalShiftSwap.dataset.originator = emp;
          modalShiftSwap.dataset.week = week;
          modalShiftSwap.classList.remove('hidden');
        }
      }
    });
  }

  // Shift swap modal
  const btnCancelSwap = document.getElementById('btn-cancel-swap');
  const btnSubmitSwap = document.getElementById('btn-submit-swap');
  const modalShiftSwap = document.getElementById('modal-shift-swap');

  if (btnCancelSwap)
    btnCancelSwap.addEventListener('click', () => {
      if (modalShiftSwap) modalShiftSwap.classList.add('hidden');
    });
  if (btnSubmitSwap) {
    btnSubmitSwap.addEventListener('click', async () => {
      const swapTargetSelect = document.getElementById('swap-target-employee');
      const swapDetailsInput = document.getElementById('swap-details');
      const target = swapTargetSelect?.value;
      const details = swapDetailsInput?.value.trim();
      if (!target || !details) {
        showToast('Please select a teammate and provide details.', 'error');
        return;
      }
      try {
        // Resolve the chosen teammate's id so the request records who it's with.
        const { data: targetUser } = await window.supabaseClient
          .from('users')
          .select('id')
          .eq('name', target)
          .limit(1)
          .maybeSingle();

        const { error } = await window.supabaseClient.from('shift_swaps').insert([
          {
            original_user_id: state.currentPortalEmployee?.id,
            target_user_id: targetUser?.id ?? null,
            shift_date: new Date().toISOString().split('T')[0],
            week_range: modalShiftSwap?.dataset.week || null,
            details,
            status: 'Pending',
            created_at: new Date().toISOString(),
          },
        ]);
        if (error) throw error;
        showToast('Swap request sent to manager!');
        if (swapDetailsInput) swapDetailsInput.value = '';
        if (swapTargetSelect) swapTargetSelect.value = '';
        if (modalShiftSwap) modalShiftSwap.classList.add('hidden');
      } catch (e) {
        showToast('Failed to send swap request.', 'error');
      }
    });
  }

  // Schedule templates
  const btnSaveTemplate = document.getElementById('btn-save-schedule-template');
  const btnLoadTemplate = document.getElementById('btn-load-schedule-template');

  if (btnSaveTemplate) {
    btnSaveTemplate.addEventListener('click', async () => {
      const rows = [];
      document.querySelectorAll('#schedule-editor-table tbody tr').forEach((tr) => {
        const empName = tr.querySelector('td strong')?.innerText || tr.cells[0].textContent;
        const shifts = Array.from(tr.querySelectorAll('.sched-cell')).map((i) => i.value);
        rows.push({ employee: empName, shifts });
      });
      try {
        const { saveSettingRobust } = await import('./utils.js');
        await saveSettingRobust('schedule_template_standard', JSON.stringify(rows));
        showToast('Schedule saved as standard template!');
      } catch (e) {
        showToast('Failed to save template.', 'error');
      }
    });
  }

  if (btnLoadTemplate) {
    btnLoadTemplate.addEventListener('click', async () => {
      try {
        const { data, error } = await window.supabaseClient
          .from('settings')
          .select('value')
          .eq('id', 'schedule_template_standard')
          .limit(1);
        if (error || !data || data.length === 0) {
          showToast('No template found.', 'error');
          return;
        }
        const rows = JSON.parse(data[0].value);
        const tbody = document.querySelector('#schedule-editor-table tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        rows.forEach((r) => {
          let rowTotal = 0;
          const cells = r.shifts
            .map((s) => {
              rowTotal += parseShiftHours(s);
              return `<td><input type="text" class="input-field sched-cell" value="${s || '-'}" placeholder="7am-8pm" style="padding:5px;text-align:center;margin-bottom:0;" /></td>`;
            })
            .join('');
          const tr = document.createElement('tr');
          tr.innerHTML = `<td><strong>${r.employee}</strong></td>${cells}<td style="text-align:center;font-weight:bold;">${rowTotal.toFixed(1)}</td>`;
          tbody.appendChild(tr);
          bindEditorRowEvents(tr);
        });
        showToast('Template loaded!');
      } catch (e) {
        showToast('Failed to load template.', 'error');
      }
    });
  }

  // Auto-Fill Previous Week
  const btnAutofill = document.getElementById('btn-autofill-previous-week');
  if (btnAutofill) {
    btnAutofill.addEventListener('click', async () => {
      try {
        const { data, error } = await window.supabaseClient
          .from('schedules')
          .select('*')
          .neq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(1);
        if (error || !data || data.length === 0) {
          showToast('No previous schedule found.', 'error');
          return;
        }
        const parsed = JSON.parse(data[0].content);
        const tbody = document.getElementById('schedule-editor-body');
        if (!tbody) return;
        tbody.innerHTML = '';

        const { data: currentUsers } = await window.supabaseClient
          .from('users')
          .select('name')
          .eq('is_approved', true)
          .order('name', { ascending: true });

        (currentUsers || []).forEach((u) => {
          const savedRow = parsed.rows.find((r) => r.employee === u.name);
          const shifts = savedRow ? savedRow.shifts : ['-', '-', '-', '-', '-', '-', '-'];
          let rowTotal = 0;
          const cellsHtml = shifts
            .map((s) => {
              rowTotal += parseShiftHours(s);
              return `<td><input type="text" class="input-field sched-cell" value="${s}" placeholder="7am-8pm" style="padding:5px;text-align:center;margin-bottom:0;"></td>`;
            })
            .join('');
          const tr = document.createElement('tr');
          tr.innerHTML = `<td><strong>${u.name}</strong></td>${cellsHtml}<td style="text-align:center;font-weight:bold;">${rowTotal.toFixed(1)}</td>`;
          tbody.appendChild(tr);
          bindEditorRowEvents(tr);
        });
        showToast('Auto-filled from previous week!');
      } catch (e) {
        showToast('Failed to auto-fill schedule.', 'error');
      }
    });
  }
}
