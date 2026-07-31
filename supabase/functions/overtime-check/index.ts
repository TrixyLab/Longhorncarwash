import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { calcHours } from '../_shared/hours.mjs';
import {
  assertWebhookSecret,
  getTelegramBotToken,
  getTelegramChatId,
} from '../_shared/secrets.mjs';

const TZ = 'America/Chicago';
const OT_THRESHOLD = 36;

async function tg(msg: string) {
  await fetch(`https://api.telegram.org/bot${getTelegramBotToken()}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: getTelegramChatId(), text: msg }),
  });
}

function getWeekStart(): string {
  // Week starts on Friday (pay cycle: Fri–Thu)
  const now = new Date();
  const ct = new Date(now.toLocaleString('en-US', { timeZone: TZ }));
  const day = ct.getDay(); // 0=Sun, 5=Fri
  const daysFromFri = (day + 7 - 5) % 7;
  const ws = new Date(ct);
  ws.setDate(ct.getDate() - daysFromFri);
  return ws.toLocaleDateString('en-CA'); // YYYY-MM-DD
}

Deno.serve(async (req: Request) => {
  if (!assertWebhookSecret(req)) return new Response('Unauthorized', { status: 401 });

  const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const weekStart = getWeekStart();

  const { data: users } = await sb.from('users').select('id,name').eq('is_approved', true);
  if (!users?.length) return new Response('No users', { status: 200 });

  // Fetch 8 days of logs to safely cover the full week regardless of DST
  const since = new Date(Date.now() - 8 * 86400000).toISOString();
  const { data: allLogs } = await sb.from('time_logs')
    .select('user_id,action,created_at')
    .gte('created_at', since)
    .in('action', ['IN', 'OUT', 'START_LUNCH', 'END_LUNCH', 'CLOCK_IN', 'CLOCK_OUT'])
    .order('created_at', { ascending: true });

  // Only keep logs from this week (Friday onward) in CT
  const logs = (allLogs ?? []).filter((l: any) =>
    new Date(l.created_at).toLocaleDateString('en-CA', { timeZone: TZ }) >= weekStart
  );

  const { data: sent } = await sb.from('notifications_sent')
    .select('user_id').eq('notification_type', 'overtime_warning').eq('shift_date', weekStart);
  const sentSet = new Set((sent ?? []).map((n: any) => n.user_id));

  const byUser: Record<string, typeof logs> = {};
  for (const l of logs) {
    if (!byUser[l.user_id]) byUser[l.user_id] = [];
    byUser[l.user_id].push(l);
  }

  for (const user of users) {
    if (sentSet.has(user.id)) continue;
    const hrs = calcHours(byUser[user.id] ?? []);
    if (hrs >= OT_THRESHOLD) {
      await tg(`Overtime Alert: ${user.name} has ${hrs.toFixed(1)} hrs this week - approaching overtime`);
      await sb.from('notifications_sent').insert({
        user_id: user.id, notification_type: 'overtime_warning', shift_date: weekStart,
      });
    }
  }

  return new Response('OK', { status: 200 });
});
