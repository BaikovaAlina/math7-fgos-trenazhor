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
};

// Вспомогательные функции селекторов
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

/* ============================================================
 * ЕДИНЫЙ РЕНДЕР ФОРМУЛ ЧЕРЕЗ MATHJAX 3 С ТЕКСТОВЫМ FALLBACK
 * ============================================================ */
function escapeMathHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);
}

function readableMath(tex) {
  return String(tex)
    .replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "$1 over $2")
    .replace(/\\sqrt\s*\{([^{}]+)\}/g, "√($1)")
    .replace(/\\cdot/g, "·").replace(/\\times/g, "×").replace(/\\div/g, "÷")
    .replace(/\\leq/g, "≤").replace(/\\geq/g, "≥").replace(/\\ne/g, "≠")
    .replace(/\\left|\\right/g, "").replace(/\\[,; ]/g, " ")
    .replace(/\^\{([^{}]+)\}/g, "^($1)")
    .replace(/[{}]/g, "").replace(/\\/g, "").trim();
}

/** Build a slash-free, safely escaped fallback while MathJax is loading or unavailable. */
function readTexArgument(source, start) {
  let index = start;
  while (/\s/.test(source[index] || "")) index++;
  if (source[index] === "{") {
    let depth = 1;
    let cursor = index + 1;
    for (; cursor < source.length; cursor++) {
      if (source[cursor] === "\\") { cursor++; continue; }
      if (source[cursor] === "{") depth++;
      else if (source[cursor] === "}" && --depth === 0) {
        return { value: source.slice(index + 1, cursor), end: cursor + 1 };
      }
    }
    return { value: source.slice(index + 1), end: source.length };
  }
  if (source[index] === "\\") {
    const command = source.slice(index + 1).match(/^[A-Za-z]+/);
    if (command) return { value: `\\${command[0]}`, end: index + command[0].length + 1 };
  }
  return { value: source[index] || "", end: Math.min(index + 1, source.length) };
}

function fallbackMathHtml(tex) {
  const symbols = {
    cdot: "·", times: "×", div: "÷", leq: "≤", geq: "≥", ne: "≠", neq: "≠",
    pm: "±", mp: "∓", infty: "∞", pi: "π", alpha: "α", beta: "β", gamma: "γ",
    theta: "θ", angle: "∠", approx: "≈", percent: "%",
  };
  function render(source) {
    let html = "";
    for (let i = 0; i < source.length;) {
      if (source[i] === "\\") {
        const commandMatch = source.slice(i + 1).match(/^[A-Za-z]+/);
        if (commandMatch) {
          const command = commandMatch[0];
          const after = i + command.length + 1;
          if (command === "frac" || command === "dfrac" || command === "tfrac") {
            const numerator = readTexArgument(source, after);
            const denominator = readTexArgument(source, numerator.end);
            html += `<span class="math-fallback-fraction"><span class="math-fallback-numerator">${render(numerator.value)}</span><span class="math-fallback-denominator">${render(denominator.value)}</span></span>`;
            i = denominator.end;
            continue;
          }
          if (command === "sqrt") {
            const radicand = readTexArgument(source, after);
            html += `√(${render(radicand.value)})`;
            i = radicand.end;
            continue;
          }
          if (command === "left" || command === "right") { i = after; continue; }
          if (command === "text" || command === "mathrm") {
            const argument = readTexArgument(source, after);
            html += render(argument.value);
            i = argument.end;
            continue;
          }
          html += escapeMathHtml(symbols[command] || command);
          i = after;
          continue;
        }
        const escaped = source[i + 1] || "";
        html += escaped === "," || escaped === ";" ? " " : escapeMathHtml(escaped);
        i += 2;
        continue;
      }
      if (source[i] === "^" || source[i] === "_") {
        const argument = readTexArgument(source, i + 1);
        const tag = source[i] === "^" ? "sup" : "sub";
        html += `<${tag}>${render(argument.value)}</${tag}>`;
        i = argument.end;
        continue;
      }
      if (source[i] === "{") { i++; continue; }
      if (source[i] === "}") { i++; continue; }
      const ch = source[i++];
      html += escapeMathHtml(ch === "-" ? "−" : ch);
    }
    return html;
  }
  return render(String(tex));
}

