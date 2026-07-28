import {
  state,
  showToast,
  getStartOfWeek,
  getBiweeklyWeeks,
  formatNameLastFirst,
  calculateEstimatedTaxes,
  calculatePayWithOvertime,
  downloadCsv,
  SYSTEM_AUTO_SWEEP_LABEL,
  AUTO_SWEEP_CLEARED_ACTION,
  buildAutoSweepClearedRow,
} from './utils.js';

// Role hierarchy: what each role can access
const MANAGEMENT_ROLES = [
  'Admin',
  'Site Manager',
  'Assistant Site Manager',
  'Manager',
  'Supervisor',
  'Payroll',
];
const ROLE_ACCESS = {
  Admin: {
    payroll: true,
    schedule: true,
    scheduleEdit: true,
    employee: true,
    ops: true,
    settings: true,
    dashboard: true,
    addEmployee: true,
  },
  Manager: {
    payroll: true,
    schedule: true,
    scheduleEdit: true,
    employee: true,
    ops: true,
    settings: true,
    dashboard: true,
    addEmployee: true,
  },
  'Site Manager': {
    payroll: false,
    schedule: true,
    scheduleEdit: true,
    employee: true,
    ops: true,
    settings: true,
    dashboard: true,
    addEmployee: true,
  },
  'Assistant Site Manager': {
    payroll: false,
    schedule: true,
    scheduleEdit: false,
    employee: true,
    ops: true,
    settings: true,
    dashboard: true,
    addEmployee: true,
  },
  Supervisor: {
    payroll: false,
    schedule: true,
    scheduleEdit: false,
    employee: true,
    ops: true,
    settings: true,
    dashboard: true,
    addEmployee: true,
  },
  Payroll: {
    payroll: true,
    schedule: false,
    scheduleEdit: false,
    employee: false,
    ops: false,
    settings: false,
    dashboard: true,
    addEmployee: false,
  },
};

// Modals defined inside #view-manager stay hidden if opened while another view
// (e.g. the timesheet view) is active, because their ancestor view is display:none.
// Relocating them to <body> lets them render on top regardless of the active view.
function ensureModalTopLevel(el) {
  if (el && el.parentElement !== document.body) document.body.appendChild(el);
}

// Show the manager-password field only when a leadership (non-Employee) role is selected
// in the employee-details editor.
function toggleEditEmployeePassword() {
  const roleEl = document.getElementById('edit-employee-role');
  const wrap = document.getElementById('edit-employee-password-wrap');
  if (!wrap) return;
  const isLeadership = !!(roleEl && roleEl.value && roleEl.value !== 'Employee');
  wrap.classList.toggle('hidden', !isLeadership);
}

function applyRolePermissions(role) {
  const p = ROLE_ACCESS[role] ?? {};
  const hide = (id) => document.getElementById(id)?.classList.add('hidden');
  const show = (id) => document.getElementById(id)?.classList.remove('hidden');

  if (p.payroll) show('nav-payroll');
  else hide('nav-payroll');
  if (p.schedule) show('nav-schedule');
  else hide('nav-schedule');
  if (p.employee) show('nav-employee');
  else hide('nav-employee');
  if (p.ops) show('nav-ops');
  else hide('nav-ops');
  if (p.settings) show('nav-settings');
  else hide('nav-settings');

  // Show/hide add-employee button inside the dashboard
  const btnShowCreateUser = document.getElementById('btn-show-create-user');
  if (btnShowCreateUser) {
    if (p.addEmployee) btnShowCreateUser.style.display = '';
    else btnShowCreateUser.style.display = 'none';
  }

  // Show/hide the Edit Employees card (details/role management)
  const btnShowEditEmployees = document.getElementById('btn-show-edit-employees');
  if (btnShowEditEmployees) btnShowEditEmployees.style.display = p.employee ? '' : 'none';

  // Show/hide the Payroll card — gated the same as the payroll nav tab
  const btnShowPayroll = document.getElementById('btn-show-payroll');
  if (btnShowPayroll) btnShowPayroll.style.display = p.payroll ? '' : 'none';

  // Schedule post/edit controls
  const btnShowPostSchedule = document.getElementById('btn-show-post-schedule');
  if (btnShowPostSchedule) {
    if (p.scheduleEdit) btnShowPostSchedule.classList.remove('hidden');
    else btnShowPostSchedule.classList.add('hidden');
  }
  const btnScheduleManagerLogin = document.getElementById('btn-schedule-manager-login');
  if (btnScheduleManagerLogin) btnScheduleManagerLogin.classList.add('hidden');

  if (role === 'Admin') show('manager-commission-settings');
  else hide('manager-commission-settings');
}

function resetRolePermissions() {
  // Restore all nav items to visible (pre-login state)
  ['nav-payroll', 'nav-schedule', 'nav-employee', 'nav-ops', 'nav-settings'].forEach((id) => {
    document.getElementById(id)?.classList.remove('hidden');
  });
  document.getElementById('btn-show-post-schedule')?.classList.add('hidden');
  document.getElementById('btn-schedule-manager-login')?.classList.remove('hidden');
  document.getElementById('manager-commission-settings')?.classList.add('hidden');
}

// --- Manager Authentication ---
export function completeManagerLogin(data) {
  state.managerLoggedIn = true;
  state.currentManager = data;
  state.currentManagerRole = data.role;

  applyRolePermissions(data.role);

  const p = ROLE_ACCESS[data.role] ?? {};

  if (state.pendingLoginTarget === 'payroll' && p.payroll) {
    const payrollAuth = document.getElementById('payroll-auth');
    const payrollDashboard = document.getElementById('payroll-dashboard');
    const payrollUsernameInput = document.getElementById('payroll-username-input');
    const payrollPasswordInput = document.getElementById('payroll-password-input');
    if (payrollAuth) payrollAuth.classList.add('hidden');
    if (payrollDashboard) payrollDashboard.classList.remove('hidden');
    if (payrollUsernameInput) payrollUsernameInput.value = '';
    if (payrollPasswordInput) payrollPasswordInput.value = '';
  } else {
    const managerAuth = document.getElementById('manager-auth');
    const managerDashboard = document.getElementById('manager-dashboard');
    const managerUsernameInput = document.getElementById('manager-username-input');
    const managerPasswordInput = document.getElementById('manager-password-input');
    if (managerAuth) managerAuth.classList.add('hidden');
    if (managerDashboard) managerDashboard.classList.remove('hidden');
    if (managerUsernameInput) managerUsernameInput.value = '';
    if (managerPasswordInput) managerPasswordInput.value = '';
  }
  loadTimesheets();
}

// PIN-based role unlock — called from timeclock after a management-role PIN is entered
export function unlockManagerByPin(userData) {
  state.managerLoggedIn = true;
  state.currentManager = userData;
  state.currentManagerRole = userData.role;
  applyRolePermissions(userData.role);

  const managerAuth = document.getElementById('manager-auth');
  const managerDashboard = document.getElementById('manager-dashboard');
  if (managerAuth) managerAuth.classList.add('hidden');
  if (managerDashboard) managerDashboard.classList.remove('hidden');
}

export function logoutManager() {
  state.managerLoggedIn = false;
  state.currentManager = null;
  state.currentManagerRole = null;
  state.pending2FAUser = null;

  resetRolePermissions();
  document.getElementById('post-schedule-section')?.classList.add('hidden');
  document.getElementById('schedule-manager-auth')?.classList.add('hidden');
  document.getElementById('manager-dashboard')?.classList.add('hidden');
  document.getElementById('manager-auth')?.classList.remove('hidden');
  document.getElementById('manager-username-input') &&
    (document.getElementById('manager-username-input').value = '');
  document.getElementById('manager-password-input') &&
    (document.getElementById('manager-password-input').value = '');
  document.getElementById('modal-create-user')?.classList.add('hidden');
}

async function attemptManagerLogin(username, password) {
  const { data: rawData, error } = await window.supabaseClient
    .from('users')
    .select('id, name, role, is_approved, two_factor_enabled, two_factor_pin')
    .eq('name', username)
    .eq('password', password)
    .in('role', MANAGEMENT_ROLES)
    .eq('is_approved', true)
    .not('password', 'is', null)
    .limit(1);

  if (error || !rawData || rawData.length === 0) {
    showToast('Invalid credentials', 'error');
    return null;
  }
  return rawData[0];
}

// --- Check and Send Payday Notification ---
async function checkAndSendPaydayNotification() {
  try {
    const today = new Date();
    // Payday is always on a Friday (0=Sun, 5=Fri)
    if (today.getDay() !== 5) return;

    // Calculate biweekly weeks to verify if today is the payday Friday of the cycle
    const { week2Start } = getBiweeklyWeeks(today);
    // Cycle ends the second Tuesday (week2Start + 6 days). Payday is the Friday after (week2Start + 9 days).
    const payday = new Date(week2Start.getTime() + 9 * 24 * 60 * 60 * 1000);
    payday.setHours(0, 0, 0, 0);

    const todayStart = new Date(today);
    todayStart.setHours(0, 0, 0, 0);

    if (todayStart.getTime() !== payday.getTime()) return;

    // Today is payday! Check if we've already sent a payday notification today
    const dateStr = todayStart.toLocaleDateString('en-CA'); // YYYY-MM-DD
    const { data: sentBefore, error: checkErr } = await window.supabaseClient
      .from('notifications_sent')
      .select('id')
      .eq('notification_type', 'payday_broadcast')
      .eq('shift_date', dateStr)
      .limit(1);

    if (checkErr) throw checkErr;
    if (sentBefore && sentBefore.length > 0) return; // Already sent today

    // Record that we are sending the notification (inserts into notifications_sent)
    const { error: insertErr } = await window.supabaseClient.from('notifications_sent').insert([
      {
        user_id: state.currentManager?.id || '00000000-0000-0000-0000-000000000000',
        notification_type: 'payday_broadcast',
        shift_date: dateStr,
      },
    ]);

    if (insertErr) throw insertErr;

    // Fetch all users with push tokens to notify
    const { data: users, error: userErr } = await window.supabaseClient
      .from('users')
      .select('push_token')
      .not('push_token', 'is', null);

    if (!userErr && users && users.length > 0) {
      const tokens = users.map((u) => u.push_token).filter(Boolean);
      if (tokens.length > 0) {
        const messages = tokens.map((token) => ({
          to: token,
          sound: 'default',
          title: 'Payday! 💰',
          body: 'Direct deposits are being processed today. Thank you for your hard work!',
        }));

        await fetch('https://exp.host/--/api/v2/push/send', {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Accept-encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(messages),
        });
        console.log(`Sent payday notifications to ${tokens.length} employees.`);
      }
    }
  } catch (err) {
    console.error('Failed to process payday notification:', err);
  }
}

