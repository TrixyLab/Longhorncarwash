// Shared mutable application state
export const state = {
  currentPin: '',
  currentUser: null,
  managerLoggedIn: false,
  currentManager: null,
  currentManagerRole: null,
  pending2FAUser: null,
  pendingLoginTarget: 'manager',
  employeeMap: {},
  currentPortalEmployee: null,
  selectedEmployeeForLogs: null,
  editingScheduleId: null,
  // Publish state of the schedule currently open in the editor ('pending' or
  // 'published'), so a save knows whether it should notify employees. Null when
  // creating a brand-new draft.
  editingScheduleStatus: null,
  // Snapshot of the schedule editor taken when editing begins, so a save that
  // changes nothing can skip re-notifying employees.
  editingScheduleOriginalContent: null,
  editingChecklistId: null,
  currentEditingPunchId: null,
  activeAnnouncement: null,
  cameraStream: null,
  idleTimeout: null,
  laborHoursChart: null,
  statusDistributionChart: null,
  dailyRevenueGoal: 0,
  laborCostGoalPercent: 25,
  CAR_WASH_LAT: 33.06734,
  CAR_WASH_LON: -97.29654,
  ALLOWED_RADIUS_METERS: 100,
  GEOFENCE_ENABLED: true,
  ANTI_BUDDY_ENABLED: true,
  EARLY_CLOCKIN_BLOCK_ENABLED: true,
  customPayrollFormat: { current: '', next: '' },
  comm_single_good: 50,
  comm_single_better: 100,
  comm_single_best: 150,
  comm_membership_good: 200,
  comm_membership_better: 300,
  comm_membership_best: 400,
  // Resolves once fetchSettings() has finished loading remote settings (geofence
  // radius, WiFi lock, etc.) into state. Punch flows await this so the first
  // punch after page load doesn't run against the hardcoded defaults.
  settingsReady: Promise.resolve(),
};

// Actions that mean the employee is currently on the clock (working or on a
// paid break that still counts as "in"). Kept here so the timeclock UI, the
// punch validator, and the auto-sweep all agree on what "clocked in" means.
const CLOCKED_IN_ACTIONS = ['IN', 'END_LUNCH', 'CLOCK_IN'];
const CLOCKED_OUT_ACTIONS = ['OUT', 'CLOCK_OUT'];

/** Label written on forced clock-outs from performMidnightSweep. */
export const SYSTEM_AUTO_SWEEP_LABEL = 'System Auto-Sweep';

/**
 * Non-punch marker inserted when a manager deletes a System Auto-Sweep OUT.
 * Prevents the hourly sweep from recreating the OUT for that same open IN.
 * Ignored by hours math and punch-status queries (not a PUNCH_ACTION).
 */
export const AUTO_SWEEP_CLEARED_ACTION = 'AUTO_SWEEP_CLEARED';

/** Build the time_logs row that suppresses re-sweep after a manager delete. */
export function buildAutoSweepClearedRow(userId, openInCreatedAt) {
  const inMs = new Date(openInCreatedAt).getTime();
  return {
    user_id: userId,
    action: AUTO_SWEEP_CLEARED_ACTION,
    // Place just after the IN so "cleared after this open punch" checks match.
    created_at: new Date(inMs + 1000).toISOString(),
    edited_by_manager: 'Manager cleared auto-sweep',
  };
}

// Pure validator for a punch transition. Given the employee's last recorded
// action (or null/undefined if they have none) and the action they're
// attempting, returns a human-readable error string if the transition is
// invalid, or null if it's allowed. Shared by the online and offline punch
// paths so both enforce the same rules.
export function getPunchTransitionError(lastAction, action) {
  if (lastAction === null || lastAction === undefined) {
    return action === 'IN' ? null : 'You must clock in first.';
  }
  const isIn = CLOCKED_IN_ACTIONS.includes(lastAction);
  const isOut = CLOCKED_OUT_ACTIONS.includes(lastAction);
  const isLunch = lastAction === 'START_LUNCH';

  if (action === 'IN' && isIn) return 'You are already clocked in.';
  if (action === 'OUT' && isOut) return 'You are already clocked out.';
  if (action === 'START_LUNCH' && isLunch) return 'You are already on lunch.';
  if (action === 'END_LUNCH' && !isLunch) return 'You must be on lunch to end lunch.';
  if ((action === 'START_LUNCH' || action === 'OUT') && !isIn && !isLunch) {
    return 'You must clock in first.';
  }
  return null;
}

