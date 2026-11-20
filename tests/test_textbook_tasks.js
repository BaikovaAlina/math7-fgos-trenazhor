"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// Load script logic (formatMath and checkAnswer)
const script = read("script.js");
const formatterStart = script.indexOf("function escapeMathHtml(");
const formatterEnd = script.indexOf("/* ============================================================\n * 1. НОРМАЛИЗАЦИЯ", formatterStart);
const validatorStart = formatterEnd;
const validatorEnd = script.indexOf("/* ============================================================\n * 2. ИНИЦИАЛИЗАЦИЯ", validatorStart);

const logic = { window: {} };
vm.createContext(logic);
vm.runInContext(
  script.slice(formatterStart, formatterEnd) +
  script.slice(validatorStart, validatorEnd) +
  ";globalThis.renderMath = formatMath; globalThis.checkAnswer = checkAnswer;",
  logic
);

// Load textbook tasks
const textbookTasksRaw = read("textbook_tasks.json");
const tasks = JSON.parse(textbookTasksRaw);
assert.equal(tasks.length, 282, "Textbook task bank must contain exactly 282 tasks");

// Track sources and difficulties
const textbookCounts = {};
const levelCounts = {};
const seenPrompts = new Set();

for (const t of tasks) {
  // Required fields
  for (const f of ["id", "module", "lesson", "variant", "num", "textbook", "topic", "level", "title", "prompt", "answer", "solution", "hints", "theory"]) {
    assert(t[f] !== undefined && t[f] !== null && String(t[f]).trim().length > 0,
      `Task ${t.id} missing or empty field: ${f}`);
  }

  // Textbooks
  textbookCounts[t.textbook] = (textbookCounts[t.textbook] || 0) + 1;
  levelCounts[t.level] = (levelCounts[t.level] || 0) + 1;

  // Hints and theory
  assert(t.hints.length >= 1, `Task ${t.id} must have hints`);
  assert(t.theory.length >= 1, `Task ${t.id} must have theory`);

  // Prompt uniqueness
  const normPrompt = t.prompt.trim().toLowerCase();
  assert(!seenPrompts.has(normPrompt), `Duplicate prompt in textbook tasks: ${t.prompt}`);
  seenPrompts.add(normPrompt);

  // Formatting verification: no raw caret left outside math-tex
  const formattedPrompt = logic.renderMath(t.prompt);
  const withoutTexPrompt = formattedPrompt.replace(/<span class="math-tex">\\\(.*?\\\)<\/span>/g, "");
  assert(!withoutTexPrompt.includes("^"),
    `Unparsed ^ in prompt of ${t.id}: ${t.prompt} => ${formattedPrompt}`);

  const formattedSolution = logic.renderMath(t.solution);
  const withoutTexSolution = formattedSolution.replace(/<span class="math-tex">\\\(.*?\\\)<\/span>/g, "");
  assert(!withoutTexSolution.includes("^"),
    `Unparsed ^ in solution of ${t.id}: ${t.solution} => ${formattedSolution}`);

  // Answer check verification
  const alternatives = t.answer.split("|");
  for (const alt of alternatives) {
    const isValid = logic.checkAnswer(alt, t.answer, t.type || "");
    assert(isValid, `Answer key '${alt}' failed checkAnswer for ${t.id} (key: ${t.answer})`);
  }
}

// Verify textbook distributions
assert(textbookCounts["Галицкий М.Л. «Сборник задач по алгебре 7 класс»"] >= 70,
  "Galitsky problem book must provide at least 70 algebra tasks");
assert(textbookCounts["Петерсон Л.Г. «Алгебра 7 класс»"] >= 70,
  "Peterson algebra textbook must provide at least 70 algebra tasks");
assert(textbookCounts["Атанасян Л.С. «Геометрия 7–9 класс»"] >= 70,
  "Atanasyan geometry textbook must provide at least 70 geometry tasks");

// Verify levels
assert(levelCounts["Базовый"] >= 70, "Must include plenty of Base level tasks");
assert(levelCounts["Средний"] >= 70, "Must include plenty of Medium level tasks");
assert(levelCounts["Повышенный"] >= 70, "Must include plenty of Advanced level tasks");

// Verify integration into TASKS
const fullContext = { window: {}, console: console };
vm.createContext(fullContext);
vm.runInContext(read("tasks.js") + "\n" + read("theory.js") + "\n" + read("textbook_tasks.js") + ";globalThis.TASKS = TASKS;", fullContext);

// Check that every single lesson from 1 to 24 has >= 10 tasks in both K and D variants
for (let lesson = 1; lesson <= 24; lesson++) {
  const kVar = `K-${lesson}`;
  const dVar = `D-${lesson}`;
  assert(fullContext.TASKS[kVar], `Variant ${kVar} must exist`);
  assert(fullContext.TASKS[dVar], `Variant ${dVar} must exist`);
  assert(fullContext.TASKS[kVar].questions.length >= 10,
    `Variant ${kVar} must have at least 10 questions (got ${fullContext.TASKS[kVar].questions.length})`);
  assert(fullContext.TASKS[dVar].questions.length >= 10,
    `Variant ${dVar} must have at least 10 questions (got ${fullContext.TASKS[dVar].questions.length})`);
}

// Verify HTML script tags
const trainerHtml = read("trainer.html");
const indexHtml = read("index.html");
assert(trainerHtml.includes("textbook_tasks.js"), "trainer.html must load textbook_tasks.js");
assert(indexHtml.includes("textbook_tasks.js"), "index.html must load textbook_tasks.js");

console.log(`PASS: Textbook task bank verified: 282 tasks (${JSON.stringify(textbookCounts)})`);
console.log(`PASS: Difficulties: ${JSON.stringify(levelCounts)}`);
console.log(`PASS: All 48 K/D variants now have >= 10 questions (each lesson has 20 questions total)`);
console.log(`PASS: All answer keys pass checkAnswer, all formulas properly rendered via MathJax`);
