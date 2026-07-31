import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SYSTEM_AUTO_SWEEP_LABEL, TZ } from '../_shared/schedule.mjs';

const TELEGRAM_BOT_TOKEN = '8729010258:AAEh2We1rFbEiC1WoEbz0Gz5qOyDr5Kyo4c';
const TELEGRAM_CHAT_ID = '-5595038862';
const WEBHOOK_SECRET = 'lcw-punch-notify-2026';

const ACTION_LABELS: Record<string, string> = {
  IN: 'clocked IN',
  OUT: 'clocked OUT',
  START_LUNCH: 'started LUNCH',
  END_LUNCH: 'returned from LUNCH',
};

Deno.serve(async (req: Request) => {
  if (req.headers.get('x-webhook-secret') !== WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const body = await req.json();
    const { user_id, action, created_at, edited_by_manager: editedFromBody } = body;

    if (!ACTION_LABELS[action]) {
      return new Response('Skipped', { status: 200 });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: user } = await supabase
      .from('users')
      .select('name')
      .eq('id', user_id)
      .single();

    const name = user?.name ?? 'Unknown Employee';
    const punchDate = new Date(created_at ?? new Date().toISOString());

    // Prefer body field; otherwise look up the punch so System Auto-Sweep OUTs
    // are labeled correctly (and use the stamped time from the row).
    let editedBy = editedFromBody ?? null;
    let stampIso = created_at ?? punchDate.toISOString();
    if (editedBy == null && user_id && created_at) {
      const { data: punch } = await supabase
        .from('time_logs')
        .select('edited_by_manager, created_at')
        .eq('user_id', user_id)
        .eq('action', action)
        .eq('created_at', created_at)
        .limit(1)
        .maybeSingle();
      if (punch) {
        editedBy = punch.edited_by_manager;
        stampIso = punch.created_at ?? stampIso;
      }
    }

    const stampDate = new Date(stampIso);
    const time = stampDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: TZ,
    });

    const dateLabel = stampDate.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: TZ,
    });

    const message =
      action === 'OUT' && editedBy === SYSTEM_AUTO_SWEEP_LABEL
        ? `${name} was auto clocked OUT at ${time} on ${dateLabel} (${SYSTEM_AUTO_SWEEP_LABEL})`
        : `${name} ${ACTION_LABELS[action]} at ${time} on ${dateLabel}`;

    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Telegram error:', err);
      return new Response('Telegram error', { status: 500 });
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('Function error:', err);
    return new Response('Internal error', { status: 500 });
  }
});
