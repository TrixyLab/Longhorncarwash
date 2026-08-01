import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  findScheduleDayIndex,
  findShiftForUser,
  parseShift,
  formatShiftMins,
} from '../supabase/functions/_shared/schedule.mjs';

test('shared parseShift: afternoon bare form ends at 8pm', () => {
  assert.deepEqual(parseShift('1-8'), { s: 13 * 60, e: 20 * 60 });
  assert.deepEqual(parseShift('7-8'), { s: 7 * 60, e: 20 * 60 });
  assert.equal(formatShiftMins(20 * 60), '8:00 PM');
  assert.equal(formatShiftMins(14 * 60), '2:00 PM');
});

test('shared parseShift: overnight end is after start for attendance compares', () => {
  const shift = parseShift('7pm-1am');
  assert.ok(shift);
  assert.equal(shift.s, 19 * 60);
  assert.equal(shift.e, 25 * 60); // 1am next day
});

test('shared getAutoOutIso: early morning unscheduled uses store close not +8', async () => {
  const { getAutoOutIso } = await import('../supabase/functions/_shared/schedule.mjs');
  const clockIn = new Date('2026-07-31T11:00:00Z'); // Fri 6:00 AM CDT
  assert.equal(getAutoOutIso(clockIn, null), '2026-08-01T01:00:00.000Z');
});

test('shared findShiftForUser: Telegram path must not steal next-week Friday', () => {
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
  assert.equal(findScheduleDayIndex(JSON.parse(schedules[0].content).headers, friJul31), -1);
  assert.equal(findShiftForUser(schedules, 'Alex', friJul31), '1-8');
  assert.deepEqual(parseShift(findShiftForUser(schedules, 'Alex', friJul31)), {
    s: 13 * 60,
    e: 20 * 60,
  });
});