// The punch types an employee can file a missed-punch request for.
export const MISSED_PUNCH_ACTIONS = ['IN', 'OUT', 'START_LUNCH', 'END_LUNCH'];

// How far back a missed-punch request may reach. Older corrections go through a
// manager directly rather than the self-service request flow.
const MISSED_PUNCH_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// Pure validator for a missed-punch request. Returns an error string if the
// request is invalid, or null if it's acceptable. `now` is injectable for tests.
export function getMissedPunchRequestError(action, when, now = new Date()) {
  if (!MISSED_PUNCH_ACTIONS.includes(action)) return 'Choose which punch you missed.';
  const t = when instanceof Date ? when : new Date(when);
  if (isNaN(t.getTime())) return 'Enter a valid date and time.';
  // Allow a minute of slack for clock skew between the device and server.
  if (t.getTime() > now.getTime() + 60 * 1000) {
    return "The punch time can't be in the future.";
  }
  if (now.getTime() - t.getTime() > MISSED_PUNCH_MAX_AGE_MS) {
    return 'Requests are limited to the last 30 days. Ask a manager to add older punches.';
  }
  return null;
}

// --- Toast ---
export function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  if (type === 'error') {
    toast.style.backgroundColor = 'var(--danger)';
  } else if (type === 'warning') {
    toast.style.backgroundColor = '#f39c12';
  } else {
    toast.style.backgroundColor = 'var(--primary)';
  }
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

// --- Date Utilities ---
export function getStartOfWeek() {
  const d = new Date();
  const day = d.getDay();
  const diffToWed = day >= 3 ? day - 3 : day + 4;
  const wednesday = new Date(d.setDate(d.getDate() - diffToWed));
  wednesday.setHours(0, 0, 0, 0);
  return wednesday;
}

