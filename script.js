/* ============================================================
 * SCRIPT.JS — ДВИЖОК ТРЕНАЖЁРА ПО МАТЕМАТИКЕ (7 КЛАСС)
 * ============================================================
 * 1. Нормализация и проверка математических ответов
 * 2. Управление состоянием (State) и навигацией
 * 3. Рендеринг карточек заданий и полей ввода
 * 4. Подсчёт результатов, процентов и оценки
 * 5. Отправка результатов в Telegram Bot API
 * 6. Модальные окна (Теория / Настройки)
 * ============================================================ */

"use strict";

// Состояние приложения
const appState = {
  studentName: "",
  variantKey: "K-1",
  slides: [],
  currentSlide: 0,
  startTime: null,
  results: null,
  telegramAttempted: false,
};

// Вспомогательные функции селекторов
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ============================================================
 * ФОРМАТИРОВАНИЕ ВЕРТИКАЛЬНЫХ ДРОБЕЙ (МАТЕМАТИЧЕСКАЯ ЧЕРТА)
 * ============================================================ */

function formatMath(text) {
  if (!text || typeof text !== "string") return text;

  // Защита URL-адресов от замены слэшей
  const urls = [];
  text = text.replace(/https?:\/\/[^\s"'<>]+/g, (m) => {
    urls.push(m);
    return `___URL_${urls.length - 1}___`;
  });

  // 1. Дроби в скобках: (expr) / (expr) или (expr) / num
  text = text.replace(
    /\(([^)]+)\)\s*\/\s*\(([^)]+)\)/g,
    `<span class="frac"><span class="num">$1</span><span class="den">$2</span></span>`
  );
  text = text.replace(
    /\(([^)]+)\)\s*\/\s*([a-zA-Zа-яА-Я0-9]+)/g,
    `<span class="frac"><span class="num">$1</span><span class="den">$2</span></span>`
  );
  text = text.replace(
    /(?<![<a-zA-Z0-9\/:\\])([a-zA-Zа-яА-Я0-9]+)\s*\/\s*\(([^)]+)\)/g,
    `<span class="frac"><span class="num">$1</span><span class="den">$2</span></span>`
  );

  // 2. Смешанные числа: e.g. "3 5/6", "-2 1/4"
  text = text.replace(
    /(?<![<a-zA-Z0-9\/:\\])([-−]?\d+)\s+(\d+)\s*\/\s*(\d+)(?![a-zA-Z0-9\/>])/g,
    `<span class="mixed-num">$1<span class="frac"><span class="num">$2</span><span class="den">$3</span></span></span>`
  );

  // 3. Отрицательные простые дроби: e.g. "-3/4", "−5/8"
  text = text.replace(
    /(?<![<a-zA-Z0-9\/:\\])[-−]\s*([a-zA-Zа-яА-Я0-9]+)\s*\/\s*([a-zA-Zа-яА-Я0-9]+)(?![a-zA-Z0-9\/>])/g,
    `<span class="neg-frac"><span class="frac"><span class="num">$1</span><span class="den">$2</span></span></span>`
  );

  // 4. Обычные простые дроби: e.g. "3/4", "19/24", "x/12", "7 / 5"
  text = text.replace(
    /(?<![<a-zA-Z0-9\/:\\])([a-zA-Zа-яА-Я0-9]+)\s*\/\s*([a-zA-Zа-яА-Я0-9]+)(?![a-zA-Z0-9\/>])/g,
    `<span class="frac"><span class="num">$1</span><span class="den">$2</span></span>`
  );

  // Восстановление URL-адресов
  text = text.replace(/___URL_(\d+)___/g, (_, i) => urls[i]);

  return text;
}

/* ============================================================
 * 1. НОРМАЛИЗАЦИЯ И ПРОВЕРКА ОТВЕТОВ
 * ============================================================ */

// Очистка и канонизация строки ответа
function canon(val) {
  if (val == null) return "";
  let s = String(val).trim().toLowerCase();
  s = s.replace(/[−–—]/g, "-").replace(/°/g, "");
  // Замена знаков умножения; x в строковых ответах остаётся математическим знаком.
  s = s.replace(/[×*х∙⋅]/g, "·");
  s = s.replace(/\s+/g, " ");
  return s;
}