/** Normalize keyboard-era algebra notation and ratios before MathJax typesets a run. */
function texifyExpression(expression) {
  let tex = String(expression).replace(/[−–—]/g, "-").replace(/\*\*/g, "^");
  tex = tex.replace(/\\sqrt\s*\(([^()]+)\)/g, "\\sqrt{$1}")
    .replace(/√\s*\(([^()]+)\)/g, "\\sqrt{$1}")
    .replace(/√\s*([A-Za-z0-9]+)/g, "\\sqrt{$1}");

  tex = tex.replace(/\(([^()]+)\)\s*\/\s*\(([^()]+)\)/g,
    (_, numerator, denominator) => `\\frac{${texifyExpression(numerator)}}{${texifyExpression(denominator)}}`)
    .replace(/\(([^()]+)\)\s*\/\s*([A-Za-z0-9]+)/g,
      (_, numerator, denominator) => `\\frac{${texifyExpression(numerator)}}{${denominator}}`);

  // Algebraic ratios, including monomial numerators and denominators such as 6x^2/9x.
  const operand = String.raw`(?:\\sqrt\{[^{}]*\}|\([^()]*\)|[+-]?(?:(?:\d+(?:[.,]\d+)?)?[A-Za-z](?:\^\{[^{}]+\}|\^-?\d+)?(?:[A-Za-z](?:\^\{[^{}]+\}|\^-?\d+)?)*|\d+(?:[.,]\d+)?))`;
  const ratio = new RegExp(`(?<![\\p{L}\\p{N}])(${operand})\\s*/\\s*(${operand})(?![\\p{L}\\p{N}])`, "gu");
  tex = tex.replace(ratio, (_, numerator, denominator) => `\\frac{${numerator}}{${denominator}}`);

  return tex.replace(/[×*·]/g, "\\cdot ").replace(/÷/g, "\\div ")
    .replace(/(\d),(\d)/g, "$1{,}$2")
    .replace(/≤/g, "\\leq ").replace(/≥/g, "\\geq ").replace(/≠/g, "\\ne ");
}

/** Shared legacy-power normalization for rendering and exact symbolic-answer comparison. */
function normalizeAlgebraNotation(value) {
  const superscriptDigits = { "⁰":"0", "¹":"1", "²":"2", "³":"3", "⁴":"4", "⁵":"5", "⁶":"6", "⁷":"7", "⁸":"8", "⁹":"9", "⁺":"+", "⁻":"-" };
  return String(value)
    .replace(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi, "^{$1}")
    .replace(/\*\*/g, "^")
    .replace(/([A-Za-z0-9)])([⁺⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (_, base, exp) => `${base}^{${exp.replace(/[⁺⁻⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (ch) => superscriptDigits[ch])}}`)
    .replace(/\(([^()]+)\)\s*([23])(?=[\s+\-*/=),.]|$)/g, "($1)^{$2}")
    .replace(/([A-Za-z])([23])(?=[A-Za-z]|[\s+\-*/=),.]|$)/g, "$1^$2")
    .replace(/\^\?/g, "^{?}")
    .replace(/\^\(([^()]+)\)/g, "^{$1}")
    .replace(/√\s*\(([^()]+)\)/g, "\\sqrt{$1}")
    .replace(/√\s*([A-Za-z0-9]+)/g, "\\sqrt{$1}");
}