// --- Load Timesheets (main data fetch) ---
export async function loadTimesheets() {
  const timesheetGrid = document.getElementById('timesheet-grid');
  if (!timesheetGrid) return;
  timesheetGrid.innerHTML =
    '<p style="text-align:center;color:var(--text-muted);padding:20px;">Loading timesheets...</p>';

  try {
    const startOfWeek = getStartOfWeek().getTime();
    const startOfLastWeek = startOfWeek - 7 * 24 * 60 * 60 * 1000;
    const startOf2WeeksAgo = startOfWeek - 14 * 24 * 60 * 60 * 1000;
    const startOf3WeeksAgo = startOfWeek - 21 * 24 * 60 * 60 * 1000;
    const startOf4WeeksAgo = startOfWeek - 28 * 24 * 60 * 60 * 1000;

    const [usersRes, logsRes, salesRes] = await Promise.all([
      window.supabaseClient
        .from('users')
        .select('id, name, payroll_name, pay_rate, is_salary, tax_status, role, is_approved, avatar'),
      window.supabaseClient
        .from('time_logs')
        .select('user_id, action, created_at')
        .order('created_at', { ascending: true }),
      window.supabaseClient
        .from('sales')
        .select('employee_id, sale_type, item_description, created_at')
        .gte('created_at', new Date(startOf4WeeksAgo).toISOString())
    ]);

    const usersData = usersRes.data;
    const logsData = logsRes.data;
    const salesData = salesRes.data;
    const usersError = usersRes.error;
    const logsError = logsRes.error;
    const salesError = salesRes.error;

    if (usersError || logsError || salesError) throw new Error('Failed to fetch timesheet/sales data');

    const { week1Start, week2Start } = getBiweeklyWeeks(new Date());
    const biweeklyW1 = week1Start.getTime();
    const biweeklyW2 = week2Start.getTime();
    const biweeklyNextW = biweeklyW2 + 7 * 24 * 60 * 60 * 1000;

    const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
    const w1Range = `${fmt(week1Start)} - ${fmt(new Date(biweeklyW2 - 86400000))}`;
    const w2Range = `${fmt(week2Start)} - ${fmt(new Date(biweeklyNextW - 86400000))}`;

    const headerW1 = document.getElementById('biweekly-header-w1');
    const headerW2 = document.getElementById('biweekly-header-w2');
    if (headerW1) headerW1.textContent = `Week 1 (${w1Range}) (Hrs)`;
    if (headerW2) headerW2.textContent = `Week 2 (${w2Range}) (Hrs)`;

    state.employeeMap = {};
    usersData.forEach((u) => {
      state.employeeMap[u.id] = {
        id: u.id,
        name: u.name,
        payroll_name: u.payroll_name,
        pay_rate: u.pay_rate || 0,
        is_salary: u.is_salary || false,
        tax_status: u.tax_status || 'Single',
        avatar: u.avatar || null,
        role: u.role || 'Employee',
        weekMs: [0, 0, 0, 0, 0, 0, 0],
        lastWeekMs: 0,
        week2Ms: 0,
        week3Ms: 0,
        week4Ms: 0,
        biweeklyWeek1Ms: 0,
        biweeklyWeek2Ms: 0,
        commThisWeek: 0,
        commLastWeek: 0,
        commWeek2: 0,
        commWeek3: 0,
        commWeek4: 0,
        commBiweeklyWeek1: 0,
        commBiweeklyWeek2: 0,
        currentStatus: 'OUT',
        lastIn: null,
      };
    });

    const getCommAmount = (sale) => {
      const desc = (sale.item_description || '').toLowerCase();
      const singleGood = state.comm_single_good !== undefined ? state.comm_single_good : 50;
      const singleBetter = state.comm_single_better !== undefined ? state.comm_single_better : 100;
      const singleBest = state.comm_single_best !== undefined ? state.comm_single_best : 150;
      const membershipGood = state.comm_membership_good !== undefined ? state.comm_membership_good : 200;
      const membershipBetter = state.comm_membership_better !== undefined ? state.comm_membership_better : 300;
      const membershipBest = state.comm_membership_best !== undefined ? state.comm_membership_best : 400;

      if (sale.sale_type === 'wash') {
        if (desc.includes('express')) return singleGood;
        if (desc.includes('deluxe')) return singleBetter;
        if (desc.includes('premium')) return singleBest;
        return singleGood; // fallback
      } else if (sale.sale_type === 'membership') {
        if (desc.includes('express')) return membershipGood;
        if (desc.includes('deluxe')) return membershipBetter;
        if (desc.includes('premium')) return membershipBest;
        return membershipGood; // fallback
      }
      return 0;
    };

    if (!salesError && salesData) {
      salesData.forEach((s) => {
        const emp = state.employeeMap[s.employee_id];
        if (!emp) return;

        const t = new Date(s.created_at).getTime();
        const amt = getCommAmount(s) / 100; // in dollars

        if (t >= startOfWeek) {
          emp.commThisWeek += amt;
        } else if (t >= startOfLastWeek) {
          emp.commLastWeek += amt;
        } else if (t >= startOf2WeeksAgo) {
          emp.commWeek2 += amt;
        } else if (t >= startOf3WeeksAgo) {
          emp.commWeek3 += amt;
        } else if (t >= startOf4WeeksAgo) {
          emp.commWeek4 += amt;
        }

        if (t >= biweeklyW1 && t < biweeklyW2) {
          emp.commBiweeklyWeek1 += amt;
        } else if (t >= biweeklyW2 && t < biweeklyNextW) {
          emp.commBiweeklyWeek2 += amt;
        }
      });
    }

    // 30-day purge in background
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    window.supabaseClient
      .from('time_logs')
      .delete()
      .lt('created_at', thirtyDaysAgo.toISOString())
      .then(({ error }) => {
        if (error) console.error('Purge error', error);
      });

    logsData.forEach((log) => {
      const emp = state.employeeMap[log.user_id];
      if (!emp) return;
      const time = new Date(log.created_at).getTime();

      if (log.action === 'IN' || log.action === 'END_LUNCH' || log.action === 'CLOCK_IN') {
        emp.currentStatus = 'IN';
        emp.lastIn = time;
      } else if (
        log.action === 'OUT' ||
        log.action === 'START_LUNCH' ||
        log.action === 'CLOCK_OUT'
      ) {
        if (emp.currentStatus === 'IN' && emp.lastIn) {
          const d = time - emp.lastIn;
          if (emp.lastIn >= startOfWeek) {
            emp.weekMs[(new Date(emp.lastIn).getDay() + 4) % 7] += d;
          } else if (emp.lastIn >= startOfLastWeek) {
            emp.lastWeekMs += d;
          } else if (emp.lastIn >= startOf2WeeksAgo) {
            emp.week2Ms += d;
          } else if (emp.lastIn >= startOf3WeeksAgo) {
            emp.week3Ms += d;
          } else if (emp.lastIn >= startOf4WeeksAgo) {
            emp.week4Ms += d;
          } else if (time >= startOfWeek) {
            emp.weekMs[0] += time - startOfWeek;
          }
          if (emp.lastIn >= biweeklyW1 && emp.lastIn < biweeklyW2) emp.biweeklyWeek1Ms += d;
          else if (emp.lastIn >= biweeklyW2 && emp.lastIn < biweeklyNextW) emp.biweeklyWeek2Ms += d;
        }
        emp.currentStatus = log.action === 'START_LUNCH' ? 'LUNCH' : 'OUT';
        emp.lastIn = null;
      }
    });

    const timesheetGrid = document.getElementById('timesheet-grid');
    const biweeklyHistoryBody = document.getElementById('biweekly-history-body-payroll');
    const monthlyArchiveBody = document.getElementById('monthly-archive-body-payroll');

    if (timesheetGrid) timesheetGrid.innerHTML = '';
    if (biweeklyHistoryBody) biweeklyHistoryBody.innerHTML = '';
    if (monthlyArchiveBody) monthlyArchiveBody.innerHTML = '';

    // Structured rows for CSV export (decoupled from DOM layout)
    state.weeklyTimesheetRows = [];

    let overtimeCount = 0;
    let pendingCount = 0;

    Object.values(state.employeeMap).forEach((emp) => {
      if (emp.currentStatus === 'IN' && emp.lastIn) {
        const activeMs = Date.now() - emp.lastIn;
        if (emp.lastIn >= startOfWeek) {
          emp.weekMs[(new Date(emp.lastIn).getDay() + 4) % 7] += activeMs;
        } else if (emp.lastIn >= startOfLastWeek) {
          emp.lastWeekMs += activeMs;
        } else if (emp.lastIn >= startOf2WeeksAgo) {
          emp.week2Ms += activeMs;
        } else if (emp.lastIn >= startOf3WeeksAgo) {
          emp.week3Ms += activeMs;
        } else if (emp.lastIn >= startOf4WeeksAgo) {
          emp.week4Ms += activeMs;
        } else {
          emp.weekMs[0] += Date.now() - startOfWeek;
        }
        if (emp.lastIn >= biweeklyW1 && emp.lastIn < biweeklyW2) emp.biweeklyWeek1Ms += activeMs;
        else if (emp.lastIn >= biweeklyW2 && emp.lastIn < biweeklyNextW)
          emp.biweeklyWeek2Ms += activeMs;
      }

      const totalWeekMs = emp.weekMs.reduce((s, v) => s + v, 0);
      const totalWeekHrsVal = totalWeekMs / 3600000;
      const totalWeekHrs = totalWeekHrsVal.toFixed(2);
      const totalLastWeekHrs = (emp.lastWeekMs / 3600000).toFixed(2);

      let totalColor = 'var(--primary)';
      if (totalWeekHrsVal >= 40) {
        totalColor = 'var(--danger)';
        overtimeCount++;
      } else if (totalWeekHrsVal >= 36) {
        totalColor = 'var(--warning)';
        overtimeCount++;
      }

      const statusColors = { IN: 'var(--success)', LUNCH: 'var(--warning)', OUT: 'var(--danger)' };
      const statusColor = statusColors[emp.currentStatus] || 'var(--danger)';
      const displayName = emp.payroll_name || emp.name;
      const safeName = displayName.replace(/"/g, '&quot;');

      const weeklyPayVal = calculatePayWithOvertime([totalWeekHrsVal], emp.pay_rate);
      const estWeeklyPay = (emp.is_salary ? (emp.pay_rate / 2 + emp.commThisWeek) : (weeklyPayVal + emp.commThisWeek)).toFixed(2);
      const rateText = emp.is_salary
        ? `$${emp.pay_rate.toFixed(2)} (Salary)`
        : `$${emp.pay_rate.toFixed(2)}/hr`;
      const dayLetters = ['W', 'T', 'F', 'S', 'S', 'M', 'T'];
      const dayNames = ['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue'];
      const weekStrip = emp.weekMs
        .map((ms, i) => {
          const h = ms / 3600000;
          return `<div class="ts-day${h > 0 ? ' on' : ''}"><span class="dl">${dayLetters[i]}</span><span class="dv${h > 0 ? '' : ' zero'}" title="${dayNames[i]}">${h > 0 ? h.toFixed(1) : '–'}</span></div>`;
        })
        .join('');
      const otTag = totalWeekHrsVal >= 40 ? ' <span class="ts-ot">OT</span>' : '';
      const tsAvatar =
        emp.avatar ||
        "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23bbb'><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/></svg>";

      if (timesheetGrid) {
        const card = document.createElement('div');
        card.className = 'ts-card';
        card.dataset.id = emp.id;
        card.dataset.isSalary = emp.is_salary;
        card.dataset.payRate = emp.pay_rate;
        card.innerHTML = `
          <div class="ts-card-head">
            <div class="ts-who">
              <img class="avatar-circle" src="${tsAvatar}" alt="" />
              <span class="ts-name">${displayName}</span>
            </div>
            <span class="ts-pill" style="color:${statusColor};border-color:${statusColor};">${emp.currentStatus}</span>
          </div>
          <div class="ts-week">${weekStrip}</div>
          <div class="ts-summary">
            <div class="ts-stat"><span class="ts-big" style="color:${totalColor};">${totalWeekHrs}${otTag}</span><span class="ts-unit">Total hrs</span></div>
            <div class="ts-stat right"><span class="ts-big money">$${estWeeklyPay}${emp.is_salary ? ' <span class="ts-fixed">(Fixed)</span>' : ''}</span><span class="ts-unit">Est. pay</span></div>
          </div>
          <div class="ts-meta"><span>${rateText}</span><span>Comm: <b>$${emp.commThisWeek.toFixed(2)}</b></span><span>Last week <b>${totalLastWeekHrs}</b></span></div>
          <button class="btn-primary btn-manage-logs ts-manage" data-id="${emp.id}" data-name="${safeName}">Manage</button>
        `;
        timesheetGrid.appendChild(card);
      }

      state.weeklyTimesheetRows.push({
        name: displayName,
        status: emp.currentStatus,
        days: emp.weekMs.map((ms) => ms / 3600000),
        total: totalWeekHrsVal,
        rateText,
        commission: emp.commThisWeek,
        estGross: parseFloat(estWeeklyPay) || 0,
        taxStatus: emp.tax_status || 'Single',
        isSalary: !!emp.is_salary,
        lastWeek: parseFloat(totalLastWeekHrs) || 0,
      });

      if (biweeklyHistoryBody) {
        const w1Hrs = (emp.biweeklyWeek1Ms / 3600000).toFixed(2);
        const w2Hrs = (emp.biweeklyWeek2Ms / 3600000).toFixed(2);
        const biweeklyTotal = (Number(w1Hrs) + Number(w2Hrs)).toFixed(2);
        const biweeklyComm = emp.commBiweeklyWeek1 + emp.commBiweeklyWeek2;
        const biweeklyPay = (emp.is_salary
          ? emp.pay_rate + biweeklyComm
          : calculatePayWithOvertime([Number(w1Hrs), Number(w2Hrs)], emp.pay_rate) + biweeklyComm).toFixed(2);
        const trB = document.createElement('tr');
        trB.dataset.id = emp.id;
        trB.dataset.isSalary = emp.is_salary;
        trB.dataset.payRate = emp.pay_rate;
        trB.innerHTML = `
          <td>${displayName}</td>
          <td>${w1Hrs}</td><td>${w2Hrs}</td>
          <td style="font-weight:bold;color:var(--primary);">${biweeklyTotal}</td>
          <td style="font-weight:bold;color:var(--primary);">$${biweeklyComm.toFixed(2)}</td>
          <td style="font-weight:bold;color:var(--success);">$${biweeklyPay}${emp.is_salary ? ' <span style="font-size:0.7rem;color:var(--text-muted)">(Fixed)</span>' : ''}</td>
          <td><button class="btn-primary btn-manage-logs" data-id="${emp.id}" data-name="${safeName}" style="padding:5px 10px;font-size:0.8rem;cursor:pointer;border-radius:4px;border:none;">Manage</button></td>
        `;
        biweeklyHistoryBody.appendChild(trB);
      }

      if (monthlyArchiveBody) {
        const w2h = (emp.week2Ms / 3600000).toFixed(2);
        const w3h = (emp.week3Ms / 3600000).toFixed(2);
        const w4h = (emp.week4Ms / 3600000).toFixed(2);
        const monthlyTotal = (
          Number(totalWeekHrs) +
          Number(totalLastWeekHrs) +
          Number(w2h) +
          Number(w3h) +
          Number(w4h)
        ).toFixed(2);
        const monthlyComm = emp.commThisWeek + emp.commLastWeek + emp.commWeek2 + emp.commWeek3 + emp.commWeek4;
        const monthlyPay = (emp.is_salary
          ? emp.pay_rate + monthlyComm
          : calculatePayWithOvertime(
              [
                Number(totalWeekHrs),
                Number(totalLastWeekHrs),
                Number(w2h),
                Number(w3h),
                Number(w4h),
              ],
              emp.pay_rate,
            ) + monthlyComm).toFixed(2);
        const trM = document.createElement('tr');
        trM.dataset.id = emp.id;
        trM.dataset.isSalary = emp.is_salary;
        trM.dataset.payRate = emp.pay_rate;
        trM.innerHTML = `
          <td>${displayName}</td>
          <td>${w4h}</td><td>${w3h}</td><td>${w2h}</td><td>${totalLastWeekHrs}</td><td>${totalWeekHrs}</td>
          <td style="font-weight:bold;color:var(--primary);">${monthlyTotal}</td>
          <td style="font-weight:bold;color:var(--primary);">$${monthlyComm.toFixed(2)}</td>
          <td style="font-weight:bold;color:var(--success);">$${monthlyPay}${emp.is_salary ? ' <span style="font-size:0.7rem;color:var(--text-muted)">(Fixed)</span>' : ''}</td>
          <td><button class="btn-primary btn-manage-logs" data-id="${emp.id}" data-name="${safeName}" style="padding:5px 10px;font-size:0.8rem;cursor:pointer;border-radius:4px;border:none;">Manage</button></td>
        `;
        monthlyArchiveBody.appendChild(trM);
      }
    });

    // Overtime badge
    const otBadge = document.getElementById('overtime-badge');
    if (otBadge) {
      otBadge.textContent = overtimeCount;
      otBadge.classList.toggle('hidden', overtimeCount === 0);
    }

    // Pending approvals
    const pendingPinsBody = document.getElementById('pending-pins-body');
    const pendingPinsSection = document.getElementById('pending-pins-section');
    if (pendingPinsBody) {
      pendingPinsBody.innerHTML = '';
      let hasPending = false;

      usersData.forEach((u) => {
        if (u.is_approved === false) {
          hasPending = true;
          pendingCount++;
          const tr = document.createElement('tr');
          const avatarUrl =
            u.avatar ||
            "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23ccc'><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/></svg>";
          tr.innerHTML = `
            <td style="font-weight: bold; display: flex; align-items: center; justify-content: flex-start; gap: 10px;">
              <img src="${avatarUrl}" class="avatar-circle" />
              ${u.name}
            </td>
            <td>New Registration</td>
            <td>Role: ${u.role}</td>
            <td>
              <button class="btn btn-success btn-sm btn-approve-account" data-id="${u.id}">Approve</button>
              <button class="btn btn-danger btn-sm btn-reject-account" data-id="${u.id}">Reject</button>
            </td>
          `;
          pendingPinsBody.appendChild(tr);
        }
        if (u.pending_pin) {
          hasPending = true;
          pendingCount++;
          const tr = document.createElement('tr');
          const avatarUrl =
            u.avatar ||
            "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23ccc'><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/></svg>";
          tr.innerHTML = `
            <td style="font-weight: bold; display: flex; align-items: center; justify-content: flex-start; gap: 10px;">
              <img src="${avatarUrl}" class="avatar-circle" />
              ${u.name}
            </td>
            <td>PIN Change</td>
            <td>PIN: ${u.pending_pin}</td>
            <td>
              <button class="btn btn-success btn-sm btn-approve-pin" data-id="${u.id}" data-val="${u.pending_pin}">Approve</button>
              <button class="btn btn-danger btn-sm btn-reject-pin" data-id="${u.id}">Reject</button>
            </td>
          `;
          pendingPinsBody.appendChild(tr);
        }
        if (u.pending_password) {
          hasPending = true;
          pendingCount++;
          const tr = document.createElement('tr');
          const avatarUrl =
            u.avatar ||
            "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23ccc'><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/></svg>";
          tr.innerHTML = `
            <td style="font-weight: bold; display: flex; align-items: center; justify-content: flex-start; gap: 10px;">
              <img src="${avatarUrl}" class="avatar-circle" />
              ${u.name}
            </td>
            <td>Password Reset</td>
            <td>New Password requested</td>
            <td>
              <button class="btn btn-success btn-sm btn-approve-pwd" data-id="${u.id}" data-val="${u.pending_password}">Approve</button>
              <button class="btn btn-danger btn-sm btn-reject-pwd" data-id="${u.id}">Reject</button>
            </td>
          `;
          pendingPinsBody.appendChild(tr);
        }
      });
      if (pendingPinsSection) pendingPinsSection.classList.toggle('hidden', !hasPending);
    }

    // Time off requests
    const { data: timeoffData, error: timeoffError } = await window.supabaseClient
      .from('time_off_requests')
      .select('id, user_id, start_date, end_date, reason, status, created_at')
      .eq('status', 'Pending');
    const managerTimeoffBody = document.getElementById('manager-timeoff-body');
    const pendingTimeoffSection = document.getElementById('pending-timeoff-section');
    if (managerTimeoffBody) {
      managerTimeoffBody.innerHTML = '';
      if (!timeoffError && timeoffData && timeoffData.length > 0) {
        if (pendingTimeoffSection) pendingTimeoffSection.classList.remove('hidden');
        timeoffData.forEach((req) => {
          pendingCount++;
          const emp = state.employeeMap[req.user_id];
          const empName = emp ? emp.name : 'Unknown';
          const avatarUrl =
            (emp && emp.avatar) ||
            "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23ccc'><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/></svg>";
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td style="font-weight: bold; display: flex; align-items: center; justify-content: flex-start; gap: 10px;">
              <img src="${avatarUrl}" class="avatar-circle" />
              ${empName}
            </td>
            <td>${req.start_date} to ${req.end_date}</td>
            <td>${req.reason || 'No reason provided'}</td>
            <td>
              <button class="btn btn-success btn-sm btn-approve-timeoff" data-id="${req.id}">Approve</button>
              <button class="btn btn-danger btn-sm btn-deny-timeoff" data-id="${req.id}">Deny</button>
            </td>
          `;
          managerTimeoffBody.appendChild(tr);
        });
      } else {
        if (pendingTimeoffSection) pendingTimeoffSection.classList.add('hidden');
      }
    }

    // Early clock-in requests (today only)
    const todayLocal = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
    const { data: earlyRequests } = await window.supabaseClient
      .from('early_clockin_approvals')
      .select('id, employee_name, shift_start, requested_at')
      .eq('status', 'pending')
      .eq('shift_date', todayLocal);
    const earlyBody = document.getElementById('early-clockin-body');
    const earlySection = document.getElementById('pending-early-clockin-section');
    if (earlyBody) {
      earlyBody.innerHTML = '';
      if (earlyRequests && earlyRequests.length > 0) {
        earlyRequests.forEach((req) => {
          pendingCount++;
          const requestedAt = new Date(req.requested_at).toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            timeZone: 'America/Chicago',
          });
          const emp = Object.values(state.employeeMap).find((e) => e.name === req.employee_name);
          const avatarUrl =
            (emp && emp.avatar) ||
            "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23ccc'><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/></svg>";
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td style="font-weight: bold; display: flex; align-items: center; justify-content: flex-start; gap: 10px;">
              <img src="${avatarUrl}" class="avatar-circle" />
              ${req.employee_name}
            </td>
            <td>${req.shift_start}</td>
            <td>${requestedAt}</td>
            <td>
              <button class="btn btn-success btn-sm btn-approve-early" data-id="${req.id}">Approve</button>
              <button class="btn btn-danger btn-sm btn-deny-early" data-id="${req.id}">Deny</button>
            </td>
          `;
          earlyBody.appendChild(tr);
        });
        if (earlySection) earlySection.classList.remove('hidden');
      } else {
        if (earlySection) earlySection.classList.add('hidden');
      }
    }

    // Missed-punch requests
    const { data: missedRequests } = await window.supabaseClient
      .from('missed_punch_requests')
      .select('id, user_id, employee_name, action, punch_at, reason, requested_at')
      .eq('status', 'pending')
      .order('requested_at', { ascending: true });
    const missedBody = document.getElementById('missed-punch-body');
    const missedSection = document.getElementById('pending-missed-punch-section');
    const actionLabels = {
      IN: 'Clock In',
      OUT: 'Clock Out',
      START_LUNCH: 'Start Lunch',
      END_LUNCH: 'End Lunch',
    };
    if (missedBody) {
      missedBody.innerHTML = '';
      if (missedRequests && missedRequests.length > 0) {
        missedRequests.forEach((req) => {
          pendingCount++;
          const punchTime = new Date(req.punch_at).toLocaleString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            timeZone: 'America/Chicago',
          });
          const emp = Object.values(state.employeeMap).find((e) => e.name === req.employee_name);
          const avatarUrl =
            (emp && emp.avatar) ||
            "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23ccc'><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/></svg>";
          const reasonText = req.reason
            ? String(req.reason).replace(/</g, '&lt;').replace(/>/g, '&gt;')
            : '<span style="color: var(--text-muted);">—</span>';
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td style="font-weight: bold; display: flex; align-items: center; justify-content: flex-start; gap: 10px;">
              <img src="${avatarUrl}" class="avatar-circle" />
              ${req.employee_name}
            </td>
            <td>${actionLabels[req.action] || req.action}</td>
            <td>${punchTime}</td>
            <td style="max-width: 220px;">${reasonText}</td>
            <td>
              <button class="btn btn-success btn-sm btn-approve-missed" data-id="${req.id}"
                data-user="${req.user_id}" data-action="${req.action}" data-time="${req.punch_at}">Approve</button>
              <button class="btn btn-danger btn-sm btn-deny-missed" data-id="${req.id}">Deny</button>
            </td>
          `;
          missedBody.appendChild(tr);
        });
        if (missedSection) missedSection.classList.remove('hidden');
      } else {
        if (missedSection) missedSection.classList.add('hidden');
      }
    }

    // Shift swap requests
    const { data: swapData } = await window.supabaseClient
      .from('shift_swaps')
      .select('id, original_user_id, target_user_id, week_range, details, created_at')
      .eq('status', 'Pending')
      .order('created_at', { ascending: true });
    const swapBody = document.getElementById('shift-swap-body');
    const swapSection = document.getElementById('pending-shift-swap-section');
    if (swapBody) {
      swapBody.innerHTML = '';
      if (swapData && swapData.length > 0) {
        swapData.forEach((req) => {
          pendingCount++;
          const origEmp = state.employeeMap[req.original_user_id];
          const origName = origEmp ? origEmp.name : 'Unknown';
          const targetEmp = req.target_user_id ? state.employeeMap[req.target_user_id] : null;
          const targetName = targetEmp ? targetEmp.name : '—';
          const avatarUrl =
            (origEmp && origEmp.avatar) ||
            "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23ccc'><path d='M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z'/></svg>";
          const detailsText = req.details
            ? String(req.details).replace(/</g, '&lt;').replace(/>/g, '&gt;')
            : '<span style="color: var(--text-muted);">—</span>';
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td style="font-weight: bold; display: flex; align-items: center; justify-content: flex-start; gap: 10px;">
              <img src="${avatarUrl}" class="avatar-circle" />
              ${origName}
            </td>
            <td>${targetName}</td>
            <td>${req.week_range || '—'}</td>
            <td style="max-width: 220px;">${detailsText}</td>
            <td>
              <button class="btn btn-success btn-sm btn-approve-swap" data-id="${req.id}"
                data-orig="${req.original_user_id || ''}" data-target="${req.target_user_id || ''}">Approve</button>
              <button class="btn btn-danger btn-sm btn-deny-swap" data-id="${req.id}"
                data-orig="${req.original_user_id || ''}" data-target="${req.target_user_id || ''}">Deny</button>
            </td>
          `;
          swapBody.appendChild(tr);
        });
        if (swapSection) swapSection.classList.remove('hidden');
      } else {
        if (swapSection) swapSection.classList.add('hidden');
      }
    }

    // Approval badge
    const badge = document.getElementById('approval-badge');
    if (badge) {
      badge.textContent = pendingCount;
      badge.classList.toggle('hidden', pendingCount === 0);
    }

    // Wire CSV exports
    wireExportButtons(w1Range, w2Range);

    // Analytics
    const { calculateAnalytics, initCharts } = await import('./analytics.js');
    const analyticsSection = document.getElementById('manager-analytics-section');
    if (analyticsSection) {
      calculateAnalytics();
      if (!analyticsSection.classList.contains('hidden')) initCharts();
    }

    // Trigger payday push notification check
    checkAndSendPaydayNotification();
  } catch (err) {
    showToast('Error: ' + (err.message || 'Failed to load timesheets'), 'error');
  }
}

