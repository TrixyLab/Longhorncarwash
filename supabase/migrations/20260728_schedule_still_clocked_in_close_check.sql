-- Close-time reminder: alert management if anyone is still clocked in at
-- store close + 5 minutes (8:05 PM Mon-Sat, 6:05 PM Sunday in Chicago time).
-- The edge function dedupes by day, so this cron can run every 5 minutes.

CREATE OR REPLACE FUNCTION public.invoke_still_clocked_in_close_check()
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
    url := 'https://pbgatghmutejbsmcedsw.supabase.co/functions/v1/still-clocked-in-close-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', secret
    ),
    body := '{}'::jsonb
  ) INTO req_id;

  RETURN req_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.invoke_still_clocked_in_close_check() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule(
  'still-clocked-in-close-check',
  '*/5 * * * *',
  $cron$SELECT public.invoke_still_clocked_in_close_check();$cron$
);