function formatMath(text) {
  if (text == null || typeof text !== "string" || !text) return text;

  // Normalize legacy exponents and roots before converting formula runs.
  text = normalizeAlgebraNotation(text);

  // Leave trusted inline HTML (such as bold theory labels) outside the math parser.
  const tags = text.split(/(<[^>]*>)/g);
  return tags.map((part) => {
    if (part.startsWith("<") && part.endsWith(">")) return part;

    // URLs are not algebraic ratios.
    const urls = [];
    let chunk = part.replace(/https?:\/\/[^\s"'<>]+/g, (url) => {
      const marker = String.fromCharCode(0xF000 + urls.length);
      urls.push(url);
      return marker;
    });
    const mathNodes = [];
    const slot = (tex, fallback) => {
      const index = mathNodes.length;
      mathNodes.push(`<span class="math-render"><span class="math-fallback">${fallbackMathHtml(tex)}</span><span class="math-tex">\\(${escapeMathHtml(tex)}\\)</span></span>`);
      return String.fromCharCode(0xE000 + index);
    };
    const containsSlot = (value) => /[\uE000-\uEFFF]/.test(value);

    // Explicit LaTeX blocks remain a single formula and are normalized uniformly.
    chunk = chunk.replace(/\\\(([\s\S]+?)\\\)/g,
      (whole, tex) => slot(texifyExpression(tex), readableMath(tex)));

    // Keep mixed numerals in one MathJax node (e.g. −2\\frac{1}{3}).
    chunk = chunk.replace(/(?<![A-Za-z0-9])([−-]?\d+)\\(?:dfrac|tfrac|frac)\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g,
      (whole, integer, numerator, denominator) => slot(`${integer}\\frac{${numerator}}{${denominator}}`, whole));

    // Protect complete TeX fractions and radicals before scanning their nested contents.
    const texCommand = /\\(dfrac|tfrac|frac|sqrt)(?![A-Za-z])\s*/g;
    let protectedTex = "";
    let commandMatch;
    let commandCursor = 0;
    while ((commandMatch = texCommand.exec(chunk))) {
      const command = commandMatch[1];
      const first = readTexArgument(chunk, texCommand.lastIndex);
      if (first.end <= texCommand.lastIndex) continue;
      let last = first.end;
      let tex;
      if (command === "sqrt") {
        tex = `\\sqrt{${first.value}}`;
      } else {
        const second = readTexArgument(chunk, first.end);
        if (second.end <= first.end) continue;
        last = second.end;
        tex = `\\frac{${first.value}}{${second.value}}`;
      }
      protectedTex += chunk.slice(commandCursor, commandMatch.index) + slot(tex, readableMath(tex));
      commandCursor = last;
      texCommand.lastIndex = last;
    }
    if (commandCursor) chunk = protectedTex + chunk.slice(commandCursor);

    // Mixed numbers must be processed before the general expression scanner.
    chunk = chunk.replace(/[⁄／]/g, "/");
    chunk = chunk.replace(/(?<![A-Za-z0-9])([−-]?\d+)\s+(\d+)\s*\/\s*(\d+)(?![A-Za-z0-9])/g,
      (whole, sign, numerator, denominator) => {
        const normalized = sign.replace(/−/g, "-");
        const minus = normalized.startsWith("-") ? "-" : "";
        return slot(`${minus}${Math.abs(Number(normalized))}\\frac{${numerator}}{${denominator}}`, whole);
      });

    // Implicit products (2(a+b), x(x+1), (a+b)(a-b)) stay one formula unit.
    const implicitProduct = /(?<![A-Za-z0-9])([+-]?(?:(?:\d+)?[A-Za-z](?:\^\{[^{}]+\}|\^-?\d+)?(?:[A-Za-z](?:\^\{[^{}]+\}|\^-?\d+)?)*|\d+))((?:\([^()]+\))+)(?![A-Za-z0-9])/g;
    chunk = chunk.replace(implicitProduct, (whole, left, right) => {
      if (containsSlot(whole)) return whole;
      const tex = texifyExpression(`${left}${right}`);
      return slot(tex, whole);
    });
    const adjacentBinomials = /(?<![A-Za-z0-9])(\([^()]+\))(\([^()]+\))(?![A-Za-z0-9])/g;
    chunk = chunk.replace(adjacentBinomials, (whole) => containsSlot(whole) ? whole : slot(texifyExpression(whole), whole));

    // Keep a powered parenthesized expression intact, rather than typesetting its interior first.
    chunk = chunk.replace(/(?<![A-Za-z0-9])\(([^()]+)\)\^((?:\{[^{}]+\})|-?\d+)(?![A-Za-z0-9])/g,
      (whole, base, exponent) => {
        if (containsSlot(whole)) return whole;
        const tex = texifyExpression(`(${base})^${exponent}`);
        return slot(tex, readableMath(tex));
      });

    // Wrap whole algebraic sequences together: powers, polynomials, products, ratios, roots.
    const atom = String.raw`(?:\\frac\{[^{}]*\}\{[^{}]*\}|\\sqrt\{[^{}]*\}|\|[^|]+\||\([^()]*\)(?:\^\{[^{}]+\}|\^-?[A-Za-z0-9]+)?|(?:[+-]?(?:\d+(?:[.,]\d+)?)?)(?:[A-Za-z](?:\^\{[^{}]+\}|\^-?[A-Za-z0-9]+)?)+|[+-]?\d+(?:[.,]\d+)?(?:°|%)?)`;
    const operator = String.raw`(?:[+\-−=×*·/:<>≤≥])`;
    const sequence = new RegExp(`(?<![\\p{L}\\p{N}({])(${atom}(?:\\s*${operator}\\s*${atom})+)(?![\\p{L}\\p{N}])`, "gu");
    chunk = chunk.replace(sequence, (whole, expression) => {
      if (containsSlot(expression)) return whole;
      const tex = texifyExpression(expression);
      return slot(tex, readableMath(tex));
    });

    // Unicode fraction glyphs are normalized too, with a readable non-MathJax fallback.
    const unicodeFractions = { "½":"1/2", "⅓":"1/3", "⅔":"2/3", "¼":"1/4", "¾":"3/4", "⅕":"1/5", "⅖":"2/5", "⅗":"3/5", "⅘":"4/5", "⅙":"1/6", "⅚":"5/6", "⅛":"1/8", "⅜":"3/8", "⅝":"5/8", "⅞":"7/8" };
    chunk = chunk.replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, (glyph) => {
      const [numerator, denominator] = unicodeFractions[glyph].split("/");
      return slot(`\\frac{${numerator}}{${denominator}}`, unicodeFractions[glyph]);
    });

    // Standalone powers and absolute values must be protected before monomial matching.
    chunk = chunk.replace(/(?<![A-Za-z0-9])((?:\([^()]+\)|[A-Za-z0-9]+))\^((?:\{[^{}]+\})|-?\d+)(?![A-Za-z0-9])/g,
      (whole, base, exponent) => {
        const tex = texifyExpression(`${base}^${exponent}`);
        return slot(tex, readableMath(tex));
      });
    chunk = chunk.replace(/(?<![A-Za-z0-9])\|([^|\uE000-\uEFFF]+)\|/g,
      (whole, inner) => slot(`\\left|${texifyExpression(inner)}\\right|`, whole));

    // Standalone monomials (2a, 3ab, -5x^2y) use the same MathJax path.
    const monomial = /(?<![A-Za-z0-9])([+-]?(?:(?:\d+(?:[.,]\d+)?)?[A-Za-z](?:\^\{[^{}]+\}|\^-?[A-Za-z0-9]+)?(?:[A-Za-z](?:\^\{[^{}]+\}|\^-?[A-Za-z0-9]+)?)*))(?![A-Za-z0-9])/g;
    chunk = chunk.replace(monomial, (whole, expression) => {
      const tex = texifyExpression(expression);
      return slot(tex, readableMath(tex));
    });

    // A final legacy pass for any isolated slash fraction or radical missed by the scanner.
    chunk = chunk.replace(/(?<![A-Za-z0-9])([−-]?\d+|[A-Za-z])\s*\/\s*(\d+|[A-Za-z])(?![A-Za-z0-9])/g,
      (whole, numerator, denominator) => {
        const tex = texifyExpression(`${numerator}/${denominator}`);
        return slot(tex, whole);
      });
    chunk = chunk.replace(/\\sqrt\s*\{([^{}]+)\}/g,
      (whole, radicand) => slot(`\\sqrt{${radicand}}`, `√(${radicand})`));

    chunk = chunk.replace(/[\uE000-\uEFFF]/g, (marker) => mathNodes[marker.charCodeAt(0) - 0xE000]);
    chunk = chunk.replace(/[\uF000-\uF0FF]/g, (marker) => urls[marker.charCodeAt(0) - 0xF000]);
    return chunk;
  }).join("");
}

