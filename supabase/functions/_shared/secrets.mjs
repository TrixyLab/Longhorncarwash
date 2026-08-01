// Edge-function secrets. Prefer Deno.env; fall back to legacy literals so
// existing deployments keep working until secrets are configured in the dashboard.
// Set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, and WEBHOOK_SECRET in Supabase, then rotate.

const LEGACY_BOT = '8729010258:AAEh2We1rFbEiC1WoEbz0Gz5qOyDr5Kyo4c';
const LEGACY_CHAT = '-5595038862';
const LEGACY_SECRET = 'lcw-punch-notify-2026';

export function getTelegramBotToken() {
  return Deno.env.get('TELEGRAM_BOT_TOKEN') || LEGACY_BOT;
}

export function getTelegramChatId() {
  return Deno.env.get('TELEGRAM_CHAT_ID') || LEGACY_CHAT;
}

export function getWebhookSecret() {
  return Deno.env.get('WEBHOOK_SECRET') || LEGACY_SECRET;
}

export function assertWebhookSecret(req) {
  return req.headers.get('x-webhook-secret') === getWebhookSecret();
}