export function getBiweeklyWeeks(date) {
  // Delay the cycle calculation by 24 hours so that if today is Wednesday,
  // we still show the previous cycle until midnight (end of Wednesday).
  const effectiveDate = new Date(date.getTime() - 24 * 60 * 60 * 1000);

  // Anchor on Wednesday June 17, 2026 — each week runs Wed–Tue (ends Tuesday midnight),
  // the 14-day cycle resets Wednesday, and payday is the Friday after the cycle ends.
  const anchor = new Date(2026, 5, 17);
  anchor.setHours(0, 0, 0, 0);

  // Use UTC day arithmetic to avoid DST drift
  const utcDate = Date.UTC(
    effectiveDate.getFullYear(),
    effectiveDate.getMonth(),
    effectiveDate.getDate(),
  );
  const utcAnchor = Date.UTC(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  const diffDays = Math.floor((utcDate - utcAnchor) / (24 * 60 * 60 * 1000));
  const cycleIndex = Math.floor(diffDays / 14);

  const week1Start = new Date(anchor);
  week1Start.setDate(anchor.getDate() + cycleIndex * 14);
  week1Start.setHours(0, 0, 0, 0);

  const week2Start = new Date(week1Start);
  week2Start.setDate(week1Start.getDate() + 7);
  week2Start.setHours(0, 0, 0, 0);

  return { week1Start, week2Start };
}

export function formatNameLastFirst(fullName) {
  if (!fullName) return '';
  if (fullName.includes(',')) return fullName;
  const parts = fullName.trim().split(/\s+/);
  if (parts.length < 2) return fullName;
  const lastName = parts.pop();
  return `${lastName}, ${parts.join(' ')}`;
}

// --- Calculation Utilities ---
export function calculateTotalHoursForLogs(logsArray) {
  let totalMs = 0;
  let currentStatus = 'OUT';
  let lastIn = null;
  logsArray.forEach((log) => {
    if (log.action === 'TIMESHEET_APPROVED') return;
    const time = new Date(log.created_at).getTime();
    if (log.action === 'IN' || log.action === 'END_LUNCH' || log.action === 'CLOCK_IN') {
      currentStatus = 'IN';
      lastIn = time;
    } else if (log.action === 'OUT' || log.action === 'START_LUNCH' || log.action === 'CLOCK_OUT') {
      if (currentStatus === 'IN' && lastIn) totalMs += time - lastIn;
      currentStatus = 'OUT';
    }
  });
  return totalMs / (1000 * 60 * 60);
}

export function calculateEstimatedTaxes(grossPay, taxStatus, isSalary, payPeriod = 26) {
  if (!grossPay || grossPay <= 0) return 0;
  const annualGross = isSalary ? grossPay : grossPay * payPeriod;
  const ficaTaxAnnual = annualGross * 0.0765;

  let standardDeduction = 14600;
  let brackets = [
    { limit: 11600, rate: 0.1 },
    { limit: 47150, rate: 0.12 },
    { limit: 100525, rate: 0.22 },
    { limit: 191950, rate: 0.24 },
    { limit: 243725, rate: 0.32 },
    { limit: 609350, rate: 0.35 },
    { limit: Infinity, rate: 0.37 },
  ];

  if (taxStatus === 'Married Filing Jointly') {
    standardDeduction = 29200;
    brackets = [
      { limit: 23200, rate: 0.1 },
      { limit: 94300, rate: 0.12 },
      { limit: 201050, rate: 0.22 },
      { limit: 383900, rate: 0.24 },
      { limit: 487450, rate: 0.32 },
      { limit: 731200, rate: 0.35 },
      { limit: Infinity, rate: 0.37 },
    ];
  } else if (taxStatus === 'Head of Household') {
    standardDeduction = 21900;
    brackets = [
      { limit: 16550, rate: 0.1 },
      { limit: 63100, rate: 0.12 },
      { limit: 100500, rate: 0.22 },
      { limit: 191950, rate: 0.24 },
      { limit: 243700, rate: 0.32 },
      { limit: 609350, rate: 0.35 },
      { limit: Infinity, rate: 0.37 },
    ];
  }

  const taxableIncome = Math.max(0, annualGross - standardDeduction);
  let federalTaxAnnual = 0;
  let previousLimit = 0;
  for (const bracket of brackets) {
    if (taxableIncome <= previousLimit) break;
    const amt = Math.min(taxableIncome - previousLimit, bracket.limit - previousLimit);
    federalTaxAnnual += amt * bracket.rate;
    previousLimit = bracket.limit;
  }

  const totalAnnualTax = ficaTaxAnnual + federalTaxAnnual;
  return isSalary ? totalAnnualTax : totalAnnualTax / payPeriod;
}

export function calculatePayWithOvertime(weekHrsArray, rate) {
  let total = 0;
  for (const hrs of weekHrsArray) {
    total += Math.min(40, hrs) * rate + Math.max(0, hrs - 40) * rate * 1.5;
  }
  return total;
}

// --- Geolocation ---
// A reading fuzzier than this is treated as unusable regardless of the geofence
// radius. Decoupled from the radius so a tight geofence doesn't reject normal
// phone GPS (which is typically accurate to ~5-65 m but can drift indoors).
const MAX_GPS_ACCURACY_METERS = 150;

export function getDistanceInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function checkLocation() {
  return new Promise((resolve, reject) => {
    if (!state.GEOFENCE_ENABLED) {
      resolve(null);
      return;
    }
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser.'));
      return;
    }
    showToast('Verifying your location...');
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        // GPS accuracy (how fuzzy the reading is) and the geofence radius (how
        // close to the site you must be) are independent concepts — the old
        // code compared accuracy directly against the radius, so tightening the
        // radius would start rejecting normal punches as "signal too weak."
        // Gate weak signal on its own threshold, never stricter than the radius.
        const accuracyLimit = Math.max(state.ALLOWED_RADIUS_METERS, MAX_GPS_ACCURACY_METERS);
        if (accuracy > accuracyLimit) {
          const accFt = Math.round(accuracy * 3.28084);
          reject(
            new Error(
              `GPS signal too weak to verify location (accuracy: ~${accFt} ft). Step outside and try again.`,
            ),
          );
          return;
        }
        const dist = getDistanceInMeters(
          state.CAR_WASH_LAT,
          state.CAR_WASH_LON,
          latitude,
          longitude,
        );
        // Give the reading the benefit of its own accuracy margin: allow the
        // punch if the employee could plausibly be within the radius.
        if (dist - accuracy <= state.ALLOWED_RADIUS_METERS) {
          resolve({ lat: latitude, lon: longitude, accuracy });
        } else {
          const feetAway = Math.round(dist * 3.28084);
          reject(new Error(`You are too far away! (${feetAway} feet from the site)`));
        }
      },
      (error) => {
        const msgs = {
          1: 'Please allow location access to clock in.',
          2: 'Location unavailable (GPS signal lost).',
          3: 'Location request timed out.',
        };
        reject(new Error(msgs[error.code] || 'Could not get location.'));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  });
}

