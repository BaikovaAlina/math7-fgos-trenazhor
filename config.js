/* ============================================================
 * CONFIG.JS — НАСТРОЙКИ ТРЕНАЖЁРА 7 КЛАССА
 * ============================================================
 * GitHub Actions replaces placeholders in the Pages artifact.
 * In the selected direct-browser mode, the built public JS contains
 * the Bot Token and can be inspected by site visitors.
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

/** Return a Bot Token injected by the Pages build, or an empty string. */
function getTelegramBotToken() {
  const token = CONFIG.telegram.botToken;
  return token && !token.startsWith("__") ? token.trim() : "";
}

/** Return the teacher's fixed recipient ID injected by the Pages build. */
function getTelegramChatId() {
  const chatId = CONFIG.telegram.chatId;
  return chatId && !chatId.startsWith("__") ? chatId.trim() : "";
}