/** Build a 2–5 line accordion from exercise hints plus the lesson's theory reference. */
function getQuestionTheory(q) {
  if (Array.isArray(q.theory) && q.theory.length) return q.theory.slice(0, 5);
  const lines = [...(q.hints || [])];
  const lessonNumber = Number(String(appState.variantKey).split("-").pop());
  const lessonRules = THEORY_DATA[lessonNumber]?.rules || [];
  for (const rule of lessonRules) {
    if (lines.length >= 3) break;
    if (!lines.includes(rule)) lines.push(rule);
  }
  if (lines.length < 2 && q.sub) lines.push(q.sub);
  return lines.slice(0, 5);
}

/** Typeset only the newly inserted subtree; fallback text stays visible on CDN failure. */
function typesetMath(root) {
  const mathJax = window.MathJax;
  if (!root || !mathJax || typeof mathJax.typesetPromise !== "function") return;
  mathJax.typesetPromise([root]).then(() => {
    root.querySelectorAll(".math-render").forEach((node) => {
      if (node.querySelector("mjx-container")) node.classList.add("is-rendered");
    });
  }).catch((error) => console.warn("MathJax render failed; showing plain-text formulas.", error));
}

/* ============================================================
 * 1. НОРМАЛИЗАЦИЯ И ПРОВЕРКА ОТВЕТОВ
 * ============================================================ */

