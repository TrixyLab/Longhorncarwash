import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { calcHours } from '../_shared/hours.mjs';
import {
  assertWebhookSecret,
  getTelegramBotToken,
  getTelegramChatId,
} from '../_shared/secrets.mjs';

const TZ = 'America/Chicago';

async function tg(msg: string) {
  await fetch(`https://api.telegram.org/bot${getTelegramBotToken()}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: getTelegramChatId(), text: msg }),
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

Deno.serve(async (req: Request) => {
  if (!assertWebhookSecret(req)) return new Response('Unauthorized', { status: 401 });

  const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: TZ });

  const { data: users } = await sb.from('users').select('id,name').eq('is_approved', true);
  if (!users?.length) return new Response('No users', { status: 200 });

  // Fetch last 28h and filter to today in CT to handle DST safely
  const since = new Date(Date.now() - 28 * 3600000).toISOString();
  const { data: allLogs } = await sb.from('time_logs')
    .select('user_id,action,created_at')
    .gte('created_at', since)
    .in('action', ['IN', 'OUT', 'START_LUNCH', 'END_LUNCH', 'CLOCK_IN', 'CLOCK_OUT'])
    .order('created_at', { ascending: true });

  const logs = (allLogs ?? []).filter((l: any) =>
    new Date(l.created_at).toLocaleDateString('en-CA', { timeZone: TZ }) === today
  );

  const byUser: Record<string, typeof logs> = {};
  for (const l of logs) {
    if (!byUser[l.user_id]) byUser[l.user_id] = [];
    byUser[l.user_id].push(l);
  }

  const dateLabel = new Date().toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric' });
  const lines: string[] = [`Longhorn Car Wash - Daily Summary (${dateLabel})\n`];
  let totalHours = 0;
  const stillIn: string[] = [];

  for (const user of users) {
    const ul = byUser[user.id] ?? [];
    if (!ul.length) continue;
    const hrs = calcHours(ul);
    totalHours += hrs;
    const last = ul[ul.length - 1].action;
    const clockedIn = last === 'IN' || last === 'END_LUNCH' || last === 'START_LUNCH' || last === 'CLOCK_IN';
    const inLog = ul.find((l: any) => l.action === 'IN' || l.action === 'CLOCK_IN');
    const outLog = [...ul].reverse().find((l: any) => l.action === 'OUT' || l.action === 'CLOCK_OUT');
    if (clockedIn) {
      stillIn.push(user.name);
      lines.push(`${user.name}: ${hrs.toFixed(1)} hrs (in ${inLog ? fmtTime(inLog.created_at) : '?'}) STILL IN`);
    } else {
      lines.push(`${user.name}: ${hrs.toFixed(1)} hrs (${inLog ? fmtTime(inLog.created_at) : '?'} - ${outLog ? fmtTime(outLog.created_at) : '?'})`);
    }
  }

  if (lines.length === 1) lines.push('No punches recorded today.');
  lines.push(`\nTotal labor: ${totalHours.toFixed(1)} hrs`);
  if (stillIn.length) lines.push(`Still clocked in: ${stillIn.join(', ')}`);

  await tg(lines.join('\n'));
  return new Response('OK', { status: 200 });
});