// --- Schedule Parsing ---
// Store hours (America/Chicago): Mon–Sat 7am–8pm, Sunday 7am–6pm.
// Schedule cells are often typed without am/pm ("7-8", "1-8", "10-6").
export const STORE_OPEN_HOUR = 7;
export const STORE_CLOSE_HOUR_WEEKDAY = 20; // 8pm
export const STORE_CLOSE_HOUR_SUNDAY = 18; // 6pm

function parseShiftTimePart(timeStr) {
  let t = String(timeStr || '')
    .toLowerCase()
    .replace(/\s+/g, '');
  if (!t) return null;
  const isPM = t.includes('pm') || (t.endsWith('p') && !t.endsWith('am'));
  const isAM = t.includes('am') || (t.endsWith('a') && !t.includes('pm'));
  t = t.replace(/[a-z]/g, '');
  const [hStr, mStr] = t.split(':');
  let h = parseInt(hStr, 10);
  let m = parseInt(mStr || '0', 10);
  if (isNaN(h)) return null;
  if (isNaN(m)) m = 0;
  return { hour: h, minute: m, explicitAmPm: isAM || isPM, isAM, isPM };
}

function applyExplicitAmPm(part) {
  let h = part.hour;
  if (part.isPM && h !== 12) h += 12;
  if (part.isAM && h === 12) h = 0;
  return h;
}

function inferBareEndHour(startH, endH) {
  if (endH <= startH) return endH + 12;
  if (endH - startH <= 5 && endH <= 11) return endH + 12;
  return endH;
}

/**
 * Resolve a shift string into 24h start/end.
 * Bare afternoon forms like "1-8" / "2-8" mean 1pm–8pm (not 1am–8am).
 */
export function parseShiftTimes(shiftStr) {
  if (!shiftStr || typeof shiftStr !== 'string') return null;
  const s = shiftStr.trim();
  if (!s || s === '-' || s.toUpperCase() === 'OFF' || s.toUpperCase() === 'OC') return null;
  const parts = s.split(/\s*[-–]\s*/);
  if (parts.length < 2) return null;

  const startPart = parseShiftTimePart(parts[0]);
  const endPart = parseShiftTimePart(parts[parts.length - 1]);
  if (!startPart || !endPart) return null;

  let startH;
  let endH;
  const startMin = startPart.minute;
  const endMin = endPart.minute;

  if (startPart.explicitAmPm && endPart.explicitAmPm) {
    startH = applyExplicitAmPm(startPart);
    endH = applyExplicitAmPm(endPart);
  } else if (!startPart.explicitAmPm && !endPart.explicitAmPm) {
    // "1-8", "2-8", "6-8" → afternoon/evening (both PM). Car wash does not
    // run 1am–8am shifts; opening is 7am.
    if (
      startPart.hour >= 1 &&
      startPart.hour <= 6 &&
      endPart.hour >= 7 &&
      endPart.hour <= 11 &&
      endPart.hour > startPart.hour
    ) {
      startH = startPart.hour + 12;
      endH = endPart.hour + 12;
    } else {
      startH = startPart.hour === 12 ? 12 : startPart.hour;
      endH = inferBareEndHour(startH, endPart.hour);
    }
  } else if (!endPart.explicitAmPm) {
    // "1pm-8", "7am-8", "10am-6"
    startH = applyExplicitAmPm(startPart);
    endH = inferBareEndHour(startH, endPart.hour);
  } else {
    // "1-8pm", "7-8pm"
    endH = applyExplicitAmPm(endPart);
    startH = startPart.hour === 12 ? 12 : startPart.hour;
    // Prefer PM start when a bare morning hour would make an absurdly long shift.
    if (startH >= 1 && startH <= 6 && endH >= 12 && endH - startH > 12) {
      startH += 12;
    }
  }

  // One more overnight bump for explicit ends that cross midnight (7pm-1am).
  if (endH < startH || (endH === startH && endMin < startMin)) {
    // leave as overnight; consumer uses isOvernight
  }

  const start = { hour: startH, minute: startMin };
  const end = { hour: endH, minute: endMin };
  const isOvernight = end.hour < start.hour || (end.hour === start.hour && end.minute < start.minute);
  return { start, end, isOvernight };
}