// Очистка и канонизация строки ответа
function canon(val) {
  if (val == null) return "";
  const raw = String(val).trim().toLowerCase().replace(/sqrt\s*\(?\s*([a-z0-9]+)\s*\)?/g, "\\sqrt{$1}");
  let s = normalizeAlgebraNotation(raw);
  s = s.replace(/\\[()]/g, "")
    .replace(/\\(?:dfrac|tfrac|frac)\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, (_, numerator, denominator) => {
      const needsGrouping = (part) => /[+]/.test(part) || /-(?!^)/.test(part);
      const top = needsGrouping(numerator) ? `(${numerator})` : numerator;
      const bottom = needsGrouping(denominator) ? `(${denominator})` : denominator;
      return `${top}/${bottom}`;
    })
    .replace(/\^\{([A-Za-z0-9+-]+)\}/g, "^$1")
    .replace(/\\left|\\right/g, "")
    .replace(/\\sqrt\s*\{([^{}]+)\}/g, "sqrt($1)")
    .replace(/sqrt\s*\(([^()]*)\)/gi, "sqrt$1")
    .replace(/\\cdot|\\times/g, "·").replace(/\\div/g, ":")
    .replace(/[−–—]/g, "-").replace(/°/g, "")
    .replace(/[×*х∙⋅]/g, "·")
    .replace(/\s+/g, " ");
  return s;
}

