/* ============================================================
 * CONFIG.JS — НАСТРОЙКИ ТРЕНАЖЁРА 7 КЛАССА
 * ============================================================
 * Клиентский сайт не содержит Telegram Bot API token.
 * TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID хранятся как secrets
 * в Cloudflare Worker и никогда не публикуются в Pages-артефакте.
 * GitHub Actions подставляет только публичный URL Worker.
 * ============================================================ */

const CONFIG = {
  telegram: {
    botToken: "__TELEGRAM_BOT_TOKEN__",
    chatId: "__TELEGRAM_CHAT_ID__",
    relayUrl: "__TELEGRAM_RELAY_URL__",
    botUsername: "AnichkovZVEROK_bot",
  },
  teacherName: "Учитель математики",
  schoolName: "7 класс · Алгебра и Геометрия (ФГОС / ФОП)",
  gradeScale: {
    5: 85,
    4: 68,
    3: 50,
    2: 0,
  },
  emailjs: { serviceId: "", templateId: "", publicKey: "" },
  formspree: { endpoint: "" },
};

/** Return the configured public relay URL; it is not a secret. */
function getTelegramRelayUrl() {
  const localUrl = localStorage.getItem("math7_telegram_relay_url");
  if (localUrl && localUrl.trim()) return localUrl.trim().replace(/\/$/, "");
  const configured = CONFIG.telegram.relayUrl;
  return configured && !configured.startsWith("__") ? configured.trim().replace(/\/$/, "") : "";
}

/** Return the locally stored recipient hint; the Worker enforces its fixed secret destination. */
function getTelegramChatId() {
  return (localStorage.getItem("math7_telegram_chat_id") || "").trim();
}

/** Save recipient hint for requests; the relay rejects IDs other than its configured destination. */
function setTelegramChatId(chatId) {
  if (chatId) localStorage.setItem("math7_telegram_chat_id", chatId.trim());
  else localStorage.removeItem("math7_telegram_chat_id");
}
