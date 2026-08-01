import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  AUTO_SWEEP_CLEARED_ACTION,
  SYSTEM_AUTO_SWEEP_LABEL,
  findShiftForUser,
  getAutoOutIso,
  hasForgottenClockOut,
  isSafeAutoSweepOutInsert,
} from '../_shared/schedule.mjs';
import { assertWebhookSecret } from '../_shared/secrets.mjs';

const PUNCH_ACTIONS = ['IN', 'OUT', 'START_LUNCH', 'END_LUNCH', 'CLOCK_IN', 'CLOCK_OUT'];
const OPEN_ACTIONS = ['IN', 'END_LUNCH', 'CLOCK_IN', 'START_LUNCH'];

Deno.serve(async (req: Request) => {
  if (!assertWebhookSecret(req)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  try {
    const now = new Date();
    const { data: users, error: uErr } = await sb
      .from('users')
      .select('id, name, is_salary')
      .eq('is_approved', true);
    if (uErr) throw uErr;
    if (!users?.length) return new Response(JSON.stringify({ swept: 0 }), { status: 200 });

    const { data: schedules } = await sb
      .from('schedules')
      .select('content')
      .neq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(10);
    let swept = 0;

    for (const u of users) {
      if (u.is_salary) continue;

      const { data: latestLog } = await sb
        .from('time_logs')
        .select('action, created_at')
        .eq('user_id', u.id)
        .in('action', PUNCH_ACTIONS)
        .order('created_at', { ascending: false })
        .limit(1);

      const log = latestLog?.[0];
      if (!log || !OPEN_ACTIONS.includes(log.action)) continue;

      const logDate = new Date(log.created_at);
      const userShiftStr = findShiftForUser(schedules ?? [], u.name, logDate);
      if (!hasForgottenClockOut(logDate, userShiftStr, now)) continue;

      const { data: cleared } = await sb
        .from('time_logs')
        .select('id')
        .eq('user_id', u.id)
        .eq('action', AUTO_SWEEP_CLEARED_ACTION)
        .gt('created_at', log.created_at)
        .limit(1);
      if (cleared?.length) continue;

      const { data: recheck } = await sb
        .from('time_logs')
        .select('action, created_at')
        .eq('user_id', u.id)
        .in('action', PUNCH_ACTIONS)
        .order('created_at', { ascending: false })
        .limit(1);
      const stillOpen =
        recheck?.[0] &&
        OPEN_ACTIONS.includes(recheck[0].action) &&
        recheck[0].created_at === log.created_at;
      if (!stillOpen) continue;

      const autoOutIso = getAutoOutIso(logDate, userShiftStr);
      const { data: afterOpen } = await sb
        .from('time_logs')
        .select('action, created_at')
        .eq('user_id', u.id)
        .in('action', PUNCH_ACTIONS)
        .gt('created_at', log.created_at)
        .limit(20);
      if (!isSafeAutoSweepOutInsert(log.created_at, autoOutIso, afterOpen)) continue;

      const { error: insertErr } = await sb.from('time_logs').insert({
        user_id: u.id,
        action: 'OUT',
        created_at: autoOutIso,
        edited_by_manager: SYSTEM_AUTO_SWEEP_LABEL,
      });
      if (!insertErr) swept += 1;
    }

    return new Response(JSON.stringify({ ok: true, swept }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(err);
    return new Response('Error', { status: 500 });
  }
});