/** Convert an integer, decimal, common fraction, or mixed number to Number. */
function parseMathNumber(value) {
  const s = String(value ?? "").trim().replace(/[−–—]/g, "-").replace(/,/g, ".");
  const mixed = s.match(/^([+-]?\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const whole = Number(mixed[1]), numerator = Number(mixed[2]), denominator = Number(mixed[3]);
    if (!denominator) return null;
    const sign = mixed[1].startsWith("-") ? -1 : 1;
    return sign * (Math.abs(whole) + numerator / denominator);
  }
  const fraction = s.match(/^([+-]?\d+)\s*\/\s*([+-]?\d+)$/);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator ? Number(fraction[1]) / denominator : null;
  }
  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Нормализация координат вида "( 3 ; -2 )" -> "3;-2"
function canonCoords(val) {
  let s = canon(val);
  s = s.replace(/[()]/g, "").replace(/\s+/g, "").replace(/,/g, ";");
  return s;
}

// Парсинг списка чисел (порядок не важен)
function parseList(val) {
  if (!val) return [];
  // Извлекаем все целые и дробные числа или слова
  return String(val)
    .toLowerCase()
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .sort();
}

/** Validate one answer, including alternatives, lists, coordinates, and numeric tolerance. */
function checkAnswer(userVal, correctPattern, type) {
  if (!userVal || !userVal.trim()) return false;
  const userTrim = userVal.trim();

  // Если несколько вариантов ответа разделены пайпом |
  const acceptable = correctPattern.split("|").map((p) => p.trim());

  if (type === "list") {
    const userList = parseList(userTrim);
    for (const pat of acceptable) {
      const patList = parseList(pat);
      if (userList.length === patList.length && userList.every((v, i) => v === patList[i])) {
        return true;
      }
    }
    return false;
  }

  if (type === "coords") {
    const uCoords = canonCoords(userTrim);
    for (const pat of acceptable) {
      if (uCoords === canonCoords(pat)) return true;
    }
    return false;
  }

  // Обычное сравнение с учетом математической гибкости
  const uCanon = canon(userTrim).replace(/,/g, ".").replace(/\s/g, "");
  for (const pat of acceptable) {
    const pCanon = canon(pat).replace(/,/g, ".").replace(/\s/g, "");
    if (uCanon === pCanon) return true;

    // Числовое сравнение с допуском: 3/4 == 0,75, а −3 == -3.
    const uNum = parseMathNumber(userTrim);
    const pNum = parseMathNumber(pat);
    if (uNum !== null && pNum !== null && Math.abs(uNum - pNum) <= 0.0001) {
      return true;
    }
  }

  return false;
}

/* ============================================================
 * 2. ИНИЦИАЛИЗАЦИЯ И РЕНДЕРИНГ ТРЕНАЖЁРА
 * ============================================================ */

function initTrainer() {
  // Загружаем сохраненное имя
  const savedName = localStorage.getItem("math7_student_name") || "";
  const nameInput = $("#studentNameInput");
  if (nameInput) {
    nameInput.value = savedName;
    appState.studentName = savedName;
    nameInput.addEventListener("input", (e) => {
      appState.studentName = e.target.value.trim();
      localStorage.setItem("math7_student_name", appState.studentName);
    });
  }

  // Определение варианта из URL (?variant=K-1)
  const urlParams = new URLSearchParams(window.location.search);
  const variantParam = urlParams.get("variant");
  if (variantParam && TASKS[variantParam]) {
    appState.variantKey = variantParam;
  }

  const variantSelect = $("#variantSelect");
  if (variantSelect) {
    variantSelect.value = appState.variantKey;
    variantSelect.addEventListener("change", (e) => {
      loadVariant(e.target.value);
    });
  }

  // Запуск выбранного варианта
  loadVariant(appState.variantKey);
  setupEvents();
}

function loadVariant(vKey) {
  const data = TASKS[vKey];
  if (!data) return;

  appState.variantKey = vKey;
  appState.currentSlide = 0;
  appState.startTime = new Date();
  appState.results = null;
  appState.telegramAttempted = false;

  // Обновление заголовков
  const titleEl = $("#trainerTitle");
  if (titleEl) titleEl.textContent = data.title;
  const topicEl = $("#trainerTopic");
  if (topicEl) topicEl.textContent = data.topic;

  // Рендеринг слайдов
  const slidesContainer = $("#slidesDeck");
  if (!slidesContainer) return;

  slidesContainer.innerHTML = "";
  const slides = [];

  // Создаем слайды с вопросами
  data.questions.forEach((q, qIdx) => {
    const slide = document.createElement("div");
    slide.className = "slide" + (qIdx === 0 ? " active" : "");
    slide.dataset.slideIndex = qIdx;

    let html = `
      <div class="margin-line"></div>
      <div class="crumb">${formatMath(q.crumb || "Задание " + q.num)}</div>
      <h2 class="task-heading">
        <span class="task-num-badge">${q.num}</span>
        ${formatMath(q.title)}
      </h2>
      ${q.sub ? `<div class="task-sub">${formatMath(q.sub)}</div>` : ""}
      <div class="task-content">
    `;

    q.tasks.forEach((t, tIdx) => {
      html += `<div class="task-row">`;
      if (t.label) {
        html += `<div class="task-text">${formatMath(t.label)}</div>`;
      }
      html += `<div class="task-expression">`;
      t.parts.forEach((part) => {
        if (typeof part === "string") {
          html += `<span>${formatMath(part)}</span>`;
        } else if (part._input !== undefined) {
          const inpMeta = t.inputs[part._input];
          const inputId = `inp_${qIdx}_${tIdx}_${part._input}`;
          html += `
            <input type="text" 
                   class="math-input" 
                   id="${inputId}" 
                   data-answer="${inpMeta.a}" 
                   data-type="${inpMeta.type || ""}"
                   data-weight="${inpMeta.w || 1}"
                   data-group="${inpMeta.g || ""}"
                   data-qnum="${q.num}"
                   data-qtitle="${q.title}"
                   placeholder="ответ" 
                   autocomplete="off" 
                   autocapitalize="off" 
                   spellcheck="false" />
          `;
        }
      });
      html += `</div><div class="answer-feedback" aria-live="polite"></div></div>`;
    });

    if (q.hints && q.hints.length) {
      html += `
        <div class="hint-box">
          <span>💡</span>
          <div>${q.hints.map(formatMath).join("<br>")}</div>
        </div>
      `;
    }

    html += `</div>`;
    slide.innerHTML = html;
    slidesContainer.appendChild(slide);
    slides.push(slide);
  });

  // Добавляем итоговый слайд результатов
  const resultsSlide = document.createElement("div");
  resultsSlide.className = "slide";
  resultsSlide.id = "resultsSlide";
  resultsSlide.dataset.slideIndex = data.questions.length;
  resultsSlide.innerHTML = `
    <div class="margin-line"></div>
    <div class="crumb">Итоги работы · ${data.title}</div>
    <div class="results-header">
      <h2 class="task-heading" style="justify-content:center;">🏁 Работа завершена!</h2>
      <div class="score-box">
        <div class="score-points" id="scoreDisplay">0 / 0</div>
        <div class="score-percent" id="percentDisplay">0%</div>
        <div class="grade-badge" id="gradeDisplay">Оценка: —</div>
      </div>
    </div>
    
    <h3 style="margin-bottom:12px; color:var(--chalk);">📋 Разбор выполненных заданий:</h3>
    <div id="reviewContainer"></div>

    <div class="send-box">
      <h3>📩 Отправить результат учителю</h3>
      <p style="font-size:14.5px; color:#52441a;">
        Отчёт автоматически отправляется учителю при завершении работы. Повторная отправка доступна кнопкой ниже.
      </p>
      <div class="send-inputs">
        <button class="btn-send-tg" id="btnSendTelegram">Отправить результат в Telegram ✈️</button>
        <button class="btn-download-report" id="btnDownloadReport">Скачать отчёт (.txt) 💾</button>
      </div>
      <div class="send-status-msg" id="sendStatusMsg"></div>
    </div>

      <div id="statsSummary" style="text-align:center; margin-top:14px; color:#6d593c; font-size:14px;"></div>
    <div style="display:flex; gap:12px; justify-content:center; margin-top:20px; flex-wrap:wrap;">
      <button class="btn-nav" id="btnResetStats">Сбросить статистику</button>
      <button class="btn-nav" id="btnRestart">🔄 Пройти заново</button>
      <a href="index.html" class="btn-nav" style="text-decoration:none;">📚 Ко всем урокам</a>
    </div>
  `;
  slidesContainer.appendChild(resultsSlide);
  slides.push(resultsSlide);

  appState.slides = slides;
  updateNav();
}

/* ============================================================
 * 3. НАВИГАЦИЯ И ПРОВЕРКА ПОЛЕЙ
 * ============================================================ */

function updateNav() {
  const total = appState.slides.length;
  const cur = appState.currentSlide;
  const isLast = cur === total - 1;

  const prevBtn = $("#btnPrev");
  const nextBtn = $("#btnNext");
  const checkBtn = $("#btnCheck");
  const counter = $("#slideCounter");

  if (prevBtn) prevBtn.disabled = cur === 0;
  if (nextBtn) {
    if (isLast) {
      nextBtn.style.display = "none";
    } else {
      nextBtn.style.display = "inline-block";
      nextBtn.textContent = cur === total - 2 ? "К итогам 🏁" : "Далее ▶";
    }
  }
  if (checkBtn) {
    checkBtn.style.display = isLast ? "none" : "inline-block";
  }
  if (counter) {
    counter.textContent = `${cur + 1} / ${total}`;
  }
}

function goToSlide(index) {
  if (index < 0 || index >= appState.slides.length) return;
  appState.slides.forEach((s, idx) => {
    s.classList.toggle("active", idx === index);
  });
  appState.currentSlide = index;

  // При первом переходе к итогам оцениваем работу и автоматически отправляем отчёт.
  if (index === appState.slides.length - 1) {
    calculateResults();
    if (!appState.telegramAttempted) {
      appState.telegramAttempted = true;
      void sendToTelegram({ automatic: true });
    }
  }

  updateNav();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// Проверка всех полей ввода на текущем слайде
function checkCurrentSlide() {
  const currentSlideEl = appState.slides[appState.currentSlide];
  if (!currentSlideEl) return;

  const inputs = Array.from(currentSlideEl.querySelectorAll(".math-input"));
  let allCorrect = true;

  inputs.forEach((inp) => {
    const userVal = inp.value;
    const pat = inp.dataset.answer;
    const type = inp.dataset.type;
    const isOk = checkAnswer(userVal, pat, type);

    inp.classList.remove("correct", "incorrect");
    const feedback = inp.closest(".task-row")?.querySelector(".answer-feedback");
    if (isOk) {
      inp.classList.add("correct");
      if (feedback) { feedback.className = "answer-feedback correct"; feedback.textContent = "✓ Верно"; }
    } else {
      inp.classList.add("incorrect");
      allCorrect = false;
      if (feedback) {
        feedback.className = "answer-feedback incorrect";
        feedback.innerHTML = `✗ Неверно. Правильный ответ: ${formatMath(pat.split("|")[0])}`;
      }
    }
  });

  return allCorrect;
}

/* ============================================================
 * 4. ПОДСЧЁТ РЕЗУЛЬТАТОВ И ОЦЕНИВАНИЕ
 * ============================================================ */

/** Read persisted attempt counters, returning a fresh shape when storage is empty or invalid. */
function readMath7Stats() {
  try {
    return JSON.parse(localStorage.getItem("math7_stats")) || { attempts: 0, correct: 0, incorrect: 0, lessons: {} };
  } catch {
    return { attempts: 0, correct: 0, incorrect: 0, lessons: {} };
  }
}

/** Add one completed work and its correct/incorrect counts to session and lesson totals. */
function recordMath7Stats(lesson, correct, incorrect) {
  const stats = readMath7Stats();
  stats.attempts += 1;
  stats.correct += correct;
  stats.incorrect += incorrect;
  stats.lessons[lesson] ||= { attempts: 0, correct: 0, incorrect: 0 };
  stats.lessons[lesson].attempts += 1;
  stats.lessons[lesson].correct += correct;
  stats.lessons[lesson].incorrect += incorrect;
  localStorage.setItem("math7_stats", JSON.stringify(stats));
}

function renderMath7Stats() {
  const el = $("#statsSummary");
  if (!el) return;
  const stats = readMath7Stats();
  const lesson = appState.variantKey.split("-")[1];
  const lessonStats = stats.lessons[lesson] || { attempts: 0, correct: 0, incorrect: 0 };
  const current = appState.results || { correctCount: 0, incorrectCount: 0 };
  el.textContent = `Эта работа: ${current.correctCount} верно, ${current.incorrectCount} ошибок · всего: ${stats.attempts} работ, ${stats.correct} верно, ${stats.incorrect} ошибок · урок ${lesson}: ${lessonStats.correct} верно, ${lessonStats.incorrect} ошибок`;
}

function resetMath7Stats() {
  localStorage.removeItem("math7_stats");
  renderMath7Stats();
}

/** Score the current work, persist its counters once, and render the result summary. */
function calculateResults() {
  const shouldRecordStats = !appState.results;
  const allInputs = $$("#slidesDeck .math-input");
  let totalScore = 0;
  let maxScore = 0;
  const reviewItems = [];

  // Группировка по группам оценивания (если заданы)
  const groups = {};

  allInputs.forEach((inp) => {
    const w = parseFloat(inp.dataset.weight || 1);
    const grp = inp.dataset.group;
    const qNum = inp.dataset.qnum;
    const qTitle = inp.dataset.qtitle;
    const val = inp.value;
    const pat = inp.dataset.answer;
    const type = inp.dataset.type;
    const isOk = checkAnswer(val, pat, type);

    if (grp) {
      if (!groups[grp]) {
        groups[grp] = { ok: true, w: w, qNum, qTitle, userVal: [], correctVal: [] };
      }
      if (!isOk) groups[grp].ok = false;
      groups[grp].userVal.push(val || "—");
      groups[grp].correctVal.push(pat);
    } else {
      maxScore += w;
      if (isOk) totalScore += w;
      reviewItems.push({
        qNum,
        qTitle,
        userVal: val || "—",
        correctVal: pat.split("|")[0],
        isOk,
        score: isOk ? w : 0,
        maxScore: w,
      });
    }
  });

  // Добавляем групповые задания
  Object.keys(groups).forEach((gKey) => {
    const g = groups[gKey];
    maxScore += g.w;
    if (g.ok) totalScore += g.w;
    reviewItems.push({
      qNum: g.qNum,
      qTitle: g.qTitle,
      userVal: g.userVal.join(", "),
      correctVal: g.correctVal.map((c) => c.split("|")[0]).join(", "),
      isOk: g.ok,
      score: g.ok ? g.w : 0,
      maxScore: g.w,
    });
  });

  // Расчет процента и оценки
  const percent = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;
  let grade = 2;
  let gradeText = "2 (Требуется повторение)";
  let gradeClass = "grade-2";

  if (percent >= CONFIG.gradeScale[5]) {
    grade = 5;
    gradeText = "5 (Отлично!) 🎉";
    gradeClass = "grade-5";
  } else if (percent >= CONFIG.gradeScale[4]) {
    grade = 4;
    gradeText = "4 (Хорошо) 👍";
    gradeClass = "grade-4";
  } else if (percent >= CONFIG.gradeScale[3]) {
    grade = 3;
    gradeText = "3 (Удовлетворительно) ✍️";
    gradeClass = "grade-3";
  }

  // Расчет времени решения
  const endTime = new Date();
  const timeDiffSec = Math.round((endTime - appState.startTime) / 1000);
  const minutes = Math.floor(timeDiffSec / 60);
  const seconds = timeDiffSec % 60;
  const timeString = `${minutes} мин ${seconds} сек`;

  const correctCount = reviewItems.filter((item) => item.isOk).length;
  const incorrectCount = reviewItems.length - correctCount;
  if (shouldRecordStats) {
    recordMath7Stats(appState.variantKey.split("-")[1], correctCount, incorrectCount);
  }

  appState.results = {
    totalScore,
    maxScore,
    percent,
    grade,
    gradeText,
    timeString,
    reviewItems,
    correctCount,
    incorrectCount,
    date: new Date().toLocaleString("ru-RU"),
  };

  // Вывод на экран
  const scoreDisp = $("#scoreDisplay");
  if (scoreDisp) scoreDisp.textContent = `${totalScore} / ${maxScore} баллов`;

  const percDisp = $("#percentDisplay");
  if (percDisp) percDisp.textContent = `${percent}% выполнено`;

  const gradeDisp = $("#gradeDisplay");
  if (gradeDisp) {
    gradeDisp.textContent = `Оценка: ${gradeText}`;
    gradeDisp.className = `grade-badge ${gradeClass}`;
  }

  // Рендеринг таблицы разбора
  const revCont = $("#reviewContainer");
  if (revCont) {
    let tHtml = `
      <table class="review-table">
        <thead>
          <tr>
            <th>№</th>
            <th>Тема задания</th>
            <th>Ваш ответ</th>
            <th>Верный ответ</th>
            <th>Итог</th>
          </tr>
        </thead>
        <tbody>
    `;

    reviewItems.forEach((item) => {
      tHtml += `
        <tr>
          <td><b>${item.qNum}</b></td>
          <td>${formatMath(item.qTitle)}</td>
          <td>${formatMath(item.userVal)}</td>
          <td>${item.isOk ? "—" : `<b>${formatMath(item.correctVal)}</b>`}</td>
          <td>
            <span class="status-tag ${item.isOk ? "status-ok" : "status-bad"}">
              ${item.isOk ? "✓ Верно" : "✗ Ошибка"}
            </span>
          </td>
        </tr>
      `;
    });

    tHtml += `</tbody></table>`;
    revCont.innerHTML = tHtml;
  }
  renderMath7Stats();
}

/* ============================================================
 * 5. ОТПРАВКА В TELEGRAM BOT API И СКАЧИВАНИЕ ОТЧЁТА
 * ============================================================ */

/** Escape user-controlled strings for Telegram's HTML parse mode. */
function escapeTelegramHtml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Build the HTML report sent to the teacher, preserving the etalon message format. */
function buildTelegramMessage(results) {
  const vData = TASKS[appState.variantKey];
  const name = escapeTelegramHtml(appState.studentName || "Ученик (без имени)");
  let msg = `📚 <b>Тренажёр по математике · 7 класс</b>\n\n`;
  msg += `👤 <b>Ученик:</b> ${name}\n`;
  msg += `📖 <b>Работа:</b> ${escapeTelegramHtml(vData.title)}\n`;
  msg += `📌 <b>Тема:</b> ${escapeTelegramHtml(vData.topic)}\n`;
  msg += `⏱ <b>Время работы:</b> ${escapeTelegramHtml(results.timeString)}\n`;
  msg += `📊 <b>Результат:</b> ${results.totalScore} из ${results.maxScore} баллов (${results.percent}%)\n`;
  msg += `🏆 <b>Оценка:</b> ${escapeTelegramHtml(results.gradeText)}\n`;
  msg += `📅 <b>Дата:</b> ${escapeTelegramHtml(results.date)}\n\n`;

  const mistakes = results.reviewItems.filter((item) => !item.isOk);
  if (mistakes.length === 0) {
    msg += `✅ <b>Все задания выполнены безупречно!</b> 🌟`;
  } else {
    msg += `⚠️ <b>Ошибки в заданиях (${mistakes.length}):</b>\n`;
    mistakes.forEach((item) => {
      msg += `• Зад. ${escapeTelegramHtml(item.qNum)} (${escapeTelegramHtml(item.qTitle)}): ответ "${escapeTelegramHtml(item.userVal)}", верно "${escapeTelegramHtml(item.correctVal)}"\n`;
    });
  }
  return msg;
}

/** Send the completed work directly to Telegram Bot API from the browser. */
async function sendToTelegram({ automatic = false } = {}) {
  const botToken = getTelegramBotToken();
  const chatId = getTelegramChatId();
  if (!botToken || !chatId) {
    const missing = !botToken ? "Bot Token" : "Chat ID";
    showStatusMsg("err", `⚠️ Учителю нужно настроить ${missing} в GitHub Actions Secrets; ученик ничего вводить не должен.`);
    return;
  }
  if (!appState.results) calculateResults();
  showStatusMsg("wait", automatic ? "Автоматически отправляю результат учителю... ⏳" : "Отправляю отчёт учителю в Telegram... ⏳");
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: buildTelegramMessage(appState.results), parse_mode: "HTML" }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.description || `HTTP ${response.status}`);
    showStatusMsg("ok", "✅ Результат автоматически отправлен учителю в Telegram!");
  } catch (error) {
    console.error("Telegram send error:", error);
    showStatusMsg("err", `❌ Не удалось отправить отчёт: ${error.message}. Ученику вводить Chat ID не нужно.`);
  }
}

