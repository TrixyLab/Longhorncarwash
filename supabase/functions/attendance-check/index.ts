import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  TZ,
  findShiftForUser,
  parseShift,
  formatShiftMins,
} from '../_shared/schedule.mjs';

const BOT = '8729010258:AAEh2We1rFbEiC1WoEbz0Gz5qOyDr5Kyo4c';
const CHAT = '-5595038862';
const SECRET = 'lcw-punch-notify-2026';

function nowCT() {
  const s = new Date().toLocaleString('en-US', {
    timeZone: TZ,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
  const [dp, tp] = s.split(', ');
  const [mo, dy, yr] = dp.split('/');
  const [h, m] = tp.split(':').map(Number);
  return { date: `${yr}-${mo}-${dy}`, mins: h * 60 + m, mo: +mo, dy: +dy, yr: +yr };
}

async function tg(msg: string) {
  await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT, text: msg }),
  });
}

Deno.serve(async (req: Request) => {
  if (req.headers.get('x-webhook-secret') !== SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }
  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );
  try {
    const { date, mins } = nowCT();
    const now = new Date();

    const { data: scheds } = await sb
      .from('schedules')
      .select('content')
      .neq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(10);
    if (!scheds?.length) return new Response('No schedules', { status: 200 });

    const { data: users } = await sb
      .from('users')
      .select('id,name,is_salary')
      .eq('is_approved', true);
    if (!users?.length) return new Response('No users', { status: 200 });

    const since = new Date(Date.now() - 20 * 3600000).toISOString();
    const { data: logs } = await sb
      .from('time_logs')
      .select('user_id,action,created_at')
      .gte('created_at', since)
      .in('action', ['IN', 'OUT', 'START_LUNCH', 'END_LUNCH', 'CLOCK_IN', 'CLOCK_OUT'])
      .order('created_at', { ascending: true });

    const status: Record<string, string> = {};
    for (const l of logs ?? []) {
      if (new Date(l.created_at).toLocaleDateString('en-CA', { timeZone: TZ }) === date) {
        status[l.user_id] = l.action;
      }
    }

    const { data: sent } = await sb
      .from('notifications_sent')
      .select('user_id,notification_type')
      .eq('shift_date', date);
    const sentSet = new Set((sent ?? []).map((n: { user_id: string; notification_type: string }) => `${n.user_id}:${n.notification_type}`));

    const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });

    // Per-employee lookup (same as auto-sweep): match today's M/D, never steal
    // next/last week's same weekday for late / forgot Telegram alerts.
    for (const user of users) {
      if (user.is_salary) continue;
      const shiftStr = findShiftForUser(scheds, user.name, now, TZ);
      const shift = parseShift(shiftStr);
      if (!shift) continue;

      const last = status[user.id] ?? null;
      const inToday = last !== null;
      const stillIn =
        last === 'IN' ||
        last === 'END_LUNCH' ||
        last === 'START_LUNCH' ||
        last === 'CLOCK_IN';

      if (mins >= shift.s + 3 && mins < shift.e && !inToday) {
        const k = `${user.id}:late_clock_in`;
        if (!sentSet.has(k)) {
          await tg(
            `${user.name} has not clocked in - shift started at ${formatShiftMins(shift.s)} on ${dateLabel}`,
          );
          await sb.from('notifications_sent').insert({
            user_id: user.id,
            notification_type: 'late_clock_in',
            shift_date: date,
          });
          sentSet.add(k);
        }
      }

      if (mins >= shift.e + 5 && stillIn) {
        const k = `${user.id}:forgot_clock_out`;
        if (!sentSet.has(k)) {
          await tg(
            `${user.name} forgot to clock out - shift ended at ${formatShiftMins(shift.e)} on ${dateLabel}`,
          );
          await sb.from('notifications_sent').insert({
            user_id: user.id,
            notification_type: 'forgot_clock_out',
            shift_date: date,
          });
          sentSet.add(k);
        }
      }
    }
    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error(err);
    return new Response('Error', { status: 500 });
  }
});
