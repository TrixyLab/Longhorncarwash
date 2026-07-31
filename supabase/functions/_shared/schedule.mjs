// Shared schedule day / shift lookup for Supabase edge functions.
// Keep findScheduleDayIndex / findShiftForUser in sync with modules/utils.js.
// Keep parseShiftTimes rules in sync with modules/utils.js parseShiftTimes.

export const TZ = 'America/Chicago';
export const SYSTEM_AUTO_SWEEP_LABEL = 'System Auto-Sweep';

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
