-- Hourly server-side auto-sweep for forgotten clock-outs.
-- Calls the auto-sweep edge function so kiosks don't need to stay open.
-- Uses pg_net (net.http_post), which is enabled on Supabase projects.

CREATE OR REPLACE FUNCTION public.invoke_auto_sweep()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, net, pg_temp
AS $$
DECLARE
  req_id bigint;
  secret text;
BEGIN
  BEGIN
    secret := nullif(current_setting('app.settings.webhook_secret', true), '');
  EXCEPTION WHEN others THEN
    secret := NULL;
  END;
  IF secret IS NULL THEN
    secret := 'lcw-punch-notify-2026';
  END IF;

  SELECT net.http_post(
    url := 'https://pbgatghmutejbsmcedsw.supabase.co/functions/v1/auto-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', secret
    ),
    body := '{}'::jsonb
  ) INTO req_id;

  RETURN req_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.invoke_auto_sweep() FROM PUBLIC, anon, authenticated;

-- Replace any prior job with the same name (idempotent across deploys).
DO $$
BEGIN
  PERFORM cron.unschedule('auto-sweep-forgotten-clockouts');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Run at :15 every hour so it is not tied to any open browser dashboard.
SELECT cron.schedule(
  'auto-sweep-forgotten-clockouts',
  '15 * * * *',
  $cron$SELECT public.invoke_auto_sweep();$cron$
);
