// Shared schedule day / shift lookup for Supabase edge functions.
// Keep findScheduleDayIndex / findShiftForUser in sync with modules/utils.js.
// Keep parseShiftTimes rules in sync with modules/utils.js parseShiftTimes.

export const TZ = 'America/Chicago';
export const SYSTEM_AUTO_SWEEP_LABEL = 'System Auto-Sweep';
export const AUTO_SWEEP_CLEARED_ACTION = 'AUTO_SWEEP_CLEARED';
export const STORE_CLOSE_HOUR_WEEKDAY = 20;
export const STORE_CLOSE_HOUR_SUNDAY = 18;

/**
 * Match a schedule header to a calendar day.
 * Prefer M/D date match. Weekday-only only when the grid has no dates —
 * otherwise next week's "Fri" steals this Friday's shift.
 */
export function findScheduleDayIndex(headers, logDate, timeZone = TZ) {
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
 * Resolve an employee's shift string for the day of `logDate`.
 * Schedules newest-first. Once today's week lists the employee, that cell wins
 * (including OFF) — never fall through to another week's same weekday.
 */
export function findShiftForUser(schedules, employeeName, logDate, timeZone = TZ) {
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
      /* ignore bad schedule JSON */
    }
  }
  return null;
}

function parseTimePart(timeStr) {
  let t = String(timeStr || '')
    .toLowerCase()
    .replace(/\s+/g, '');
  if (!t) return null;
  const isPM = t.includes('pm') || (t.endsWith('p') && !t.endsWith('am'));
  const isAM = t.includes('am') || (t.endsWith('a') && !t.includes('pm'));
  t = t.replace(/[a-z]/g, '');
  const [hStr, mStr] = t.split(':');
  const h = parseInt(hStr, 10);
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

/** Resolve shift string to start/end minutes-from-midnight (same AM/PM rules as utils). */
export function parseShift(raw) {
  if (!raw || /^(off|-|oc)$/i.test(String(raw).trim()) || !String(raw).trim()) return null;
  const pts = String(raw).split(/\s*[-–]\s*/);
  if (pts.length < 2) return null;
  const startPart = parseTimePart(pts[0]);
  const endPart = parseTimePart(pts[pts.length - 1]);
  if (!startPart || !endPart) return null;

  let startH;
  let endH;

  if (startPart.explicitAmPm && endPart.explicitAmPm) {
    startH = applyExplicitAmPm(startPart);
    endH = applyExplicitAmPm(endPart);
  } else if (!startPart.explicitAmPm && !endPart.explicitAmPm) {
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
    startH = applyExplicitAmPm(startPart);
    endH = inferBareEndHour(startH, endPart.hour);
  } else {
    endH = applyExplicitAmPm(endPart);
    startH = startPart.hour === 12 ? 12 : startPart.hour;
    if (startH >= 1 && startH <= 6 && endH >= 12 && endH - startH > 12) {
      startH += 12;
    }
  }

  const endMinOfDay = endH * 60 + endPart.minute;
  let endMins = endMinOfDay;
  const startMins = startH * 60 + startPart.minute;
  // Overnight shifts (7pm-1am): attendance compares wall-clock mins and needs
  // end after start, otherwise "forgot" fires all evening.
  if (endMins <= startMins) endMins += 24 * 60;

  return { s: startMins, e: endMins };
}

export function formatShiftMins(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** Keep in sync with modules/utils.js parseShiftTimes. */
export function parseShiftTimes(shiftStr) {
  if (!shiftStr || typeof shiftStr !== 'string') return null;
  const s = shiftStr.trim();
  if (!s || s === '-' || s.toUpperCase() === 'OFF' || s.toUpperCase() === 'OC') return null;
  const parts = s.split(/\s*[-–]\s*/);
  if (parts.length < 2) return null;
  const startPart = parseTimePart(parts[0]);
  const endPart = parseTimePart(parts[parts.length - 1]);
  if (!startPart || !endPart) return null;

  let startH;
  let endH;
  const startMin = startPart.minute;
  const endMin = endPart.minute;

  if (startPart.explicitAmPm && endPart.explicitAmPm) {
    startH = applyExplicitAmPm(startPart);
    endH = applyExplicitAmPm(endPart);
  } else if (!startPart.explicitAmPm && !endPart.explicitAmPm) {
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
    startH = applyExplicitAmPm(startPart);
    endH = inferBareEndHour(startH, endPart.hour);
  } else {
    endH = applyExplicitAmPm(endPart);
    startH = startPart.hour === 12 ? 12 : startPart.hour;
    if (startH >= 1 && startH <= 6 && endH >= 12 && endH - startH > 12) startH += 12;
  }

  const start = { hour: startH, minute: startMin };
  const end = { hour: endH, minute: endMin };
  const isOvernight = end.hour < start.hour || (end.hour === start.hour && end.minute < start.minute);
  return { start, end, isOvernight };
}

export function getChicagoIsoString(dateStr, hour, minute = 0, second = 0, millisecond = 0) {
  const pad = (n) => String(n).padStart(2, '0');
  const padMs = (n) => String(n).padStart(3, '0');
  const timePart = `${pad(hour)}:${pad(minute)}:${pad(second)}.${padMs(millisecond)}`;
  let candidate = new Date(`${dateStr}T${timePart}-05:00`);
  const candDay = candidate.toLocaleDateString('en-CA', { timeZone: TZ });
  const candHour = parseInt(
    candidate.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }),
    10,
  );
  if (candDay === dateStr && candHour === hour) return candidate.toISOString();
  candidate = new Date(`${dateStr}T${timePart}-06:00`);
  return candidate.toISOString();
}

