import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateTotalHoursForLogs,
  calculateEstimatedTaxes,
  calculatePayWithOvertime,
  formatNameLastFirst,
  parseShiftHours,
  parseShiftStartTime,
  parseShiftEndTime,
  getChicagoIsoString,
  getAutoOutIso,
  hasForgottenClockOut,
  findScheduleDayIndex,
  findShiftForUser,
  isSafeAutoSweepOutInsert,
  pickOpenInCreatedAtForSweepOut,
  getStartOfWeek,
  getBiweeklyWeeks,
  getDistanceInMeters,
  getPunchTransitionError,
  getMissedPunchRequestError,
  buildAutoSweepClearedRow,
  AUTO_SWEEP_CLEARED_ACTION,
  formatShiftTimes,
  normalizeScheduleCellValue,
  isPrivateOrLocalIp,
  isWifiIpAllowed,
  getWifiLockFailureReason,
} from '../modules/utils.js';

const log = (action, t) => ({ action, created_at: t });
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~= ${b}`);

test('calculateTotalHoursForLogs: pairs in/out into worked hours', () => {
  const logs = [log('IN', '2026-07-01T09:00:00Z'), log('OUT', '2026-07-01T17:00:00Z')];
  assert.equal(calculateTotalHoursForLogs(logs), 8);
});

test('calculateTotalHoursForLogs: CLOCK_IN/CLOCK_OUT aliases count', () => {
  const logs = [log('CLOCK_IN', '2026-07-01T09:00:00Z'), log('CLOCK_OUT', '2026-07-01T13:00:00Z')];
  assert.equal(calculateTotalHoursForLogs(logs), 4);
});

test('calculateTotalHoursForLogs: TIMESHEET_APPROVED rows are ignored', () => {
  const logs = [
    log('IN', '2026-07-01T09:00:00Z'),
    log('TIMESHEET_APPROVED', '2026-07-01T10:00:00Z'),
    log('OUT', '2026-07-01T17:00:00Z'),
  ];
  assert.equal(calculateTotalHoursForLogs(logs), 8);
});

test('calculatePayWithOvertime: straight time under 40h', () => {
  assert.equal(calculatePayWithOvertime([40], 10), 400);
});

test('calculatePayWithOvertime: overtime past 40h pays 1.5x', () => {
  // 40*10 + 10*15 = 550
  assert.equal(calculatePayWithOvertime([50], 10), 550);
});

test('calculatePayWithOvertime: sums multiple weeks independently', () => {
  // (40*10 + 5*15) + (30*10) = 475 + 300 = 775
  assert.equal(calculatePayWithOvertime([45, 30], 10), 775);
});

test('calculateEstimatedTaxes: zero or negative gross is zero', () => {
  assert.equal(calculateEstimatedTaxes(0, 'Single', true), 0);
  assert.equal(calculateEstimatedTaxes(-100, 'Single', true), 0);
});

test('calculateEstimatedTaxes: single filer salary, known brackets', () => {
  // annual 100000; FICA 7650; taxable 85400 → fed 13841; total 21491
  close(calculateEstimatedTaxes(100000, 'Single', true), 21491);
});

test('calculateEstimatedTaxes: married bracket differs from single', () => {
  const single = calculateEstimatedTaxes(100000, 'Single', true);
  const married = calculateEstimatedTaxes(100000, 'Married Filing Jointly', true);
  assert.ok(married < single, 'married-filing-jointly should owe less than single at 100k');
});

test('formatNameLastFirst: reorders to "Last, First"', () => {
  assert.equal(formatNameLastFirst('John Smith'), 'Smith, John');
});

test('formatNameLastFirst: leaves already-formatted names alone', () => {
  assert.equal(formatNameLastFirst('Smith, John'), 'Smith, John');
});

test('formatNameLastFirst: single token and empty are passed through', () => {
  assert.equal(formatNameLastFirst('Cher'), 'Cher');
  assert.equal(formatNameLastFirst(''), '');
});

test('parseShiftHours: explicit am/pm span', () => {
  assert.equal(parseShiftHours('9am-5pm'), 8);
});

test('parseShiftHours: bare numbers infer pm end', () => {
  assert.equal(parseShiftHours('9-5'), 8);
});

test('parseShiftHours: afternoon bare form 1-8 is 1pm-8pm', () => {
  assert.equal(parseShiftHours('1-8'), 7);
  assert.equal(parseShiftHours('2-8'), 6);
});

test('parseShiftHours: full-day bare form 7-8 is 7am-8pm', () => {
  assert.equal(parseShiftHours('7-8'), 13);
});

test('parseShiftHours: off/blank days are zero', () => {
  assert.equal(parseShiftHours('OFF'), 0);
  assert.equal(parseShiftHours('-'), 0);
  assert.equal(parseShiftHours(''), 0);
});

test('parseShiftStartTime: returns 24h hour/minute', () => {
  assert.deepEqual(parseShiftStartTime('9am-5pm'), { hour: 9, minute: 0 });
  assert.deepEqual(parseShiftStartTime('2:30pm-6pm'), { hour: 14, minute: 30 });
});

test('parseShiftStartTime: afternoon bare form uses PM start', () => {
  assert.deepEqual(parseShiftStartTime('1-8'), { hour: 13, minute: 0 });
  assert.deepEqual(parseShiftStartTime('2-8'), { hour: 14, minute: 0 });
});

test('parseShiftStartTime: off/invalid returns null', () => {
  assert.equal(parseShiftStartTime('OFF'), null);
  assert.equal(parseShiftStartTime(''), null);
});

test('parseShiftEndTime: returns 24h hour/minute for end of shift', () => {
  assert.deepEqual(parseShiftEndTime('9am-5pm'), { hour: 17, minute: 0 });
  assert.deepEqual(parseShiftEndTime('9-5'), { hour: 17, minute: 0 });
  assert.deepEqual(parseShiftEndTime('8:30am-4:30pm'), { hour: 16, minute: 30 });
  assert.deepEqual(parseShiftEndTime('10am-6pm'), { hour: 18, minute: 0 });
});

test('parseShiftEndTime: bare and partial am/pm ends resolve to evening', () => {
  assert.deepEqual(parseShiftEndTime('7-8'), { hour: 20, minute: 0 });
  assert.deepEqual(parseShiftEndTime('7am-8'), { hour: 20, minute: 0 });
  assert.deepEqual(parseShiftEndTime('1-8'), { hour: 20, minute: 0 });
  assert.deepEqual(parseShiftEndTime('1pm-8'), { hour: 20, minute: 0 });
  assert.deepEqual(parseShiftEndTime('10am-6'), { hour: 18, minute: 0 });
  assert.deepEqual(parseShiftEndTime('7-6'), { hour: 18, minute: 0 });
});

test('parseShiftEndTime: off/invalid returns null', () => {
  assert.equal(parseShiftEndTime('OFF'), null);
  assert.equal(parseShiftEndTime('-'), null);
  assert.equal(parseShiftEndTime(''), null);
});

test('getChicagoIsoString: generates accurate UTC ISO string for Chicago time', () => {
  // July 21 is Daylight Saving Time (CDT, UTC-5)
  const dtJul = getChicagoIsoString('2026-07-21', 17, 0, 0, 0);
  assert.equal(dtJul, '2026-07-21T22:00:00.000Z');

  // Jan 15 is Standard Time (CST, UTC-6)
  const dtJan = getChicagoIsoString('2026-01-15', 17, 0, 0, 0);
  assert.equal(dtJan, '2026-01-15T23:00:00.000Z');
});

test('hasForgottenClockOut: returns false during active shift and grace period', () => {
  const clockIn = new Date('2026-07-21T14:00:00Z'); // 9:00 AM CDT
  const shiftStr = '9am-5pm'; // scheduled end = 5:00 PM CDT (22:00 UTC)

  // 1:00 PM CDT (18:00 UTC) -> middle of shift
  assert.equal(hasForgottenClockOut(clockIn, shiftStr, new Date('2026-07-21T18:00:00Z')), false);

  // 5:30 PM CDT (22:30 UTC) -> 30 mins past end, within 2h grace
  assert.equal(hasForgottenClockOut(clockIn, shiftStr, new Date('2026-07-21T22:30:00Z')), false);

  // 7:05 PM CDT (00:05 UTC July 22) -> >2h past end -> forgotten!
  assert.equal(hasForgottenClockOut(clockIn, shiftStr, new Date('2026-07-22T00:05:00Z')), true);
});

test('getAutoOutIso: calculates correct scheduled end timestamp', () => {
  const clockIn = new Date('2026-07-21T14:00:00Z'); // 9:00 AM CDT
  const iso = getAutoOutIso(clockIn, '9am-5pm');
  assert.equal(iso, '2026-07-21T22:00:00.000Z'); // 5:00 PM CDT
});

test('getAutoOutIso: afternoon bare shift 1-8 ends at 8pm not 8am', () => {
  // Regression: Makhi-style 1:59 PM clock-in with schedule "1-8"
  const clockIn = new Date('2026-07-27T18:59:00Z'); // 1:59 PM CDT
  const iso = getAutoOutIso(clockIn, '1-8');
  assert.equal(iso, '2026-07-28T01:00:00.000Z'); // 8:00 PM CDT Jul 27
});

test('getAutoOutIso: unscheduled weekday fallback caps at 8pm store close', () => {
  const clockIn = new Date('2026-07-27T18:59:00Z'); // Mon 1:59 PM CDT
  const iso = getAutoOutIso(clockIn, null);
  assert.equal(iso, '2026-07-28T01:00:00.000Z'); // 8:00 PM CDT
});

test('getAutoOutIso: unscheduled early morning does NOT use clock-in+8 (2pm)', () => {
  // Regression: missing schedule + ~6am IN used to stamp System Auto-Sweep at 2pm
  // while the employee was still scheduled till 8pm.
  const clockIn = new Date('2026-07-31T11:00:00Z'); // Fri 6:00 AM CDT
  const iso = getAutoOutIso(clockIn, null);
  assert.equal(iso, '2026-08-01T01:00:00.000Z'); // 8:00 PM CDT Jul 31
});

test('getAutoOutIso: never stamps OUT before the open IN', () => {
  // Afternoon cover while the cell still says morning 7-2.
  const clockIn = new Date('2026-07-31T20:00:00Z'); // Fri 3:00 PM CDT
  const iso = getAutoOutIso(clockIn, '7-2');
  assert.equal(iso, '2026-08-01T01:00:00.000Z'); // store close 8pm, not 2pm before IN
});

test('hasForgottenClockOut: scheduled shift keeps 2h grace (no 14h bypass)', () => {
  const clockIn = new Date('2026-07-31T11:00:00Z'); // Fri 6:00 AM CDT
  const shiftStr = '7-8'; // end 8pm CDT = 2026-08-01T01:00:00Z
  // Exactly at scheduled end — still inside grace
  assert.equal(hasForgottenClockOut(clockIn, shiftStr, new Date('2026-08-01T01:00:00Z')), false);
  // 2h past end — forgotten
  assert.equal(hasForgottenClockOut(clockIn, shiftStr, new Date('2026-08-01T03:05:00Z')), true);
});

test('pickOpenInCreatedAtForSweepOut: ignores IN after the deleted OUT', () => {
  const outAt = '2026-07-30T01:00:00.000Z'; // Wed 8pm CDT
  const ins = [
    { created_at: '2026-07-30T12:00:00.000Z' }, // next morning — must not win
    { created_at: '2026-07-29T18:00:00.000Z' }, // real open IN
    { created_at: '2026-07-29T14:00:00.000Z' },
  ];
  assert.equal(pickOpenInCreatedAtForSweepOut(ins, outAt), '2026-07-29T18:00:00.000Z');
});

test('isSafeAutoSweepOutInsert: blocks OUT before open IN or before later punches', () => {
  const openIn = '2026-08-01T16:00:00.000Z'; // Sat 11am CDT
  const bad8am = '2026-08-01T13:00:00.000Z'; // Sat 8am CDT — before the IN
  const good8pm = '2026-08-02T01:00:00.000Z'; // Sat 8pm CDT
  assert.equal(isSafeAutoSweepOutInsert(openIn, bad8am, []), false);
  assert.equal(isSafeAutoSweepOutInsert(openIn, good8pm, []), true);
  // Xzaveon case: stale 8am out after a real 11am clock-in already on the sheet
  const friIn = '2026-07-31T15:00:00.000Z';
  const satIn = { created_at: '2026-08-01T16:00:15.000Z' };
  assert.equal(isSafeAutoSweepOutInsert(friIn, bad8am, [satIn]), false);
});

test('getAutoOutIso: unscheduled Sunday fallback caps at 6pm store close', () => {
  const clockIn = new Date('2026-07-26T18:00:00Z'); // Sun 1:00 PM CDT
  const iso = getAutoOutIso(clockIn, null);
  assert.equal(iso, '2026-07-26T23:00:00.000Z'); // 6:00 PM CDT
});

test('findScheduleDayIndex: prefers M/D over bare weekday across weeks', () => {
  const friJul31 = new Date('2026-07-31T18:00:00Z'); // Fri Jul 31 CDT afternoon
  const headersThisWeek = ['Wed 7/29', 'Thu 7/30', 'Fri 7/31', 'Sat 8/1', 'Sun 8/2', 'Mon 8/3', 'Tue 8/4'];
  const headersNextWeek = ['Wed 8/5', 'Thu 8/6', 'Fri 8/7', 'Sat 8/8', 'Sun 8/9', 'Mon 8/10', 'Tue 8/11'];
  assert.equal(findScheduleDayIndex(headersThisWeek, friJul31), 2);
  assert.equal(findScheduleDayIndex(headersNextWeek, friJul31), -1);
});

test('findShiftForUser: does not steal next week Friday morning end for this Friday', () => {
  const friJul31 = new Date('2026-07-31T18:00:00Z');
  const schedules = [
    {
      content: JSON.stringify({
        headers: ['Wed 8/5', 'Thu 8/6', 'Fri 8/7', 'Sat 8/8', 'Sun 8/9', 'Mon 8/10', 'Tue 8/11'],
        rows: [{ employee: 'Alex', shifts: ['OFF', 'OFF', '7-2', 'OFF', 'OFF', 'OFF', 'OFF'] }],
      }),
    },
    {
      content: JSON.stringify({
        headers: ['Wed 7/29', 'Thu 7/30', 'Fri 7/31', 'Sat 8/1', 'Sun 8/2', 'Mon 8/3', 'Tue 8/4'],
        rows: [{ employee: 'Alex', shifts: ['OFF', 'OFF', '1-8', 'OFF', 'OFF', 'OFF', 'OFF'] }],
      }),
    },
  ];
  // Old bug: weekday startsWith("Fri") matched Fri 8/7 first → "7-2" → auto-out 2pm.
  assert.equal(findShiftForUser(schedules, 'Alex', friJul31), '1-8');
  assert.equal(getAutoOutIso(friJul31, findShiftForUser(schedules, 'Alex', friJul31)), '2026-08-01T01:00:00.000Z');
});

test('findShiftForUser: OFF on the matching week does not fall through to last week', () => {
  const friJul31 = new Date('2026-07-31T18:00:00Z');
  const schedules = [
    {
      content: JSON.stringify({
        headers: ['Wed 7/29', 'Thu 7/30', 'Fri 7/31', 'Sat 8/1', 'Sun 8/2', 'Mon 8/3', 'Tue 8/4'],
        rows: [{ employee: 'Alex', shifts: ['OFF', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF', 'OFF'] }],
      }),
    },
    {
      content: JSON.stringify({
        headers: ['Wed 7/22', 'Thu 7/23', 'Fri 7/24', 'Sat 7/25', 'Sun 7/26', 'Mon 7/27', 'Tue 7/28'],
        rows: [{ employee: 'Alex', shifts: ['OFF', 'OFF', '7-2', 'OFF', 'OFF', 'OFF', 'OFF'] }],
      }),
    },
  ];
  assert.equal(findShiftForUser(schedules, 'Alex', friJul31), 'OFF');
});

test('buildAutoSweepClearedRow: places marker one second after the open IN', () => {
  const inAt = '2026-07-27T18:59:00.000Z';
  const row = buildAutoSweepClearedRow('user-1', inAt);
  assert.equal(row.user_id, 'user-1');
  assert.equal(row.action, AUTO_SWEEP_CLEARED_ACTION);
  assert.equal(row.created_at, '2026-07-27T18:59:01.000Z');
  assert.equal(row.edited_by_manager, 'Manager cleared auto-sweep');
});

test('formatShiftTimes: normalizes bare afternoon cells to explicit am/pm', () => {
  assert.equal(formatShiftTimes('1-8'), '1pm-8pm');
  assert.equal(formatShiftTimes('2-8'), '2pm-8pm');
  assert.equal(formatShiftTimes('7-8'), '7am-8pm');
  assert.equal(formatShiftTimes('10am-6'), '10am-6pm');
  assert.equal(formatShiftTimes('OFF'), 'OFF');
  assert.equal(formatShiftTimes(''), '-');
  assert.equal(normalizeScheduleCellValue(' 1-8 '), '1pm-8pm');
});

test('getStartOfWeek: always a Wednesday at midnight', () => {
  const d = getStartOfWeek();
  assert.equal(d.getDay(), 3, 'day 3 = Wednesday');
  assert.equal(d.getHours(), 0);
  assert.equal(d.getMinutes(), 0);
  assert.equal(d.getSeconds(), 0);
});

test('getBiweeklyWeeks: Wed Jul 1 2026 resolves to the Jun 17 cycle', () => {
  const { week1Start, week2Start } = getBiweeklyWeeks(new Date(2026, 6, 1));
  assert.deepEqual(
    [week1Start.getFullYear(), week1Start.getMonth(), week1Start.getDate()],
    [2026, 5, 17],
  );
  assert.deepEqual(
    [week2Start.getFullYear(), week2Start.getMonth(), week2Start.getDate()],
    [2026, 5, 24],
  );
});

test('getBiweeklyWeeks: advances one cycle two weeks later', () => {
  const { week1Start, week2Start } = getBiweeklyWeeks(new Date(2026, 6, 15));
  assert.deepEqual(
    [week1Start.getFullYear(), week1Start.getMonth(), week1Start.getDate()],
    [2026, 6, 1],
  );
  assert.deepEqual(
    [week2Start.getFullYear(), week2Start.getMonth(), week2Start.getDate()],
    [2026, 6, 8],
  );
});

test('getDistanceInMeters: identical points are zero', () => {
  close(getDistanceInMeters(33.06734, -97.29654, 33.06734, -97.29654), 0);
});

test('getDistanceInMeters: ~111km per degree of latitude', () => {
  const d = getDistanceInMeters(0, 0, 1, 0);
  assert.ok(Math.abs(d - 111195) < 500, `expected ~111195m, got ${d}`);
});

test('getPunchTransitionError: first punch must be a clock-in', () => {
  assert.equal(getPunchTransitionError(null, 'IN'), null);
  assert.equal(getPunchTransitionError(null, 'OUT'), 'You must clock in first.');
  assert.equal(getPunchTransitionError(undefined, 'START_LUNCH'), 'You must clock in first.');
});

test('getPunchTransitionError: normal in/out cycle is allowed', () => {
  assert.equal(getPunchTransitionError('IN', 'OUT'), null);
  assert.equal(getPunchTransitionError('IN', 'START_LUNCH'), null);
  assert.equal(getPunchTransitionError('START_LUNCH', 'END_LUNCH'), null);
  // Regression: returning from lunch counts as clocked in, so OUT is allowed.
  assert.equal(getPunchTransitionError('END_LUNCH', 'OUT'), null);
  assert.equal(getPunchTransitionError('CLOCK_IN', 'OUT'), null);
});

test('getPunchTransitionError: blocks duplicate/invalid transitions', () => {
  assert.equal(getPunchTransitionError('IN', 'IN'), 'You are already clocked in.');
  assert.equal(getPunchTransitionError('END_LUNCH', 'IN'), 'You are already clocked in.');
  assert.equal(getPunchTransitionError('OUT', 'OUT'), 'You are already clocked out.');
  assert.equal(getPunchTransitionError('CLOCK_OUT', 'OUT'), 'You are already clocked out.');
  assert.equal(getPunchTransitionError('START_LUNCH', 'START_LUNCH'), 'You are already on lunch.');
  assert.equal(getPunchTransitionError('IN', 'END_LUNCH'), 'You must be on lunch to end lunch.');
  assert.equal(getPunchTransitionError('OUT', 'START_LUNCH'), 'You must clock in first.');
  assert.equal(getPunchTransitionError('OUT', 'END_LUNCH'), 'You must be on lunch to end lunch.');
});

test('getMissedPunchRequestError: accepts a recent, valid request', () => {
  const now = new Date('2026-07-07T12:00:00Z');
  const when = new Date('2026-07-06T22:00:00Z');
  assert.equal(getMissedPunchRequestError('OUT', when, now), null);
});

test('getMissedPunchRequestError: rejects an unknown action', () => {
  const now = new Date('2026-07-07T12:00:00Z');
  assert.equal(
    getMissedPunchRequestError('LUNCH', new Date('2026-07-07T11:00:00Z'), now),
    'Choose which punch you missed.',
  );
});

test('getMissedPunchRequestError: rejects an unparseable time', () => {
  const now = new Date('2026-07-07T12:00:00Z');
  assert.equal(
    getMissedPunchRequestError('OUT', 'not a date', now),
    'Enter a valid date and time.',
  );
});

test('getMissedPunchRequestError: rejects a future time but allows small skew', () => {
  const now = new Date('2026-07-07T12:00:00Z');
  const future = new Date('2026-07-07T13:00:00Z');
  assert.equal(
    getMissedPunchRequestError('IN', future, now),
    "The punch time can't be in the future.",
  );
  const skew = new Date(now.getTime() + 30 * 1000);
  assert.equal(getMissedPunchRequestError('IN', skew, now), null);
});

test('getMissedPunchRequestError: rejects requests older than 30 days', () => {
  const now = new Date('2026-07-07T12:00:00Z');
  const old = new Date('2026-06-01T12:00:00Z');
  assert.equal(
    getMissedPunchRequestError('OUT', old, now),
    'Requests are limited to the last 30 days. Ask a manager to add older punches.',
  );
});

test('isPrivateOrLocalIp: detects common private and loopback ranges', () => {
  assert.equal(isPrivateOrLocalIp('192.168.1.1'), true);
  assert.equal(isPrivateOrLocalIp('10.0.0.5'), true);
  assert.equal(isPrivateOrLocalIp('172.16.0.1'), true);
  assert.equal(isPrivateOrLocalIp('127.0.0.1'), true);
  assert.equal(isPrivateOrLocalIp('169.254.1.1'), true);
  assert.equal(isPrivateOrLocalIp('::1'), true);
  assert.equal(isPrivateOrLocalIp('47.161.142.182'), false);
  assert.equal(isPrivateOrLocalIp('8.8.8.8'), false);
});

test('isWifiIpAllowed: matches trimmed and list-configured IPs', () => {
  assert.equal(isWifiIpAllowed('47.161.142.182', '47.161.142.182'), true);
  assert.equal(isWifiIpAllowed(' 47.161.142.182 ', '47.161.142.182'), true);
  assert.equal(isWifiIpAllowed('47.161.142.182', '1.2.3.4, 47.161.142.182'), true);
  assert.equal(isWifiIpAllowed('47.161.142.182', '1.2.3.4'), false);
  assert.equal(isWifiIpAllowed('', '47.161.142.182'), false);
  assert.equal(isWifiIpAllowed('47.161.142.182', ''), false);
});

test('getWifiLockFailureReason: allows when disabled or IP matches', () => {
  assert.equal(
    getWifiLockFailureReason({
      enabled: false,
      allowedIp: '1.2.3.4',
      currentIp: '9.9.9.9',
      fetchFailed: false,
    }),
    null,
  );
  assert.equal(
    getWifiLockFailureReason({
      enabled: true,
      allowedIp: '47.161.142.182',
      currentIp: '47.161.142.182',
      fetchFailed: false,
    }),
    null,
  );
});

test('getWifiLockFailureReason: blocks misconfig, fetch failure, and mismatch', () => {
  assert.match(
    getWifiLockFailureReason({
      enabled: true,
      allowedIp: '',
      currentIp: null,
      fetchFailed: false,
    }) || '',
    /no shop IP/i,
  );
  assert.match(
    getWifiLockFailureReason({
      enabled: true,
      allowedIp: '47.161.142.182',
      currentIp: null,
      fetchFailed: true,
    }) || '',
    /network check failed/i,
  );
  assert.match(
    getWifiLockFailureReason({
      enabled: true,
      allowedIp: '47.161.142.182',
      currentIp: '1.2.3.4',
      fetchFailed: false,
    }) || '',
    /shop WiFi/i,
  );
});
