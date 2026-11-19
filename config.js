/* ============================================================
 * CONFIG.JS — НАСТРОЙКИ ТРЕНАЖЁРА 7 КЛАССА
 * ============================================================
 * В исходниках main хранятся только плейсхолдеры.
 * GitHub Actions подставляет TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID
 * в копию config.js при сборке Pages.
 * ВАЖНО: итоговый публичный JS будет содержать токен, его можно извлечь.
 * ============================================================ */

const CONFIG = {
  telegram: {
    botToken: "__TELEGRAM_BOT_TOKEN__",
    chatId: "__TELEGRAM_CHAT_ID__",
    botUsername: "AnichkovZVEROK_bot",
  },
  teacherName: "Учитель математики",
  schoolName: "7 класс · Алгебра и Геометрия (ФГОС / ФОП)",
  gradeScale: { 5: 85, 4: 68, 3: 50, 2: 0 },
  emailjs: { serviceId: "", templateId: "", publicKey: "" },
  formspree: { endpoint: "" },
};

/** Return the bot token injected at build time, or a local browser override. */
function getTelegramBotToken() {
  const localToken = localStorage.getItem("math7_telegram_bot_token");
  if (localToken && localToken.trim()) return localToken.trim();
  const token = CONFIG.telegram.botToken;
  return token && !token.startsWith("__") ? token.trim() : "";
}

/** Return the configured recipient ID, with a local override for teacher setup. */
function getTelegramChatId() {
  const localChatId = localStorage.getItem("math7_telegram_chat_id");
  if (localChatId && localChatId.trim()) return localChatId.trim();
  const chatId = CONFIG.telegram.chatId;
  return chatId && !chatId.startsWith("__") ? chatId.trim() : "";
}

/** Persist a recipient Chat ID in this browser. */
function setTelegramChatId(chatId) {
  if (chatId) localStorage.setItem("math7_telegram_chat_id", chatId.trim());
  else localStorage.removeItem("math7_telegram_chat_id");
}