/** Convert an integer, decimal, common fraction, or mixed number to Number. */
function parseMathNumber(value) {
  let s = String(value ?? "").trim().replace(/[−–—]/g, "-");
  s = s.replace(/([+-]?\d+)(?:\\[,; ]*)?\\(?:dfrac|tfrac|frac)\s*\{(\d+)\}\s*\{(\d+)\}/g,
      (_, whole, numerator, denominator) => {
        const sign = whole.startsWith("-") ? -1 : 1;
        return String(sign * (Math.abs(Number(whole)) + Number(numerator) / Number(denominator)));
      })
    .replace(/\\[,; ]/g, " ")
    .replace(/\\[()]/g, "")
    .replace(/\\(?:dfrac|tfrac|frac)\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "$1/$2")
    .replace(/[{}]/g, "")
    .replace(/,/g, ".");
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

// Public, read-only helpers for the optional offline practice/VPR page.
window.Math7Answer = Object.freeze({ checkAnswer, parseMathNumber });
window.Math7Format = formatMath;

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

  // Обновление заголовков
  const titleEl = $("#trainerTitle");
  if (titleEl) titleEl.textContent = data.title;
  const topicEl = $("#trainerTopic");
  if (topicEl) topicEl.textContent = data.topic;

  // Рендеринг слайдов
  const slidesContainer = $("#slidesDeck");
  if (!slidesContainer) return;

  if (window.MathJax?.typesetClear) window.MathJax.typesetClear([slidesContainer]);
  slidesContainer.innerHTML = "";
  const slides = [];

  // Создаем слайды с вопросами
  data.questions.forEach((q, qIdx) => {
    const slide = document.createElement("div");
    slide.className = "slide" + (qIdx === 0 ? " active" : "");
    slide.dataset.slideIndex = qIdx;

    let html = `
      <div class="margin-line"></div>
      <div class="crumb">${formatMath(q.crumb || "Задание " + q.num)}${q.level ? ` · ${q.level}` : ""}</div>
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

    // Compact, collapsed theory is available beside every exercise.
    const theoryLines = getQuestionTheory(q);
    if (theoryLines.length) {
      html += `
        <details class="hint-box theory-accordion">
          <summary>📘 Краткая теория</summary>
          <div class="theory-accordion-content">${theoryLines.map(formatMath).join("<br>")}</div>
          ${q.theory && q.hints?.length ? `<div class="theory-sample"><b>Короткий разбор:</b><br>${q.hints.map(formatMath).join("<br>")}</div>` : ""}
        </details>
      `;
    }

    html += `</div>`;
    slide.innerHTML = html;
    slide.querySelectorAll(".theory-accordion").forEach((accordion) => {
      accordion.addEventListener("toggle", () => {
        if (accordion.open) typesetMath(accordion);
      });
    });
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
        Нажмите кнопку ниже — готовый отчёт отправится учителю. Chat ID ученику вводить не нужно.
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
  typesetMath(slidesContainer);
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

  // При переходе к итогам считаем результат; отправка выполняется отдельной кнопкой.
  if (index === appState.slides.length - 1) calculateResults();

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
    if (feedback && window.MathJax?.typesetClear) window.MathJax.typesetClear([feedback]);
    if (isOk) {
      inp.classList.add("correct");
      if (feedback) { feedback.className = "answer-feedback correct"; feedback.textContent = "✓ Верно"; }
    } else {
      inp.classList.add("incorrect");
      allCorrect = false;
      if (feedback) {
        feedback.className = "answer-feedback incorrect";
        feedback.innerHTML = `✗ Неверно. Правильный ответ: ${formatMath(pat.split("|")[0])}`;
        typesetMath(feedback);
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
    if (window.MathJax?.typesetClear) window.MathJax.typesetClear([revCont]);
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
    typesetMath(revCont);
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
async function sendToTelegram() {
  const botToken = getTelegramBotToken();
  const chatId = getTelegramChatId();
  if (!botToken || !chatId) {
    const missing = !botToken ? "Bot Token" : "Chat ID";
    showStatusMsg("err", `⚠️ Учителю нужно настроить ${missing} в GitHub Actions Secrets; ученик ничего вводить не должен.`);
    return;
  }
  if (!appState.results) calculateResults();
  showStatusMsg("wait", "Отправляю отчёт учителю в Telegram... ⏳");
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: buildTelegramMessage(appState.results), parse_mode: "HTML" }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.description || `HTTP ${response.status}`);
    showStatusMsg("ok", "✅ Результат отправлен учителю в Telegram!");
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

  if (window.MathJax?.typesetClear) window.MathJax.typesetClear([content]);
  content.innerHTML = html;
  modal.classList.add("open");
  typesetMath(content);
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