export function parseShiftStartTime(shiftStr) {
  const times = parseShiftTimes(shiftStr);
  return times ? times.start : null;
}

export function parseShiftEndTime(shiftStr) {
  const times = parseShiftTimes(shiftStr);
  return times ? times.end : null;
}

export function parseShiftHours(shiftStr) {
  const times = parseShiftTimes(shiftStr);
  if (!times) return 0;
  let start = times.start.hour + times.start.minute / 60;
  let end = times.end.hour + times.end.minute / 60;
  if (times.isOvernight) end += 24;
  return Math.max(0, end - start);
}

export function getChicagoIsoString(dateStr, hour, minute = 0, second = 0, millisecond = 0) {
  const pad = (n) => String(n).padStart(2, '0');
  const padMs = (n) => String(n).padStart(3, '0');
  const timePart = `${pad(hour)}:${pad(minute)}:${pad(second)}.${padMs(millisecond)}`;

  let candidate = new Date(`${dateStr}T${timePart}-05:00`);
  const candDay = candidate.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  const candHour = parseInt(
    candidate.toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }),
    10,
  );
  if (candDay === dateStr && candHour === hour) {
    return candidate.toISOString();
  }
  candidate = new Date(`${dateStr}T${timePart}-06:00`);
  return candidate.toISOString();
}