function wireExportButtons(w1Range, w2Range) {
  // Weekly CSV
  const btnExportCsv = document.getElementById('btn-export-csv');
  if (btnExportCsv) {
    const fresh = btnExportCsv.cloneNode(true);
    btnExportCsv.parentNode.replaceChild(fresh, btnExportCsv);
    fresh.addEventListener('click', () => exportWeeklyCsv());
  }
  // Biweekly CSV
  const btnExportBiweekly = document.getElementById('btn-export-biweekly');
  if (btnExportBiweekly) {
    const fresh = btnExportBiweekly.cloneNode(true);
    btnExportBiweekly.parentNode.replaceChild(fresh, btnExportBiweekly);
    fresh.addEventListener('click', () => exportBiweeklyCsv(w1Range, w2Range));
  }
  // Monthly CSV
  const btnExportMonthly = document.getElementById('btn-export-monthly');
  if (btnExportMonthly) {
    const fresh = btnExportMonthly.cloneNode(true);
    btnExportMonthly.parentNode.replaceChild(fresh, btnExportMonthly);
    fresh.addEventListener('click', () => exportMonthlyCsv());
  }
}

function exportWeeklyCsv() {
  const rows = state.weeklyTimesheetRows || [];
  if (rows.length === 0) {
    showToast('No data to export', 'warning');
    return;
  }
  let csv =
    '#,Employee,Status,Wed,Thu,Fri,Sat,Sun,Mon,Tue,Total This Week,Rate,Commission ($),Est. Weekly Gross ($),Tax Status,Est. Taxes ($),Est. Net Pay ($),Last Week Total\n';
  let count = 1;
  rows.forEach((r) => {
    if (r.total === 0 && !r.isSalary) return;
    const estTaxes = calculateEstimatedTaxes(r.estGross, r.taxStatus, r.isSalary, 52);
    const estNet = Math.max(0, r.estGross - estTaxes);
    const cells = [
      formatNameLastFirst(r.name),
      r.status,
      ...r.days.map((h) => (h > 0 ? h.toFixed(2) : '0')),
      r.total.toFixed(2),
      r.rateText,
      (r.commission || 0).toFixed(2),
      r.estGross.toFixed(2),
      r.taxStatus,
      estTaxes.toFixed(2),
      estNet.toFixed(2),
      r.lastWeek.toFixed(2),
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
    csv += `"${count++}",${cells.join(',')}\n`;
  });
  downloadCsv(csv, `Payroll_Export_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`);
  showToast('Payroll CSV Downloaded!');
}

function exportBiweeklyCsv(w1Range, w2Range) {
  const rows = document.querySelectorAll('#biweekly-history-body-payroll tr');
  if (rows.length === 0) {
    showToast('No data to export', 'warning');
    return;
  }
  let csv = `#,Employee,Week 1 (${w1Range}) (Hrs),Week 2 (${w2Range}) (Hrs),Biweekly Total (Hrs),Commission ($),Type,Rate/Salary,Est. Gross Pay ($),Tax Status,Est. Taxes ($),Est. Net Pay ($)\n`;
  let count = 1;
  rows.forEach((row) => {
    const cols = row.querySelectorAll('td');
    if (cols.length < 5) return;
    const empId = row.dataset.id;
    const emp = state.employeeMap[empId];
    const isSalary = row.dataset.isSalary === 'true' || (emp && emp.is_salary) || false;
    const payRate = parseFloat(row.dataset.payRate) || (emp ? emp.pay_rate : 0);
    const biweeklyTotal = parseFloat(cols[3].textContent.trim()) || 0;
    if (biweeklyTotal === 0 && !isSalary) return;

    const commission = parseFloat(cols[4] ? cols[4].textContent.replace(/[^0-9.-]/g, '') : '0') || 0;
    const estGross = parseFloat(cols[5] ? cols[5].textContent.replace(/[^0-9.-]/g, '') : '0') || 0;
    const taxStatus = emp ? emp.tax_status || 'Single' : 'Single';
    const estTaxes = calculateEstimatedTaxes(estGross, taxStatus, isSalary, 26);
    const estNet = Math.max(0, estGross - estTaxes);

    let rowData = [`"${count++}"`];
    for (let i = 0; i < 4; i++) {
      let text = cols[i].textContent.replace(/[\r\n]+/g, '').trim();
      if (i === 0) text = formatNameLastFirst(text);
      rowData.push(`"${text.replace(/"/g, '""')}"`);
    }
    rowData.push(
      `"${commission.toFixed(2)}"`,
      `"${isSalary ? 'Salary' : 'Hourly'}"`,
      `"${payRate}"`,
      `"${estGross.toFixed(2)}"`,
      `"${taxStatus}"`,
      `"${estTaxes.toFixed(2)}"`,
      `"${estNet.toFixed(2)}"`,
    );
    csv += rowData.join(',') + '\n';
  });
  downloadCsv(
    csv,
    `Biweekly_Payroll_Export_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`,
  );
  showToast('Biweekly CSV Downloaded!');
}

function exportMonthlyCsv() {
  const rows = document.querySelectorAll('#monthly-archive-body-payroll tr');
  if (rows.length === 0) {
    showToast('No data to export', 'warning');
    return;
  }
  let csv =
    '#,Employee,4 Weeks Ago,3 Weeks Ago,2 Weeks Ago,Last Week,This Week,Monthly Total (Hrs),Commission ($),Type,Rate/Salary,Est. Gross Pay ($),Tax Status,Est. Taxes ($),Est. Net Pay ($)\n';
  let count = 1;
  rows.forEach((row) => {
    const cols = row.querySelectorAll('td');
    if (cols.length < 8) return;
    const empId = row.dataset.id;
    const emp = state.employeeMap[empId];
    const isSalary = row.dataset.isSalary === 'true' || (emp && emp.is_salary) || false;
    const payRate = parseFloat(row.dataset.payRate) || (emp ? emp.pay_rate : 0);
    const monthlyTotal = parseFloat(cols[6].textContent.trim()) || 0;
    if (monthlyTotal === 0 && !isSalary) return;

    const commission = parseFloat(cols[7] ? cols[7].textContent.replace(/[^0-9.-]/g, '') : '0') || 0;
    const estGross = parseFloat(cols[8] ? cols[8].textContent.replace(/[^0-9.-]/g, '') : '0') || 0;
    const taxStatus = emp ? emp.tax_status || 'Single' : 'Single';
    const estTaxes = calculateEstimatedTaxes(estGross, taxStatus, isSalary, 12);
    const estNet = Math.max(0, estGross - estTaxes);

    let rowData = [`"${count++}"`];
    for (let i = 0; i < 7; i++) {
      let text = cols[i].textContent.replace(/[\r\n]+/g, '').trim();
      if (i === 0) text = formatNameLastFirst(text);
      rowData.push(`"${text.replace(/"/g, '""')}"`);
    }
    rowData.push(
      `"${commission.toFixed(2)}"`,
      `"${isSalary ? 'Salary' : 'Hourly'}"`,
      `"${payRate}"`,
      `"${estGross.toFixed(2)}"`,
      `"${taxStatus}"`,
      `"${estTaxes.toFixed(2)}"`,
      `"${estNet.toFixed(2)}"`,
    );
    csv += rowData.join(',') + '\n';
  });
  downloadCsv(
    csv,
    `Monthly_Payroll_Export_${new Date().toLocaleDateString().replace(/\//g, '-')}.csv`,
  );
  showToast('Monthly CSV Downloaded!');
}

// --- Manage Logs Modal ---
async function insertAutoSweepClearedMarker(deletedOut) {
  const IN_LIKE = ['IN', 'CLOCK_IN', 'END_LUNCH', 'START_LUNCH'];
  const sweepDate = new Date(deletedOut.created_at);
  const windowStart = new Date(sweepDate.getTime() - 20 * 3600000).toISOString();
  const windowEnd = new Date(sweepDate.getTime() + 20 * 3600000).toISOString();

  const { data: ins } = await window.supabaseClient
    .from('time_logs')
    .select('created_at')
    .eq('user_id', deletedOut.user_id)
    .in('action', IN_LIKE)
    .gte('created_at', windowStart)
    .lte('created_at', windowEnd)
    .order('created_at', { ascending: false })
    .limit(1);

  const inAt = ins?.[0]?.created_at || deletedOut.created_at;
  await window.supabaseClient
    .from('time_logs')
    .insert(buildAutoSweepClearedRow(deletedOut.user_id, inAt));
}

async function loadEmployeeLogs() {
  const manageLogsBody = document.getElementById('manage-logs-body');
  if (!state.selectedEmployeeForLogs || !manageLogsBody) return;
  try {
    const { data, error } = await window.supabaseClient
      .from('time_logs')
      .select('id, user_id, action, created_at, edited_by_manager, photo_base64')
      .eq('user_id', state.selectedEmployeeForLogs)
      .order('created_at', { ascending: false });
    if (error) throw error;

    manageLogsBody.innerHTML = '';
    data
      .filter((log) => log.action !== AUTO_SWEEP_CLEARED_ACTION)
      .forEach((log) => {
      const time = new Date(log.created_at).toLocaleString('en-US', {
        timeZone: 'America/Chicago',
      });
      const colors = {
        IN: 'var(--success)',
        CLOCK_IN: 'var(--success)',
        OUT: 'var(--danger)',
        CLOCK_OUT: 'var(--danger)',
        START_LUNCH: 'var(--warning)',
        END_LUNCH: 'var(--primary)',
        TIMESHEET_APPROVED: '#00BCD4',
      };
      const color = colors[log.action] || 'var(--text)';
      const editedBy = log.edited_by_manager
        ? `<span style="font-size:0.8rem;color:var(--warning);">[Edited] ${log.edited_by_manager}</span>`
        : '-';

      const tr = document.createElement('tr');
      if (log.photo_base64) {
        const img = document.createElement('img');
        img.src = log.photo_base64;
        img.dataset.fullPhoto = 'true';
        img.style.cssText =
          'width:40px;height:40px;border-radius:5px;object-fit:cover;cursor:pointer;border:1px solid var(--border);';
        img.title = 'Click to view full photo';
        const photoTd = document.createElement('td');
        photoTd.appendChild(img);
        tr.appendChild(photoTd);
      } else {
        const photoTd = document.createElement('td');
        photoTd.innerHTML =
          '<span style="color:var(--text-muted);font-size:0.8rem;">No Photo</span>';
        tr.appendChild(photoTd);
      }

      const restHtml = `
        <td><span style="color:${color};font-weight:bold;">${log.action.replace('_', ' ')}</span></td>
        <td>${time}</td>
        <td>${editedBy}</td>
        <td style="display:flex;gap:5px;">
          <button class="btn-edit-log btn-ghost" data-id="${log.id}" data-action="${log.action}" data-time="${log.created_at}"
            style="padding:5px 10px;border-radius:4px;border:1px solid var(--border);font-size:0.8rem;cursor:pointer;">Edit</button>
          <button class="btn-danger btn-delete-log" data-id="${log.id}"
            style="padding:5px 10px;font-size:0.8rem;border:none;cursor:pointer;border-radius:4px;">Delete</button>
        </td>`;
      tr.insertAdjacentHTML('beforeend', restHtml);
      manageLogsBody.appendChild(tr);
    });
  } catch (err) {
    showToast('Failed to load employee logs: ' + (err.message || ''), 'error');
  }
}

// --- Module Init ---
export function init() {
  // Manager login
  const btnManagerLogin = document.getElementById('btn-manager-login');
  if (btnManagerLogin) {
    btnManagerLogin.addEventListener('click', async () => {
      const username = document.getElementById('manager-username-input')?.value.trim();
      const password = document.getElementById('manager-password-input')?.value;
      if (!username || !password) return;

      try {
        const data = await attemptManagerLogin(username, password);
        if (!data) return;

        if (data.two_factor_enabled) {
          state.pending2FAUser = data;
          const modal2FA = document.getElementById('modal-2fa-verify');
          const verify2FAPin = document.getElementById('verify-2fa-pin');
          if (modal2FA) modal2FA.classList.remove('hidden');
          if (verify2FAPin) {
            verify2FAPin.value = '';
            verify2FAPin.focus();
          }
          return;
        }

        // Save remember-me only after successful auth
        const rememberMe = document.getElementById('manager-remember-me');
        if (rememberMe && rememberMe.checked) {
          localStorage.setItem('managerRememberUser', username);
          localStorage.setItem('managerRememberPass', password);
        } else {
          localStorage.removeItem('managerRememberUser');
          localStorage.removeItem('managerRememberPass');
        }

        completeManagerLogin(data);
      } catch (err) {
        showToast('Error during login. Check your connection.', 'error');
      }
    });
  }

  // Payroll login
  const btnPayrollLogin = document.getElementById('btn-payroll-login');
  if (btnPayrollLogin) {
    btnPayrollLogin.addEventListener('click', async () => {
      const username = document.getElementById('payroll-username-input')?.value.trim();
      const password = document.getElementById('payroll-password-input')?.value;
      if (!username || !password) return;
      try {
        const data = await attemptManagerLogin(username, password);
        if (!data) return;
        if (data.two_factor_enabled) {
          state.pending2FAUser = data;
          const modal2FA = document.getElementById('modal-2fa-verify');
          const verify2FAPin = document.getElementById('verify-2fa-pin');
          if (modal2FA) modal2FA.classList.remove('hidden');
          if (verify2FAPin) {
            verify2FAPin.value = '';
            verify2FAPin.focus();
          }
          return;
        }
        completeManagerLogin(data);
      } catch (err) {
        showToast('Error during login. Check your connection.', 'error');
      }
    });
  }

  // 2FA verify
  const btnSubmit2FA = document.getElementById('btn-submit-2fa');
  const verify2FAPin = document.getElementById('verify-2fa-pin');
  const modal2FAVerify = document.getElementById('modal-2fa-verify');
  if (btnSubmit2FA) {
    btnSubmit2FA.addEventListener('click', () => {
      if (!state.pending2FAUser) return;
      if (verify2FAPin && verify2FAPin.value === state.pending2FAUser.two_factor_pin) {
        const user = state.pending2FAUser;
        state.pending2FAUser = null;
        if (modal2FAVerify) modal2FAVerify.classList.add('hidden');
        completeManagerLogin(user);
      } else {
        showToast('Invalid 2-Step PIN', 'error');
        if (verify2FAPin) verify2FAPin.value = '';
      }
    });
  }

  // Restore remember-me on load
  window.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('managerRememberUser');
    const savedPass = localStorage.getItem('managerRememberPass');
    const managerUsernameInput = document.getElementById('manager-username-input');
    const managerPasswordInput = document.getElementById('manager-password-input');
    const managerRememberMe = document.getElementById('manager-remember-me');
    if (savedUser && savedPass) {
      if (managerUsernameInput) managerUsernameInput.value = savedUser;
      if (managerPasswordInput) managerPasswordInput.value = savedPass;
      if (managerRememberMe) managerRememberMe.checked = true;
    }
  });

  // Schedule page manager login
  const btnScheduleLoginSubmit = document.getElementById('btn-schedule-login-submit');
  if (btnScheduleLoginSubmit) {
    btnScheduleLoginSubmit.addEventListener('click', async () => {
      const username = document.getElementById('schedule-manager-username')?.value;
      const password = document.getElementById('schedule-manager-password')?.value;
      if (!username || !password) return;
      try {
        const data = await attemptManagerLogin(username, password);
        if (!data) return;

        // Save remember-me only after successful auth
        const rememberMe = document.getElementById('manager-remember-me');
        if (rememberMe && rememberMe.checked) {
          localStorage.setItem('managerRememberUser', username);
          localStorage.setItem('managerRememberPass', password);
        }

        showToast(`Welcome back, ${data.name}!`);
        state.managerLoggedIn = true;
        state.currentManager = data;
        document.getElementById('schedule-manager-auth')?.classList.add('hidden');
        document.getElementById('schedule-manager-username') &&
          (document.getElementById('schedule-manager-username').value = '');
        document.getElementById('schedule-manager-password') &&
          (document.getElementById('schedule-manager-password').value = '');
        document.getElementById('btn-schedule-manager-login')?.classList.add('hidden');
        document.getElementById('btn-show-post-schedule')?.classList.remove('hidden');
        document.getElementById('manager-auth')?.classList.add('hidden');
        document.getElementById('manager-dashboard')?.classList.remove('hidden');

        const { loadSchedules } = await import('./schedule.js');
        loadSchedules();
      } catch (err) {
        showToast('Error during login.', 'error');
      }
    });
  }

  // Timesheet + payroll history delegation
  const timesheetGrid = document.getElementById('timesheet-grid');
  const biweeklyHistoryBody = document.getElementById('biweekly-history-body-payroll');
  const monthlyArchiveBody = document.getElementById('monthly-archive-body-payroll');

  [timesheetGrid, biweeklyHistoryBody, monthlyArchiveBody].forEach((container) => {
    if (container) {
      container.addEventListener('click', (e) => {
        const btn = e.target.closest('.btn-manage-logs');
        if (btn) {
          openManageLogs(btn.dataset.id, btn.dataset.name);
        }
      });
    }
  });

  // Pending approvals delegation
  const pendingPinsBody = document.getElementById('pending-pins-body');
  if (pendingPinsBody) {
    pendingPinsBody.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const { id, val } = btn.dataset;
      if (!id) return;

      if (btn.classList.contains('btn-approve-pin')) {
        try {
          const { error } = await window.supabaseClient
            .from('users')
            .update({ pin: val, pending_pin: null })
            .eq('id', id);
          if (error) throw error;
          showToast('PIN change approved');
          loadTimesheets();
        } catch (err) {
          showToast('Failed to approve PIN change.', 'error');
        }
      } else if (btn.classList.contains('btn-reject-pin')) {
        try {
          await window.supabaseClient.from('users').update({ pending_pin: null }).eq('id', id);
          showToast('PIN request rejected');
          loadTimesheets();
        } catch (err) {
          showToast('Failed to reject PIN request.', 'error');
        }
      } else if (btn.classList.contains('btn-approve-pwd')) {
        try {
          await window.supabaseClient
            .from('users')
            .update({ password: val, pending_password: null })
            .eq('id', id);
          showToast('Password reset approved!');
          loadTimesheets();
        } catch (err) {
          showToast('Failed to approve password reset.', 'error');
        }
      } else if (btn.classList.contains('btn-reject-pwd')) {
        try {
          await window.supabaseClient.from('users').update({ pending_password: null }).eq('id', id);
          showToast('Password reset rejected');
          loadTimesheets();
        } catch (err) {
          showToast('Failed to reject password reset.', 'error');
        }
      } else if (btn.classList.contains('btn-approve-account')) {
        try {
          await window.supabaseClient.from('users').update({ is_approved: true }).eq('id', id);
          showToast('Account approved!');
          loadTimesheets();
        } catch (err) {
          showToast('Failed to approve account.', 'error');
        }
      } else if (btn.classList.contains('btn-reject-account')) {
        try {
          await window.supabaseClient.from('users').delete().eq('id', id);
          showToast('Account request removed');
          loadTimesheets();
        } catch (err) {
          showToast('Failed to reject account.', 'error');
        }
      }
    });
  }

  // Time off delegation
  const managerTimeoffBody = document.getElementById('manager-timeoff-body');
  if (managerTimeoffBody) {
    managerTimeoffBody.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const { id } = btn.dataset;
      if (!id) return;
      if (btn.classList.contains('btn-approve-timeoff')) {
        try {
          await window.supabaseClient
            .from('time_off_requests')
            .update({ status: 'Approved' })
            .eq('id', id);
          showToast('Time off approved!');
          loadTimesheets();
        } catch (err) {
          showToast('Failed to approve time off.', 'error');
        }
      } else if (btn.classList.contains('btn-deny-timeoff')) {
        try {
          await window.supabaseClient
            .from('time_off_requests')
            .update({ status: 'Denied' })
            .eq('id', id);
          showToast('Time off denied.');
          loadTimesheets();
        } catch (err) {
          showToast('Failed to deny time off.', 'error');
        }
      }
    });
  }

  // Early clock-in approval delegation
  const earlyBodyEl = document.getElementById('early-clockin-body');
  if (earlyBodyEl) {
    earlyBodyEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const { id } = btn.dataset;
      if (!id) return;
      if (btn.classList.contains('btn-approve-early')) {
        try {
          await window.supabaseClient
            .from('early_clockin_approvals')
            .update({ status: 'approved', approved_by: state.currentManager || 'Manager' })
            .eq('id', id);
          showToast('Early clock-in approved!');
          loadTimesheets();
        } catch (err) {
          showToast('Failed to approve.', 'error');
        }
      } else if (btn.classList.contains('btn-deny-early')) {
        try {
          await window.supabaseClient
            .from('early_clockin_approvals')
            .update({ status: 'denied', approved_by: state.currentManager || 'Manager' })
            .eq('id', id);
          showToast('Early clock-in denied.');
          loadTimesheets();
        } catch (err) {
          showToast('Failed to deny.', 'error');
        }
      }
    });
  }

  // Missed-punch request approvals
  const missedBodyEl = document.getElementById('missed-punch-body');
  if (missedBodyEl) {
    missedBodyEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const { id, user, action, time } = btn.dataset;
      if (!id) return;
      const manager = state.currentManager || 'Manager';
      if (btn.classList.contains('btn-approve-missed')) {
        btn.disabled = true;
        try {
          // Insert the punch the employee missed, tagged so it's clearly a
          // manager-approved correction, then mark the request approved.
          const { error: insertErr } = await window.supabaseClient.from('time_logs').insert([
            {
              user_id: user,
              action: action,
              created_at: new Date(time).toISOString(),
              edited_by_manager: `${manager} (missed-punch)`,
            },
          ]);
          if (insertErr) throw insertErr;
          await window.supabaseClient
            .from('missed_punch_requests')
            .update({ status: 'approved', reviewed_by: manager })
            .eq('id', id);
          showToast('Missed punch approved and added.');
          loadTimesheets();
        } catch (err) {
          btn.disabled = false;
          showToast('Failed to approve request.', 'error');
        }
      } else if (btn.classList.contains('btn-deny-missed')) {
        try {
          await window.supabaseClient
            .from('missed_punch_requests')
            .update({ status: 'denied', reviewed_by: manager })
            .eq('id', id);
          showToast('Missed-punch request denied.');
          loadTimesheets();
        } catch (err) {
          showToast('Failed to deny request.', 'error');
        }
      }
    });
  }

  // Shift swap approvals
  const swapBodyEl = document.getElementById('shift-swap-body');
  if (swapBodyEl) {
    swapBodyEl.addEventListener('click', async (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const { id, orig, target } = btn.dataset;
      if (!id) return;
      const isApprove = btn.classList.contains('btn-approve-swap');
      const isDeny = btn.classList.contains('btn-deny-swap');
      if (!isApprove && !isDeny) return;

      btn.disabled = true;
      try {
        await window.supabaseClient
          .from('shift_swaps')
          .update({ status: isApprove ? 'Approved' : 'Denied' })
          .eq('id', id);

        // Notify both employees involved in the swap. Isolated so a
        // CORS/network failure doesn't block the approval itself.
        const targetIds = [orig, target].filter(Boolean);
        if (targetIds.length) {
          try {
            await window.supabaseClient.rpc('send_targeted_notification', {
              user_ids: targetIds,
              title: isApprove ? '✅ Shift Swap Approved' : '❌ Shift Swap Denied',
              body: isApprove
                ? 'Your shift swap request has been approved.'
                : 'Your shift swap request was denied.',
            });
          } catch (pushErr) {
            console.warn('Failed to send shift-swap notification:', pushErr);
          }
        }

        showToast(isApprove ? 'Shift swap approved!' : 'Shift swap denied.');
        loadTimesheets();
      } catch (err) {
        btn.disabled = false;
        showToast('Failed to update swap request.', 'error');
      }
    });
  }

  // Manage logs modal
  const modalManageLogs = document.getElementById('modal-manage-logs');
  const manageLogsBody = document.getElementById('manage-logs-body');
  const btnCloseManage = document.getElementById('btn-close-manage');
  const btnDeleteEmployee = document.getElementById('btn-delete-employee');
  const btnAddLog = document.getElementById('btn-add-log');
  const modalEditPunch = document.getElementById('modal-edit-punch');
  const editPunchAction = document.getElementById('edit-punch-action');
  const editPunchDatetime = document.getElementById('edit-punch-datetime');
  const btnCancelEditPunch = document.getElementById('btn-cancel-edit-punch');
  const btnSaveEditPunch = document.getElementById('btn-save-edit-punch');

  if (btnCloseManage) {
    btnCloseManage.addEventListener('click', () => {
      if (modalManageLogs) modalManageLogs.classList.add('hidden');
      state.selectedEmployeeForLogs = null;
      loadTimesheets();
    });
  }

  if (btnDeleteEmployee) {
    btnDeleteEmployee.addEventListener('click', async () => {
      if (!state.selectedEmployeeForLogs) return;
      if (
        !confirm(
          'Are you ABSOLUTELY sure? This permanently removes the employee and all their time logs.',
        )
      )
        return;
      try {
        await window.supabaseClient
          .from('time_logs')
          .delete()
          .eq('user_id', state.selectedEmployeeForLogs);
        const { error } = await window.supabaseClient
          .from('users')
          .delete()
          .eq('id', state.selectedEmployeeForLogs);
        if (error) throw error;
        showToast('Employee deleted successfully');
        if (modalManageLogs) modalManageLogs.classList.add('hidden');
        state.selectedEmployeeForLogs = null;
        loadTimesheets();
      } catch (err) {
        showToast('Failed to delete employee.', 'error');
      }
    });
  }

  if (manageLogsBody) {
    manageLogsBody.addEventListener('click', async (e) => {
      const btnDelete = e.target.closest('.btn-delete-log');
      const btnEdit = e.target.closest('.btn-edit-log');

      if (btnDelete) {
        const logId = btnDelete.dataset.id;
        if (!confirm('Delete this punch?')) return;
        try {
          const { data: existing, error: fetchErr } = await window.supabaseClient
            .from('time_logs')
            .select('id, user_id, action, created_at, edited_by_manager')
            .eq('id', logId)
            .maybeSingle();
          if (fetchErr) throw fetchErr;

          // Insert the clear marker BEFORE deleting so a concurrent hourly
          // sweep cannot recreate the OUT in the gap.
          if (existing?.edited_by_manager === SYSTEM_AUTO_SWEEP_LABEL) {
            await insertAutoSweepClearedMarker(existing);
          }

          const { error } = await window.supabaseClient.from('time_logs').delete().eq('id', logId);
          if (error) throw error;

          showToast('Log deleted successfully');
          await loadEmployeeLogs();
          loadTimesheets();
        } catch (err) {
          showToast('Failed to delete log.', 'error');
        }
      } else if (btnEdit) {
        state.currentEditingPunchId = btnEdit.dataset.id;
        if (editPunchAction) editPunchAction.value = btnEdit.dataset.action;
        const d = new Date(btnEdit.dataset.time);
        const localISO = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16);
        if (editPunchDatetime) editPunchDatetime.value = localISO;
        if (modalEditPunch) {
          ensureModalTopLevel(modalEditPunch);
          modalEditPunch.classList.remove('hidden');
        }
      } else if (e.target.dataset.fullPhoto === 'true') {
        openFullPhoto(e.target.src);
      }
    });
  }

  if (btnCancelEditPunch) {
    btnCancelEditPunch.addEventListener('click', () => {
      if (modalEditPunch) modalEditPunch.classList.add('hidden');
      state.currentEditingPunchId = null;
    });
  }

  if (btnSaveEditPunch) {
    btnSaveEditPunch.addEventListener('click', async () => {
      if (!state.currentEditingPunchId) return;
      const localDate = new Date(editPunchDatetime.value);
      if (isNaN(localDate.getTime())) {
        showToast('Invalid date/time', 'error');
        return;
      }
      try {
        const { error } = await window.supabaseClient
          .from('time_logs')
          .update({ action: editPunchAction.value, created_at: localDate.toISOString() })
          .eq('id', state.currentEditingPunchId);
        if (error) throw error;
        showToast('Punch updated successfully!');
        if (modalEditPunch) modalEditPunch.classList.add('hidden');
        state.currentEditingPunchId = null;
        await loadEmployeeLogs();
        loadTimesheets();
      } catch (err) {
        showToast('Failed to update punch.', 'error');
      }
    });
  }

  if (btnAddLog) {
    btnAddLog.addEventListener('click', async () => {
      if (!state.selectedEmployeeForLogs) return;
      const action = document.getElementById('new-log-action')?.value;
      const timeVal = document.getElementById('new-log-time')?.value;
      if (!timeVal) {
        showToast('Please select a date and time', 'error');
        return;
      }
      try {
        const { error } = await window.supabaseClient.from('time_logs').insert([
          {
            user_id: state.selectedEmployeeForLogs,
            action,
            created_at: new Date(timeVal).toISOString(),
          },
        ]);
        if (error) throw error;
        showToast('Manual punch added');
        const newLogTime = document.getElementById('new-log-time');
        if (newLogTime) newLogTime.value = '';
        await loadEmployeeLogs();
        loadTimesheets();
      } catch (err) {
        showToast('Failed to add manual log.', 'error');
      }
    });
  }

  // Save employee details
  const btnSaveEmployeeDetails = document.getElementById('btn-save-employee-details');
  if (btnSaveEmployeeDetails) {
    btnSaveEmployeeDetails.addEventListener('click', async () => {
      if (!state.selectedEmployeeForLogs) return;
      const firstName = document.getElementById('edit-employee-first-name')?.value.trim();
      const lastName = document.getElementById('edit-employee-last-name')?.value.trim();
      const loginName = document.getElementById('edit-employee-login-name')?.value.trim();
      const payRate = parseFloat(document.getElementById('edit-employee-pay-rate')?.value) || 0;
      const isSalary = document.getElementById('edit-employee-is-salary')?.checked || false;
      const taxStatusEl = document.getElementById('edit-employee-tax-status');
      const taxStatus = taxStatusEl ? taxStatusEl.value : null;
      const roleEl = document.getElementById('edit-employee-role');
      const role = roleEl ? roleEl.value : 'Employee';
      const managerPassword = document.getElementById('edit-employee-password')?.value || '';

      if (!firstName || !lastName || !loginName) {
        showToast('All name fields are required', 'error');
        return;
      }

      const isLeadership = role !== 'Employee';
      const oldRole = state.employeeMap[state.selectedEmployeeForLogs]?.role || 'Employee';
      // Require a password when promoting an Employee into a leadership role (they have none yet).
      if (isLeadership && !managerPassword && oldRole === 'Employee') {
        showToast('Set a manager password for this leadership role', 'error');
        return;
      }

      const payrollName = `${lastName}, ${firstName}`;
      try {
        const payload = {
          name: loginName,
          payroll_name: payrollName,
          pay_rate: payRate,
          is_salary: isSalary,
          role: role,
        };
        if (taxStatus !== null) payload.tax_status = taxStatus;
        if (isLeadership) {
          if (managerPassword) payload.password = managerPassword; // set / change dashboard password
          // otherwise keep their existing password
        } else {
          payload.password = null; // demoted to Employee → revoke dashboard access
        }

        const { error } = await window.supabaseClient
          .from('users')
          .update(payload)
          .eq('id', state.selectedEmployeeForLogs);
        if (error) {
          // Retry without optional columns
          const { error: retryError } = await window.supabaseClient
            .from('users')
            .update({ name: loginName, payroll_name: payrollName, pay_rate: payRate })
            .eq('id', state.selectedEmployeeForLogs);
          if (retryError) throw retryError;
          showToast('Saved (some optional fields skipped — check Supabase schema)', 'warning');
        } else {
          showToast('Employee details updated!');
        }

        if (state.employeeMap[state.selectedEmployeeForLogs]) {
          Object.assign(state.employeeMap[state.selectedEmployeeForLogs], {
            name: loginName,
            payroll_name: payrollName,
            pay_rate: payRate,
            is_salary: isSalary,
            tax_status: taxStatus,
            role: role,
          });
        }
        const pwdEl = document.getElementById('edit-employee-password');
        if (pwdEl) pwdEl.value = '';
        toggleEditEmployeePassword();
        loadTimesheets();
      } catch (err) {
        showToast('Error updating employee details.', 'error');
      }
    });
  }

  // Employee-details role change → reveal/hide the manager password field
  const editEmployeeRoleEl = document.getElementById('edit-employee-role');
  if (editEmployeeRoleEl) editEmployeeRoleEl.addEventListener('change', toggleEditEmployeePassword);

  // Edit Employees (Manager tab) — details/role management list
  const btnShowEditEmployees = document.getElementById('btn-show-edit-employees');
  const modalEditEmployees = document.getElementById('modal-edit-employees');
  const btnCloseEditEmployees = document.getElementById('btn-close-edit-employees');
  const editEmployeesBody = document.getElementById('edit-employees-body');
  const editEmployeesSearch = document.getElementById('edit-employees-search');

  const escHtml = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  function renderEditEmployees(filter = '') {
    if (!editEmployeesBody) return;
    const f = filter.trim().toLowerCase();
    const emps = Object.values(state.employeeMap || {})
      .filter(
        (e) =>
          !f ||
          (e.payroll_name || '').toLowerCase().includes(f) ||
          (e.name || '').toLowerCase().includes(f),
      )
      .sort((a, b) =>
        (a.payroll_name || a.name || '').localeCompare(b.payroll_name || b.name || ''),
      );

    if (!emps.length) {
      editEmployeesBody.innerHTML =
        '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:15px;">No employees found</td></tr>';
      return;
    }
    editEmployeesBody.innerHTML = emps
      .map((e) => {
        const displayName = e.payroll_name || e.name || 'Unknown';
        return `<tr>
        <td>${escHtml(displayName)}</td>
        <td>${escHtml(e.role || 'Employee')}</td>
        <td><button class="btn-primary btn-edit-emp" data-id="${escHtml(e.id)}" data-name="${escHtml(displayName)}" style="padding:5px 10px;font-size:0.8rem;cursor:pointer;border-radius:4px;border:none;">Edit</button></td>
      </tr>`;
      })
      .join('');
  }

  if (btnShowEditEmployees) {
    btnShowEditEmployees.addEventListener('click', async () => {
      if (modalEditEmployees) modalEditEmployees.classList.remove('hidden');
      if (editEmployeesSearch) editEmployeesSearch.value = '';
      if (editEmployeesBody)
        editEmployeesBody.innerHTML =
          '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:15px;">Loading…</td></tr>';
      if (!Object.keys(state.employeeMap || {}).length) await loadTimesheets();
      renderEditEmployees('');
    });
  }

  // Timesheet quick-action card — jump to the Weekly Timesheet view
  const btnShowTimesheet = document.getElementById('btn-show-timesheet');
  if (btnShowTimesheet) {
    btnShowTimesheet.addEventListener('click', () => {
      if (window.switchView) window.switchView('timesheet');
    });
  }

  // Payroll quick-action card — jump to the Payroll view
  const btnShowPayroll = document.getElementById('btn-show-payroll');
  if (btnShowPayroll) {
    btnShowPayroll.addEventListener('click', () => {
      state.pendingLoginTarget = 'payroll';
      if (window.switchView) window.switchView('payroll');
    });
  }
  if (btnCloseEditEmployees) {
    btnCloseEditEmployees.addEventListener('click', () => {
      if (modalEditEmployees) modalEditEmployees.classList.add('hidden');
    });
  }
  if (editEmployeesSearch) {
    editEmployeesSearch.addEventListener('input', (e) => renderEditEmployees(e.target.value));
  }
  if (editEmployeesBody) {
    editEmployeesBody.addEventListener('click', (e) => {
      const btn = e.target.closest('.btn-edit-emp');
      if (btn) {
        if (modalEditEmployees) modalEditEmployees.classList.add('hidden');
        openManageLogs(btn.dataset.id, btn.dataset.name, { detailsOnly: true });
      }
    });
  }

  // Create user
  const btnShowCreateUser = document.getElementById('btn-show-create-user');
  const modalCreateUser = document.getElementById('modal-create-user');
  const btnConfirmCreate = document.getElementById('btn-confirm-create');
  const btnCancelCreate = document.getElementById('btn-cancel-create');

  if (btnShowCreateUser)
    btnShowCreateUser.addEventListener('click', () => {
      if (modalCreateUser) modalCreateUser.classList.remove('hidden');
    });
  if (btnCancelCreate) {
    btnCancelCreate.addEventListener('click', () => {
      if (modalCreateUser) modalCreateUser.classList.add('hidden');
      [
        'new-user-first-name',
        'new-user-last-name',
        'new-user-login-name',
        'new-user-pin',
        'new-user-password',
      ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
    });
  }

  document.querySelectorAll('input[name="new-user-role"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      const pwd = document.getElementById('new-user-password');
      if (pwd) {
        if (e.target.value !== 'Employee') pwd.classList.remove('hidden');
        else {
          pwd.classList.add('hidden');
          pwd.value = '';
        }
      }
    });
  });

  if (btnConfirmCreate) {
    btnConfirmCreate.addEventListener('click', async () => {
      const firstName = document.getElementById('new-user-first-name')?.value.trim();
      const lastName = document.getElementById('new-user-last-name')?.value.trim();
      const name = document.getElementById('new-user-login-name')?.value.trim();
      const pin = document.getElementById('new-user-pin')?.value;
      const role = document.querySelector('input[name="new-user-role"]:checked')?.value;
      const password = document.getElementById('new-user-password')?.value;

      if (!firstName || !lastName || !name || !pin || pin.length !== 4) {
        showToast('Fill in all fields and enter a 4-digit PIN', 'error');
        return;
      }
      if (role !== 'Employee' && !password) {
        showToast('Management roles require a dashboard password', 'error');
        return;
      }

      try {
        const { data: existing } = await window.supabaseClient
          .from('users')
          .select('id')
          .eq('pin', pin)
          .single();
        if (existing) {
          showToast('PIN is already in use.', 'error');
          return;
        }

        const isSalaryNew = document.getElementById('new-user-is-salary')?.checked || false;
        const { error } = await window.supabaseClient.from('users').insert([
          {
            name,
            payroll_name: `${lastName}, ${firstName}`,
            pin,
            role,
            password: role !== 'Employee' ? password : null,
            is_approved: false,
            is_salary: isSalaryNew,
          },
        ]);
        if (error) throw error;

        showToast(`Account request for ${firstName} ${lastName} submitted for approval.`);
        [
          'new-user-first-name',
          'new-user-last-name',
          'new-user-login-name',
          'new-user-pin',
          'new-user-password',
        ].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.value = '';
        });
        const salaryCheckbox = document.getElementById('new-user-is-salary');
        if (salaryCheckbox) salaryCheckbox.checked = false;
        if (modalCreateUser) modalCreateUser.classList.add('hidden');
        loadTimesheets();
      } catch (err) {
        showToast('Failed to create user.', 'error');
      }
    });
  }

  // Forgot password (manager)
  const btnForgotPwd = document.getElementById('btn-forgot-password');
  if (btnForgotPwd) {
    const modalForgotPwd = document.getElementById('modal-forgot-password');
    const forgotPwdName = document.getElementById('forgot-password-name');
    const forgotPwdNew = document.getElementById('forgot-password-new');
    const btnCancelPwdReset = document.getElementById('btn-cancel-password-reset');
    const btnSubmitPwdReset = document.getElementById('btn-submit-password-reset');

    btnForgotPwd.addEventListener('click', () => {
      if (modalForgotPwd) modalForgotPwd.classList.remove('hidden');
    });
    if (btnCancelPwdReset) {
      btnCancelPwdReset.addEventListener('click', () => {
        if (modalForgotPwd) modalForgotPwd.classList.add('hidden');
        if (forgotPwdName) forgotPwdName.value = '';
        if (forgotPwdNew) forgotPwdNew.value = '';
      });
    }
    if (btnSubmitPwdReset) {
      btnSubmitPwdReset.addEventListener('click', async () => {
        const name = forgotPwdName?.value.trim();
        const newPwd = forgotPwdNew?.value;
        if (!name || !newPwd) {
          showToast('Enter username and new password', 'error');
          return;
        }
        try {
          const { data: user, error } = await window.supabaseClient
            .from('users')
            .select('id')
            .eq('name', name)
            .in('role', MANAGEMENT_ROLES)
            .single();
          if (error || !user) {
            showToast('Username not found', 'error');
            return;
          }
          await window.supabaseClient
            .from('users')
            .update({ pending_password: newPwd })
            .eq('id', user.id);
          showToast('Password reset requested! Another manager must approve it.');
          if (modalForgotPwd) modalForgotPwd.classList.add('hidden');
          if (forgotPwdName) forgotPwdName.value = '';
          if (forgotPwdNew) forgotPwdNew.value = '';
        } catch (err) {
          showToast('Failed to request password reset.', 'error');
        }
      });
    }
  }

  // Open approvals modal
  const btnScrollApprovals = document.getElementById('btn-scroll-approvals');
  const modalApprovals = document.getElementById('modal-approvals');
  const btnCloseApprovals = document.getElementById('btn-close-approvals');

  if (btnScrollApprovals && modalApprovals) {
    btnScrollApprovals.addEventListener('click', () => {
      modalApprovals.classList.remove('hidden');
    });
  }
  if (btnCloseApprovals && modalApprovals) {
    btnCloseApprovals.addEventListener('click', () => {
      modalApprovals.classList.add('hidden');
    });
  }

  // Payroll download
  const btnDownloadPayroll = document.getElementById('btn-download-payroll');
  if (btnDownloadPayroll) {
    btnDownloadPayroll.addEventListener('click', async () => {
      try {
        showToast('Generating Payroll CSV...');
        const { data: usersData, error: uErr } = await window.supabaseClient
          .from('users')
          .select('id, name, is_salary');
        const { data: logsData, error: lErr } = await window.supabaseClient
          .from('time_logs')
          .select('user_id, action, created_at')
          .order('created_at', { ascending: true });
        if (uErr || lErr) throw new Error('Fetch failed');

        const startOfWeek = getStartOfWeek().getTime();
        const startOfLastWeek = startOfWeek - 7 * 86400000;
        const empMap = {};
        usersData.forEach((u) => {
          empMap[u.id] = {
            name: u.name,
            thisWeekMs: 0,
            lastWeekMs: 0,
            status: 'OUT',
            lastIn: null,
            is_salary: u.is_salary || false,
          };
        });

        logsData.forEach((log) => {
          const emp = empMap[log.user_id];
          if (!emp) return;
          const time = new Date(log.created_at).getTime();
          if (log.action === 'IN' || log.action === 'END_LUNCH') {
            emp.status = 'IN';
            emp.lastIn = time;
          } else if (log.action === 'OUT' || log.action === 'START_LUNCH') {
            if (emp.status === 'IN' && emp.lastIn) {
              const d = time - emp.lastIn;
              if (emp.lastIn >= startOfWeek) emp.thisWeekMs += d;
              else if (emp.lastIn >= startOfLastWeek) emp.lastWeekMs += d;
            }
            emp.status = 'OUT';
            emp.lastIn = null;
          }
        });

        Object.values(empMap).forEach((emp) => {
          if (emp.status === 'IN' && emp.lastIn) {
            const d = Date.now() - emp.lastIn;
            if (emp.lastIn >= startOfWeek) emp.thisWeekMs += d;
            else if (emp.lastIn >= startOfLastWeek) emp.lastWeekMs += d;
          }
        });

        const { customPayrollFormat } = state;
        const startDate = new Date(startOfWeek);
        const endDate = new Date(startOfWeek + 6 * 86400000);
        const fmt = (d) =>
          `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
        let currentLabel = customPayrollFormat.current || `${fmt(startDate)} - ${fmt(endDate)}`;
        const nextS = new Date(startOfWeek + 7 * 86400000);
        const nextE = new Date(startOfWeek + 13 * 86400000);
        let nextLabel = customPayrollFormat.next || `${fmt(nextS)} - ${fmt(nextE)}`;

        let csv = `#,Employee Name,${currentLabel},${nextLabel}\n`;
        let count = 1;
        Object.values(empMap).forEach((emp) => {
          const hrs = emp.thisWeekMs / 3600000;
          if (hrs === 0 && !emp.is_salary) return;
          csv += `"${count++}","${formatNameLastFirst(emp.name)}",${hrs.toFixed(2)},0.00\n`;
        });

        const safe = currentLabel
          .replace(/[/\\]/g, '-')
          .replace(/\s*-\s*/g, '_')
          .replace(/\s+/g, '_')
          .replace(/[^a-zA-Z0-9_-]/g, '');
        downloadCsv(csv, `Payroll_Export_${safe}.csv`);
      } catch (err) {
        showToast('Error exporting payroll: ' + (err.message || ''), 'error');
      }
    });
  }
}

