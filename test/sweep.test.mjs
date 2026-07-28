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
