/**
 * Telegram relay for the public GitHub Pages frontend.
 * Secrets are installed as Cloudflare Worker secrets, never shipped to browsers.
 * POST /send with JSON { chat_id, text }. Destination is fixed by Worker secret.
 */
const corsHeaders = (origin) => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
});

function jsonResponse(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(origin) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (!env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) {
      return new Response("Forbidden", { status: 403 });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405, origin);

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (env.RATE_LIMITER) {
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) return jsonResponse({ ok: false, error: "Too many requests" }, 429, origin);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "Invalid JSON" }, 400, origin);
    }

    const chatId = String(payload.chat_id || "").trim();
    const text = String(payload.text || "").trim();
    if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
      return jsonResponse({ ok: false, error: "Relay is not configured" }, 503, origin);
    }
    if (!chatId || chatId !== env.TELEGRAM_CHAT_ID) {
      return jsonResponse({ ok: false, error: "Recipient does not match configured chat" }, 403, origin);
    }
    if (!text || text.length > 3500 || !text.startsWith("📚 <b>Тренажёр по математике")) {
      return jsonResponse({ ok: false, error: "Invalid report" }, 400, origin);
    }

    // Keep only the report's intended bold tags. Escape every other HTML character
    // so a student name or answer cannot inject Telegram markup.
    const safeText = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/&lt;(\/?)b&gt;/g, "<$1b>");

    try {
      const telegramResponse = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: safeText, parse_mode: "HTML" }),
      });
      const result = await telegramResponse.json();
      if (!telegramResponse.ok || !result.ok) {
        return jsonResponse({ ok: false, error: "Telegram rejected the message" }, 502, origin);
      }
      return jsonResponse({ ok: true }, 200, origin);
    } catch {
      return jsonResponse({ ok: false, error: "Telegram is temporarily unavailable" }, 502, origin);
    }
  },
};