function openFullPhoto(src) {
  const modal = document.getElementById('modal-view-photo');
  const fullImg = document.getElementById('full-size-photo');
  if (modal && fullImg) {
    ensureModalTopLevel(modal);
    fullImg.src = src;
    modal.classList.remove('hidden');
  }
}

export async function openManageLogs(userId, userName, options = {}) {
  const { detailsOnly = false } = options;
  state.selectedEmployeeForLogs = userId;
  const emp = state.employeeMap[userId];

  ['edit-employee-login-name', 'edit-employee-pay-rate'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = emp ? (id === 'edit-employee-pay-rate' ? emp.pay_rate : emp.name) : '';
  });
  const salaryEl = document.getElementById('edit-employee-is-salary');
  if (salaryEl) salaryEl.checked = emp ? emp.is_salary : false;
  const taxEl = document.getElementById('edit-employee-tax-status');
  if (taxEl) taxEl.value = emp ? emp.tax_status || '' : '';
  const roleEl = document.getElementById('edit-employee-role');
  if (roleEl) roleEl.value = emp ? emp.role || 'Employee' : 'Employee';
  const pwdInput = document.getElementById('edit-employee-password');
  if (pwdInput) pwdInput.value = '';
  toggleEditEmployeePassword();

  const firstEl = document.getElementById('edit-employee-first-name');
  const lastEl = document.getElementById('edit-employee-last-name');
  if (emp && emp.payroll_name && emp.payroll_name.includes(', ')) {
    const [last, first] = emp.payroll_name.split(', ');
    if (lastEl) lastEl.value = last || '';
    if (firstEl) firstEl.value = first || '';
  } else {
    if (firstEl) firstEl.value = emp ? emp.name : '';
    if (lastEl) lastEl.value = '';
  }

  // In details-only mode (Manager tab → Edit Employees) hide the time-log sections;
  // the full log management stays on the Timesheet tab's Manage button.
  const manualPunchSection = document.getElementById('manage-manual-punch-section');
  const logsTableSection = document.getElementById('manage-logs-table-section');
  if (manualPunchSection) manualPunchSection.classList.toggle('hidden', detailsOnly);
  if (logsTableSection) logsTableSection.classList.toggle('hidden', detailsOnly);

  const manageLogsTitle = document.getElementById('manage-logs-title');
  const modalManageLogs = document.getElementById('modal-manage-logs');
  if (manageLogsTitle)
    manageLogsTitle.textContent = detailsOnly
      ? `Edit Employee: ${userName}`
      : `Manage Logs: ${userName}`;
  if (modalManageLogs) {
    ensureModalTopLevel(modalManageLogs);
    modalManageLogs.classList.remove('hidden');
  }

  if (!detailsOnly) await loadEmployeeLogs();
}
window.openManageLogs = openManageLogs;

// Photo viewer
document.getElementById('btn-close-photo')?.addEventListener('click', () => {
  document.getElementById('modal-view-photo')?.classList.add('hidden');
});
