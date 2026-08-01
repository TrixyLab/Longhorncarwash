import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseShiftTimes,
  getAutoOutIso,
  hasForgottenClockOut,
  SYSTEM_AUTO_SWEEP_LABEL,
} from '../supabase/functions/_shared/sweep.mjs';

test('shared sweep parseShiftTimes: afternoon bare form', () => {
  assert.deepEqual(parseShiftTimes('2-8'), {
    start: { hour: 14, minute: 0 },
    end: { hour: 20, minute: 0 },
    isOvernight: false,
  });
});

test('shared sweep getAutoOutIso: 1-8 ends at 8pm CDT', () => {
  const clockIn = new Date('2026-07-27T18:59:00Z');
  assert.equal(getAutoOutIso(clockIn, '1-8'), '2026-07-28T01:00:00.000Z');
});

test('shared sweep hasForgottenClockOut: grace after scheduled end', () => {
  const clockIn = new Date('2026-07-21T14:00:00Z');
  assert.equal(hasForgottenClockOut(clockIn, '9am-5pm', new Date('2026-07-21T22:30:00Z')), false);
  assert.equal(hasForgottenClockOut(clockIn, '9am-5pm', new Date('2026-07-22T00:05:00Z')), true);
});

test('shared sweep exports System Auto-Sweep label', () => {
  assert.equal(SYSTEM_AUTO_SWEEP_LABEL, 'System Auto-Sweep');
});

test('shared sweep findShiftForUser: date match not bare weekday', async () => {
  const { findShiftForUser } = await import('../supabase/functions/_shared/sweep.mjs');
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
  assert.equal(findShiftForUser(schedules, 'Alex', friJul31), '1-8');
});

test('shared sweep getAutoOutIso: early morning unscheduled uses store close', () => {
  const clockIn = new Date('2026-07-31T11:00:00Z'); // Fri 6am CDT
  assert.equal(getAutoOutIso(clockIn, null), '2026-08-01T01:00:00.000Z');
});
