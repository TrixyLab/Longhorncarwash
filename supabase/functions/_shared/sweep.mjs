// Shared auto-sweep math for Supabase edge functions.
// Keep in sync with modules/utils.js parseShiftTimes / getAutoOutIso / hasForgottenClockOut.

export const SYSTEM_AUTO_SWEEP_LABEL = 'System Auto-Sweep';
export const AUTO_SWEEP_CLEARED_ACTION = 'AUTO_SWEEP_CLEARED';
export const STORE_CLOSE_HOUR_WEEKDAY = 20;
export const STORE_CLOSE_HOUR_SUNDAY = 18;
export const TZ = 'America/Chicago';

function parseShiftTimePart(timeStr) {
  let t = String(timeStr || '').toLowerCase().replace(/\s+/g, '');
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
    if (
      startPart.hour >= 1 && startPart.hour <= 6 &&
      endPart.hour >= 7 && endPart.hour <= 11 &&
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

export function getAutoOutIso(logDate, shiftStr) {
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
    const plus8 = inHour + 8;
    if (plus8 < closeHour) {
      outHour = plus8;
      outMin = inMin;
    } else {
      outHour = closeHour;
      outMin = 0;
    }
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
  const elapsedHours = (now.getTime() - logDate.getTime()) / (1000 * 60 * 60);
  if (elapsedHours < 2) return false;
  const autoOutTime = new Date(getAutoOutIso(logDate, shiftStr)).getTime();
  if (now.getTime() >= autoOutTime + 2 * 60 * 60 * 1000) return true;
  if (elapsedHours >= 14) return true;
  return false;
}

export function findShiftForUser(schedules, employeeName, logDate) {
  if (!schedules?.length || !employeeName) return null;
  const mo = parseInt(logDate.toLocaleDateString('en-US', { timeZone: TZ, month: 'numeric' }), 10);
  const dy = parseInt(logDate.toLocaleDateString('en-US', { timeZone: TZ, day: 'numeric' }), 10);
  const dayAbbr = logDate.toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' });
  for (const sched of schedules) {
    try {
      const parsed = typeof sched.content === 'string' ? JSON.parse(sched.content) : sched.content;
      const myRow = parsed.rows?.find(
        (r) => r.employee?.trim().toLowerCase() === employeeName.trim().toLowerCase(),
      );
      if (!myRow) continue;
      const dayIdx = (parsed.headers || []).findIndex((h) => {
        if (!h) return false;
        const hStr = h.toString();
        if (hStr.toUpperCase().startsWith(dayAbbr.toUpperCase())) return true;
        const m = hStr.match(/(\d{1,2})\/(\d{1,2})/);
        if (m && parseInt(m[1], 10) === mo && parseInt(m[2], 10) === dy) return true;
        return false;
      });
      if (dayIdx >= 0) {
        const shift = myRow.shifts?.[dayIdx] || null;
        if (shift) return shift;
      }
    } catch {
      /* ignore bad schedule JSON */
    }
  }
  return null;
}
