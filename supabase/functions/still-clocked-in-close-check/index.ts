import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  assertWebhookSecret,
  getTelegramBotToken,
  getTelegramChatId,
} from '../_shared/secrets.mjs';
import { getStoreCloseHour, TZ } from '../_shared/sweep.mjs';

const OPEN_ACTIONS = ['IN', 'END_LUNCH', 'CLOCK_IN', 'START_LUNCH'];
const PUNCH_ACTIONS = ['IN', 'OUT', 'START_LUNCH', 'END_LUNCH', 'CLOCK_IN', 'CLOCK_OUT'];

function nowChicagoParts(now = new Date()) {
  const date = now.toLocaleDateString('en-CA', { timeZone: TZ });
  const hour = parseInt(now.toLocaleTimeString('en-US', { timeZone: TZ, hour: 'numeric', hour12: false }), 10);
  const minute = parseInt(now.toLocaleTimeString('en-US', { timeZone: TZ, minute: 'numeric' }), 10);
  return { date, hour, minute };
}

async function tg(msg: string) {
  await fetch(`https://api.telegram.org/bot${getTelegramBotToken()}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: getTelegramChatId(), text: msg }),
  });
}

Deno.serve(async (req: Request) => {
  if (!assertWebhookSecret(req)) return new Response('Unauthorized', { status: 401 });

  const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');

  try {
    const now = new Date();
    const { date, hour, minute } = nowChicagoParts(now);
    const closeHour = getStoreCloseHour(date);

    // This function may run every 5 minutes; only act at/after close+5.
    if (hour !== closeHour || minute < 5) {
      return new Response(JSON.stringify({ skipped: 'outside-close-window', date, hour, minute, closeHour }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const sentKey = `still-clocked-in-close:${date}`;
    const { data: sentAlready } = await sb.from('settings').select('id').eq('id', sentKey).limit(1);
    if (sentAlready?.length) {
      return new Response(JSON.stringify({ skipped: 'already-sent', date }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { data: users } = await sb
      .from('users')
      .select('id, name, is_salary')
      .eq('is_approved', true);
    if (!users?.length) return new Response(JSON.stringify({ sent: false, reason: 'no-users' }), { status: 200 });

    const since = new Date(Date.now() - 28 * 3600000).toISOString();
    const { data: logs } = await sb
      .from('time_logs')
      .select('user_id, action, created_at')
      .gte('created_at', since)
      .in('action', PUNCH_ACTIONS)
      .order('created_at', { ascending: true });

    const latestByUser: Record<string, { action: string; created_at: string }> = {};
    for (const l of logs ?? []) {
      if (new Date(l.created_at).toLocaleDateString('en-CA', { timeZone: TZ }) === date) {
        latestByUser[l.user_id] = { action: l.action, created_at: l.created_at };
      }
    }

    const stillIn = [];
    for (const u of users) {
      if (u.is_salary) continue;
      const latest = latestByUser[u.id];
      if (latest && OPEN_ACTIONS.includes(latest.action)) {
        stillIn.push({
          name: u.name,
          inAt: new Date(latest.created_at).toLocaleTimeString('en-US', {
            timeZone: TZ,
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          }),
        });
      }
    }

    const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    const closeLabel = closeHour === 18 ? '6:00 PM' : '8:00 PM';
    if (stillIn.length) {
      const lines = stillIn.map((s) => `${s.name} (in ${s.inAt})`).join(', ');
      await tg(`Longhorn Car Wash close check (${dateLabel} ${closeLabel}): still clocked in -> ${lines}`);
    } else {
      await tg(`Longhorn Car Wash close check (${dateLabel} ${closeLabel}): all employees clocked out.`);
    }

    await sb.from('settings').upsert({ id: sentKey, value: now.toISOString() });

    return new Response(JSON.stringify({ sent: true, stillInCount: stillIn.length, date }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(err);
    return new Response('Error', { status: 500 });
  }
});
