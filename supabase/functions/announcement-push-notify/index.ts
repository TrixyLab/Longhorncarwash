import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { assertWebhookSecret } from '../_shared/secrets.mjs';

Deno.serve(async (req: Request) => {
  if (!assertWebhookSecret(req)) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const payload = await req.json();
    
    // Webhook payload details:
    // payload.record contains the new row data (id, value, etc.)
    const record = payload.record;
    if (!record || record.id !== 'announcement' || !record.value) {
      return new Response('Not an active announcement update', { status: 200 });
    }

    const msg = record.value.trim();
    if (!msg) {
      return new Response('Empty announcement', { status: 200 });
    }

    // Connect to Supabase with Service Role key (needed to bypass RLS)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch all push tokens for approved users (managers, employees, etc.)
    const { data: users, error: fetchErr } = await supabase
      .from('users')
      .select('push_token')
      .eq('is_approved', true)
      .not('push_token', 'is', null);

    if (fetchErr) {
      console.error('Fetch users error:', fetchErr);
      return new Response('Error fetching users', { status: 500 });
    }

    if (!users || users.length === 0) {
      return new Response('No users to notify', { status: 200 });
    }

    const tokens = users.map((u: any) => u.push_token).filter(Boolean);
    if (tokens.length === 0) {
      return new Response('No registered push tokens', { status: 200 });
    }

    // Format push messages for Expo Push Service
    const messages = tokens.map((token: string) => ({
      to: token,
      sound: 'default',
      title: 'New Shift Announcement',
      body: msg,
      data: { type: 'announcement', message: msg },
    }));

    // Send HTTP POST request to Expo Push API
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messages),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Expo API error:', errText);
      return new Response('Expo API error', { status: 500 });
    }

    console.log(`Successfully sent announcements to ${tokens.length} users.`);
    return new Response('Notifications sent successfully', { status: 200 });
  } catch (err) {
    console.error('Function error:', err);
    return new Response('Internal error', { status: 500 });
  }
});