/** Closing hour in America/Chicago for the given YYYY-MM-DD calendar day. */
export function getStoreCloseHour(dateStr) {
  const dow = new Date(`${dateStr}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: 'America/Chicago',
  });
  return dow === 'Sun' ? STORE_CLOSE_HOUR_SUNDAY : STORE_CLOSE_HOUR_WEEKDAY;
}

/**
 * Match a schedule header to a calendar day in America/Chicago.
 * Prefer M/D date match (safe across weeks). Weekday-only matching is only
 * allowed when the schedule has no dated headers — otherwise "Fri" on next
 * week's grid would steal this Friday's shift and auto-sweep at the wrong time.
 */
export function findScheduleDayIndex(headers, logDate, timeZone = 'America/Chicago') {
  if (!headers?.length || !logDate) return -1;
  const mo = parseInt(logDate.toLocaleDateString('en-US', { timeZone, month: 'numeric' }), 10);
  const dy = parseInt(logDate.toLocaleDateString('en-US', { timeZone, day: 'numeric' }), 10);
  const dayAbbr = logDate
    .toLocaleDateString('en-US', { timeZone, weekday: 'short' })
    .toUpperCase();

  const list = headers.map((h) => (h == null ? '' : h.toString()));
  const datedIdx = list.findIndex((hStr) => {
    const m = hStr.match(/(\d{1,2})\/(\d{1,2})/);
    return !!(m && parseInt(m[1], 10) === mo && parseInt(m[2], 10) === dy);
  });
  if (datedIdx >= 0) return datedIdx;

  const anyDated = list.some((hStr) => /\d{1,2}\/\d{1,2}/.test(hStr));
  if (anyDated) return -1;

  return list.findIndex((hStr) => hStr.toUpperCase().startsWith(dayAbbr));
}

/**
 * Resolve an employee's shift string for the day of `logDate` from recent
 * schedule rows. Schedules are expected newest-first. Once a schedule whose
 * headers cover that calendar day is found and lists the employee, that cell
 * wins — even when OFF/blank — so we never fall through to another week's Fri.
 */
export function findShiftForUser(schedules, employeeName, logDate, timeZone = 'America/Chicago') {
  if (!schedules?.length || !employeeName || !logDate) return null;
  const targetName = employeeName.trim().toLowerCase();
  if (!targetName) return null;

  for (const sched of schedules) {
    try {
      const parsed = typeof sched.content === 'string' ? JSON.parse(sched.content) : sched.content;
      if (!parsed) continue;
      const dayIdx = findScheduleDayIndex(parsed.headers || [], logDate, timeZone);
      if (dayIdx < 0) continue;

      const myRow = (parsed.rows || []).find(
        (r) => r.employee?.trim().toLowerCase() === targetName,
      );
      if (!myRow) continue;

      return myRow.shifts?.[dayIdx] || null;
    } catch {
      // ignore bad schedule JSON
    }
  }
  return null;
}

export function getAutoOutIso(logDate, shiftStr) {
  const TZ = 'America/Chicago';
  const logDay = logDate.toLocaleDateString('en-CA', { timeZone: TZ });

  if (shiftStr) {
    const shiftTimes = parseShiftTimes(shiftStr);
    if (shiftTimes) {
      let targetDay = logDay;
      if (shiftTimes.isOvernight) {
        const d = new Date(`${logDay}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        targetDay = d.toISOString().split('T')[0];
      }
      return getChicagoIsoString(targetDay, shiftTimes.end.hour, shiftTimes.end.minute, 0, 0);
    }
  }

  const inHour = parseInt(
    logDate.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }),
    10,
  );
  const inMin = parseInt(
    logDate.toLocaleTimeString('en-US', { timeZone: TZ, minute: 'numeric' }),
    10,
  );

  const closeHour = getStoreCloseHour(logDay);
  let targetDay = logDay;
  let outHour;
  let outMin;

  if (inHour < closeHour) {
    // No schedule (or unparseable): close at store hours. Do NOT use clock-in+8
    // — a 6am open punch would land at 2pm and cut a till-8pm worker short when
    // schedule lookup misses.
    outHour = closeHour;
    outMin = 0;
  } else {
    outHour = (inHour + 8) % 24;
    outMin = inMin;
    if (inHour + 8 >= 24) {
      const d = new Date(`${logDay}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      targetDay = d.toISOString().split('T')[0];
    }
  }

  return getChicagoIsoString(targetDay, outHour, outMin, 0, 0);
}

export function hasForgottenClockOut(logDate, shiftStr, now = new Date()) {
  const elapsedMs = now.getTime() - logDate.getTime();
  const elapsedHours = elapsedMs / (1000 * 60 * 60);

  if (elapsedHours < 2) return false;

  const autoOutIso = getAutoOutIso(logDate, shiftStr);
  const autoOutTime = new Date(autoOutIso).getTime();
  const GRACE_MS = 2 * 60 * 60 * 1000;

  if (now.getTime() >= autoOutTime + GRACE_MS) {
    return true;
  }

  if (elapsedHours >= 14) return true;

  return false;
}

// --- CSV Download Helper ---
export function downloadCsv(csvContent, filename) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// --- Save Setting (upsert) ---
export async function saveSettingRobust(key, value) {
  const db = window.supabaseClient;
  const { data, error: updateErr } = await db
    .from('settings')
    .update({ value })
    .eq('id', key)
    .select();
  if (!updateErr && data && data.length > 0) return true;
  await db.from('settings').delete().eq('id', key);
  const { error: insertErr } = await db.from('settings').insert({ id: key, value });
  if (insertErr) throw insertErr;
  return true;
}
