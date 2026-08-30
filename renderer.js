import { state } from './modules/utils.js';
import { init as initTimeclock, resetTimeclockState, signOut } from './modules/timeclock.js';
import { init as initManager, logoutManager, loadTimesheets } from './modules/manager.js';
import { init as initEmployee, loadEmployeePortal } from './modules/employee.js';
import { init as initSchedule, loadSchedules } from './modules/schedule.js';
import { init as initOps, loadOps } from './modules/ops.js';
import { init as initAnalytics } from './modules/analytics.js';
import { init as initSettings, fetchSettings, applyTheme } from './modules/settings.js';

// --- Navigation ---
const navTimeclock = document.getElementById('nav-timeclock');
const navEmployee = document.getElementById('nav-employee');
const navManager = document.getElementById('nav-manager');
const navPayroll = document.getElementById('nav-payroll');
const navSchedule = document.getElementById('nav-schedule');
const navOps = document.getElementById('nav-ops');
const navSettings = document.getElementById('nav-settings');
const navTimesheet = document.getElementById('nav-timesheet');

const viewTimeclock = document.getElementById('view-timeclock');
const viewEmployee = document.getElementById('view-employee');
const viewManager = document.getElementById('view-manager');
const viewPayroll = document.getElementById('view-payroll');
const viewSchedule = document.getElementById('view-schedule');
const viewOps = document.getElementById('view-ops');
const viewSettings = document.getElementById('view-settings');
const viewTimesheet = document.getElementById('view-timesheet');

const managerAuth = document.getElementById('manager-auth');
const managerDashboard = document.getElementById('manager-dashboard');
const payrollAuth = document.getElementById('payroll-auth');
const payrollDashboard = document.getElementById('payroll-dashboard');

function logoutEmployeePortal() {
  state.currentPortalEmployee = null;
  const employeeAuth = document.getElementById('employee-auth');
  const employeeDashboard = document.getElementById('employee-dashboard');
  if (employeeAuth) employeeAuth.classList.remove('hidden');
  if (employeeDashboard) employeeDashboard.classList.add('hidden');
}

export function switchView(view) {
  const allViews = [
    viewTimeclock,
    viewManager,
    viewEmployee,
    viewPayroll,
    viewSchedule,
    viewOps,
    viewSettings,
    viewTimesheet,
  ];
  const allNavs = [
    navTimeclock,
    navManager,
    navEmployee,
    navPayroll,
    navSchedule,
    navOps,
    navSettings,
    navTimesheet,
  ];

  allViews.forEach((v) => v && v.classList.remove('active'));
  allNavs.forEach((n) => n && n.classList.remove('active'));

  if (view === 'timeclock') {
    viewTimeclock.classList.add('active');
    navTimeclock.classList.add('active');
    resetTimeclockState();
    let _savedUser = null;
    try {
      const _savedSession = localStorage.getItem('lcw_web_user');
      if (_savedSession) _savedUser = JSON.parse(_savedSession);
    } catch (e) {
      // Corrupted session payload — treat as logged out rather than breaking nav.
      _savedUser = null;
    }
    if (!_savedUser || _savedUser.role === 'Employee') logoutManager();
    logoutEmployeePortal();
  } else if (view === 'manager') {
    viewManager.classList.add('active');
    if (navManager) navManager.classList.add('active');
    if (state.managerLoggedIn) {
      if (managerAuth) managerAuth.classList.add('hidden');
      if (managerDashboard) managerDashboard.classList.remove('hidden');
      loadTimesheets();
    } else {
      if (managerAuth) managerAuth.classList.remove('hidden');
      if (managerDashboard) managerDashboard.classList.add('hidden');
    }
  } else if (view === 'employee') {
    viewEmployee.classList.add('active');
    if (navEmployee) navEmployee.classList.add('active');
    // Auto-use the globally logged-in user — no second login needed
    if (!state.currentPortalEmployee && state.currentUser) {
      state.currentPortalEmployee = state.currentUser;
    }
    if (state.currentPortalEmployee) {
      const employeeAuth = document.getElementById('employee-auth');
      const employeeDashboard = document.getElementById('employee-dashboard');
      if (employeeAuth) employeeAuth.classList.add('hidden');
      if (employeeDashboard) employeeDashboard.classList.remove('hidden');
      loadEmployeePortal(state.currentPortalEmployee.id, state.currentPortalEmployee.name);
    }
  } else if (view === 'timesheet') {
    viewTimesheet.classList.add('active');
    if (navTimesheet) navTimesheet.classList.add('active');

    // We reuse manager authentication/state since timesheet is a manager function
    if (!state.managerLoggedIn) {
      if (managerAuth) managerAuth.classList.remove('hidden');
      if (managerDashboard) managerDashboard.classList.add('hidden');
      switchView('manager'); // Redirect to login
    } else {
      loadTimesheets();
    }
  } else if (view === 'payroll') {
    viewPayroll.classList.add('active');
    if (navPayroll) navPayroll.classList.add('active');
    if (state.managerLoggedIn) {
      if (payrollAuth) payrollAuth.classList.add('hidden');
      if (payrollDashboard) payrollDashboard.classList.remove('hidden');
      loadTimesheets();
    } else {
      if (payrollAuth) payrollAuth.classList.remove('hidden');
      if (payrollDashboard) payrollDashboard.classList.add('hidden');
    }
  } else if (view === 'schedule') {
    viewSchedule.classList.add('active');
    if (navSchedule) navSchedule.classList.add('active');
    loadSchedules();
  } else if (view === 'ops') {
    viewOps.classList.add('active');
    if (navOps) navOps.classList.add('active');
    loadOps();
  } else if (view === 'settings') {
    if (viewSettings) viewSettings.classList.add('active');
    if (navSettings) navSettings.classList.add('active');
  }
}

window.switchView = switchView;
window.signOut = signOut;

// --- Nav Event Listeners ---
if (navTimeclock) navTimeclock.addEventListener('click', () => switchView('timeclock'));
if (navEmployee) navEmployee.addEventListener('click', () => switchView('employee'));
if (navManager) {
  navManager.addEventListener('click', () => {
    state.pendingLoginTarget = 'manager';
    switchView('manager');
  });
}
if (navPayroll) {
  navPayroll.addEventListener('click', () => {
    state.pendingLoginTarget = 'payroll';
    switchView('payroll');
  });
}
if (navSchedule) navSchedule.addEventListener('click', () => switchView('schedule'));
if (navOps) navOps.addEventListener('click', () => switchView('ops'));
if (navSettings) navSettings.addEventListener('click', () => switchView('settings'));
if (navTimesheet) navTimesheet.addEventListener('click', () => switchView('timesheet'));

// --- Bootstrap ---
const savedTheme = localStorage.getItem('theme') || 'light';
applyTheme(savedTheme);
document.body.classList.add('logged-out');

initSettings();
initTimeclock();
initManager();
initEmployee();
initSchedule();
initOps();
initAnalytics();

fetchSettings();

// Clean up and handle splash screen DOM display
const splashElement = document.getElementById('splash-screen');
if (splashElement) {
  const isMobileApp =
    !!window.ReactNativeWebView || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  if (isMobileApp) {
    splashElement.style.display = 'flex'; // Only play splash animation on mobile apps
    setTimeout(() => {
      splashElement.remove();
    }, 2800); // 2.5s CSS animation + 300ms transition buffer
  } else {
    splashElement.remove(); // Skip splash screen immediately on desktop web
  }
}
