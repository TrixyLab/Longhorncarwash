-- Run the shift-reminder edge function every 5 minutes so employees get a
-- push notification shortly before their shift starts. Mirrors the existing
-- attendance-check / eod-summary / overtime-check cron jobs. Named so
-- re-applying updates the job in place rather than duplicating it.
SELECT cron.schedule(
  'shift-reminder',
  '*/5 * * * *',
  $cron$
    SELECT net.http_post(
      'https://pbgatghmutejbsmcedsw.supabase.co/functions/v1/shift-reminder',
      '{}'::jsonb,
      '{}'::jsonb,
      jsonb_build_object(
        'Content-Type', 'application/json',
        'x-webhook-secret', 'lcw-punch-notify-2026'
      )
    );
  $cron$
);