// Показ статуса отправки
function showStatusMsg(type, text) {
  const el = $("#sendStatusMsg");
  if (!el) return;
  el.className = `send-status-msg ${type}`;
  el.textContent = text;
}

// Скачивание текстового отчёта файлом (.txt)
function downloadReport() {
  if (!appState.results) calculateResults();
  const rawText = buildTelegramMessage(appState.results).replace(/<[^>]+>/g, "");
  const blob = new Blob([rawText], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Отчёт_${appState.studentName || "Ученик"}_${appState.variantKey}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ============================================================
 * 6. СОБЫТИЯ И КЛАВИАТУРА
 * ============================================================ */

function setupEvents() {
  // Навигационные кнопки
  const prevBtn = $("#btnPrev");
  const nextBtn = $("#btnNext");
  const checkBtn = $("#btnCheck");

  if (prevBtn) prevBtn.addEventListener("click", () => goToSlide(appState.currentSlide - 1));
  if (nextBtn) nextBtn.addEventListener("click", () => goToSlide(appState.currentSlide + 1));
  if (checkBtn) checkBtn.addEventListener("click", checkCurrentSlide);

  // Delegated handlers survive rerendering of the results slide.
  document.addEventListener("click", (e) => {
    if (e.target.closest("#btnRestart")) loadVariant(appState.variantKey);
    if (e.target.closest("#btnResetStats")) resetMath7Stats();
    if (e.target.closest("#btnSendTelegram")) void sendToTelegram();
  });

  // Кнопка скачивания файла
  const dlBtn = $("#btnDownloadReport");
  if (dlBtn) dlBtn.addEventListener("click", downloadReport);

  // Клавиатурные сокращения
  document.addEventListener("keydown", (e) => {
    // Не перехватываем, если открыто модальное окно или фокус в текстовом поле
    if (e.target.tagName === "INPUT" && e.key === "Enter") {
      checkCurrentSlide();
      return;
    }
    if (e.target.tagName === "INPUT") return;

    if (e.key === "ArrowRight") {
      goToSlide(appState.currentSlide + 1);
    } else if (e.key === "ArrowLeft") {
      goToSlide(appState.currentSlide - 1);
    }
  });
}

/* ============================================================
 * 7. МОДАЛЬНЫЕ ОКНА: ТЕОРИЯ И НАСТРОЙКИ TELEGRAM
 * ============================================================ */

// Открытие теории к уроку
function openTheoryModal(lessonNum) {
  const modal = $("#theoryModal");
  const content = $("#theoryContent");
  if (!modal || !content) return;

  const data = THEORY_DATA[lessonNum];
  if (!data) return;

  let html = `
    <h3 class="modal-title">📖 Урок ${lessonNum}. ${data.title}</h3>
    <div style="font-size:13.5px; color:#8c7857; margin-bottom:12px;">
      УМК: <b>${data.umk}</b> · <span class="badge badge-adv">${data.badge}</span>
    </div>
    <div style="margin-bottom:14px;">
  `;

  data.rules.forEach((rule) => {
    html += `<div class="theory-rule-item">📌 ${formatMath(rule)}</div>`;
  });

  html += `</div>`;
  if (data.sample) {
    html += `
      <div class="theory-sample">
        <b>💡 Пример решения:</b><br>${formatMath(data.sample)}
      </div>
    `;
  }

  content.innerHTML = html;
  modal.classList.add("open");
}

function closeTheoryModal() {
  const modal = $("#theoryModal");
  if (modal) modal.classList.remove("open");
}

// Открытие окна настроек Telegram
function openTelegramSettingsModal() {
  const modal = $("#settingsModal");
  if (modal) modal.classList.add("open");
}

function closeTelegramSettingsModal() {
  const modal = $("#settingsModal");
  if (modal) modal.classList.remove("open");
}

/** Send a test message to the teacher's fixed, build-configured recipient. */
async function testTelegramPing() {
  const status = $("#settingStatusMsg");
  const botToken = getTelegramBotToken();
  const chatId = getTelegramChatId();
  if (!botToken || !chatId) {
    if (status) {
      status.className = "send-status-msg err";
      status.textContent = `⚠️ Не настроен ${!botToken ? "Bot Token" : "Chat ID"}. Учителю нужно задать GitHub Actions Secrets.`;
    }
    return;
  }
  if (status) { status.className = "send-status-msg wait"; status.textContent = "Отправляю тестовое сообщение... ⏳"; }
  const text = `🔔 <b>Тестовое подключение успешно!</b>\n\nТренажёр по математике (7 класс) подключён к боту @${CONFIG.telegram.botUsername}.`;
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.description || `HTTP ${response.status}`);
    if (status) { status.className = "send-status-msg ok"; status.textContent = "🎉 Тестовое сообщение доставлено в настроенный чат учителя."; }
  } catch (error) {
    if (status) { status.className = "send-status-msg err"; status.textContent = `❌ Не удалось проверить Telegram: ${error.message}`; }
  }
}

// Автозапуск при загрузке страницы
document.addEventListener("DOMContentLoaded", () => {
  if ($("#slidesDeck")) {
    initTrainer();
  }
});