export function getStoreCloseHour(dateStr) {
  const dow = new Date(`${dateStr}T12:00:00Z`).toLocaleDateString('en-US', {
    weekday: 'short',
    timeZone: TZ,
  });
  return dow === 'Sun' ? STORE_CLOSE_HOUR_SUNDAY : STORE_CLOSE_HOUR_WEEKDAY;
}

function storeCloseAutoOutIso(logDate) {
  const logDay = logDate.toLocaleDateString('en-CA', { timeZone: TZ });
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

/** Keep in sync with modules/utils.js getAutoOutIso. */
export function getAutoOutIso(logDate, shiftStr) {
  const logDay = logDate.toLocaleDateString('en-CA', { timeZone: TZ });
  const inMs = logDate.getTime();
  if (shiftStr) {
    const shiftTimes = parseShiftTimes(shiftStr);
    if (shiftTimes) {
      let targetDay = logDay;
      if (shiftTimes.isOvernight) {
        const d = new Date(`${logDay}T12:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        targetDay = d.toISOString().split('T')[0];
      }
      const scheduledIso = getChicagoIsoString(
        targetDay,
        shiftTimes.end.hour,
        shiftTimes.end.minute,
        0,
        0,
      );
      if (new Date(scheduledIso).getTime() > inMs) return scheduledIso;
      return storeCloseAutoOutIso(logDate);
    }
  }
  return storeCloseAutoOutIso(logDate);
}

/** Keep in sync with modules/utils.js hasForgottenClockOut. */
export function hasForgottenClockOut(logDate, shiftStr, now = new Date()) {
  const elapsedHours = (now.getTime() - logDate.getTime()) / (1000 * 60 * 60);
  if (elapsedHours < 2) return false;
  const autoOutTime = new Date(getAutoOutIso(logDate, shiftStr)).getTime();
  if (now.getTime() >= autoOutTime + 2 * 60 * 60 * 1000) return true;
  const scheduled = shiftStr ? parseShiftTimes(shiftStr) : null;
  if (!scheduled && elapsedHours >= 14) return true;
  return false;
}

/** Keep in sync with modules/utils.js isSafeAutoSweepOutInsert. */
export function isSafeAutoSweepOutInsert(openInCreatedAt, autoOutIso, laterPunches = []) {
  const inMs = new Date(openInCreatedAt).getTime();
  const outMs = new Date(autoOutIso).getTime();
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs)) return false;
  if (outMs <= inMs) return false;
  for (const punch of laterPunches || []) {
    const t = new Date(punch.created_at).getTime();
    if (!Number.isFinite(t)) continue;
    if (t > inMs && t > outMs) return false;
  }
  return true;
}
