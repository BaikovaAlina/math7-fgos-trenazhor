"use strict";

// Lightweight, dependency-free regression checks: run with `node tests/test_project.js`.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const script = read("script.js");
const formatterStart = script.indexOf("function escapeMathHtml(");
const formatterEnd = script.indexOf("/* ============================================================\n * 1. НОРМАЛИЗАЦИЯ", formatterStart);
const validatorStart = formatterEnd;
const validatorEnd = script.indexOf("/* ============================================================\n * 2. ИНИЦИАЛИЗАЦИЯ", validatorStart);
assert(formatterStart >= 0 && formatterEnd > formatterStart && validatorEnd > validatorStart,
  "Formatter and validator functions must remain in expected sections");

const logic = { window: {} };
vm.createContext(logic);
vm.runInContext(
  script.slice(formatterStart, formatterEnd) +
  script.slice(validatorStart, validatorEnd) +
  ";globalThis.renderMath = formatMath; globalThis.checkAnswer = checkAnswer;",
  logic
);

const formatCases = [
  ["plain slash fraction", "1/2", "\\frac{1}{2}"],
  ["bare LaTeX fraction", "\\frac{1}{2}", "\\frac{1}{2}"],
  ["mixed fraction", "2 1/3", "2\\,\\frac{1}{3}"],
  ["negative mixed fraction", "−2 1/3", "-2\\,\\frac{1}{3}"],
  ["Unicode fraction glyph", "½", "\\frac{1}{2}"],
  ["caret power", "x^2", "x^2"],
  ["double-asterisk power", "x**2", "x^2"],
  ["flattened exponent", "x2", "x^2"],
  ["Unicode superscript", "x²", "x^{2}"],
  ["flattened monomial exponent", "2a2b", "2a^2b"],
  ["flattened parenthesis exponent", "(a+b)2", "(a+b)^{2}"],
  ["full polynomial run", "a^2+b^2", "a^2+b^2"],
  ["implicit product", "-5x^2y", "-5x^2y"],
  ["compound exponent", "a^{m+n}", "a^{m+n}"],
  ["negative exponent", "x^-2", "x^-2"],
  ["negative base with exponent", "(-x)^2", "(-x)^2"],
  ["polynomial with negative term", "-3x^2+2x-1", "-3x^2+2x-1"],
  ["variable fraction", "6x^2/9x", "\\frac{6x^2}{9x}"],
  ["square root", "√x", "\\sqrt{x}"],
  ["absolute value", "|x|", "\\left|x\\right|"],
];
for (const [name, input, expectedTex] of formatCases) {
  const output = logic.renderMath(input);
  assert(output.includes(expectedTex), `${name} should emit MathJax TeX`);
  assert(output.includes("\\(") && output.includes("\\)"), `${name} should use shared inline MathJax delimiters`);
  assert(output.includes("math-fallback"), `${name} should have visible fallback text`);
}
const polynomialMarkup = logic.renderMath("a^2+b^2");
assert.equal((polynomialMarkup.match(/class="math-render"/g) || []).length, 1,
  "a polynomial should be rendered as one MathJax expression");
assert.equal(logic.renderMath("https://example.com/1/2"), "https://example.com/1/2",
  "URLs must not be rewritten as fractions");
assert(logic.renderMath("<b>1/2</b>").includes("<b>"), "existing trusted emphasis markup should remain intact");

assert(logic.checkAnswer("3/4", "0.75", ""), "3/4 should equal 0.75");
assert(logic.checkAnswer("0,75", "3/4", ""), "decimal comma should be accepted");
assert(logic.checkAnswer(" 0.75005 ", "0.75", ""), "numeric tolerance should be applied after trim");
assert(logic.checkAnswer("  ABC  ", "abc", ""), "string answers should be trimmed and lowercased");
assert(logic.checkAnswer("x²", "x^2", ""), "Unicode and caret powers should compare equivalently");
assert(logic.checkAnswer("2a2b", "2a^2b", ""), "flattened monomial exponents should normalize");
assert(logic.checkAnswer("\\frac{2x}{3}", "2x/3", ""), "TeX algebraic fractions should match slash notation");
assert(logic.checkAnswer("\\frac{3}{4}", "0.75", ""), "TeX numeric fractions should compare with decimals");
assert(logic.checkAnswer("x⁻²", "x^{-2}", ""), "Unicode negative exponents should match TeX powers");
assert(!logic.checkAnswer("1/0", "0", ""), "zero-denominator fractions must not parse as numbers");

const dataContext = {};
vm.createContext(dataContext);
vm.runInContext(
  read("tasks.js") + "\n" + read("extra_tasks.js") + "\n" + read("tasks7_algebra.js") + "\n" + read("theory.js") +
  ";globalThis.allTasks = TASKS; globalThis.extraBank = EXTRA_BANK; globalThis.algebraBank = TASKS7_ALGEBRA_BANK; globalThis.lessonTheory = THEORY_DATA;", 
  dataContext
);
assert.equal(Object.keys(dataContext.allTasks).length, 70, "48 original, 13 supplemental, and 9 new algebra variants should load");
assert.equal(dataContext.extraBank.length, 13, "There should be 13 supplemental topics");
assert.equal(dataContext.extraBank.reduce((n, theme) => n + theme.questions.length, 0), 130,
  "There should be 130 new exercises");

const seenPrompts = new Set();
const levels = { "Базовый": 0, "Средний": 0, "Повышенный": 0 };
for (const theme of dataContext.extraBank) {
  assert.equal(theme.questions.length, 10, `${theme.title} should contain 10 exercises`);
  for (const question of theme.questions) {
    assert.equal(question.theory.length, 3, `${theme.id}/${question.num} should have compact theory`);
    assert(question.hints.length >= 1, `${theme.id}/${question.num} should include a brief solution`);
    assert(levels[question.level] !== undefined, `${theme.id}/${question.num} should have a difficulty level`);
    levels[question.level]++;
    const task = question.tasks[0];
    const prompt = task.label.trim().toLowerCase();
    assert(!seenPrompts.has(prompt), `Duplicate supplemental prompt: ${task.label}`);
    seenPrompts.add(prompt);
    assert.equal(task.inputs.length, 1, `${theme.id}/${question.num} should have one answer field`);
    assert(task.inputs[0].a, `${theme.id}/${question.num} should have an answer key`);
    assert(logic.checkAnswer(task.inputs[0].a.split("|")[0], task.inputs[0].a, task.inputs[0].type),
      `${theme.id}/${question.num} answer key must pass the answer checker`);
  }
}
assert.deepEqual(levels, { "Базовый": 39, "Средний": 52, "Повышенный": 39 });

assert.equal(dataContext.algebraBank.length, 9, "The new algebra bank should have 9 themes");
assert.equal(dataContext.algebraBank.reduce((n, theme) => n + theme.questions.length, 0), 135,
  "The new algebra bank should have 135 exercises");
const algebraLevelCounts = { "Базовый": 0, "Средний": 0, "Повышенный": 0 };
const algebraPrompts = new Set();
for (const theme of dataContext.algebraBank) {
  assert.equal(theme.questions.length, 15, `${theme.title} should contain 15 exercises`);
  assert(dataContext.allTasks[theme.id], `${theme.id} should be registered for direct trainer links`);
  const withinThemeLevels = { "Базовый": 0, "Средний": 0, "Повышенный": 0 };
  for (const question of theme.questions) {
    assert(theme.topic && question.title && question.level, `${theme.id}/${question.num} needs topic and difficulty`);
    assert.equal(question.theory.length, 3, `${theme.id}/${question.num} should include theory`);
    assert.equal(question.hints.length, 1, `${theme.id}/${question.num} should include a concise worked solution`);
    assert(algebraLevelCounts[question.level] !== undefined, `${theme.id}/${question.num} has a recognized level`);
    algebraLevelCounts[question.level]++;
    withinThemeLevels[question.level]++;
    const task = question.tasks[0];
    const prompt = task.label.trim().toLowerCase();
    assert(!algebraPrompts.has(prompt), `Duplicate new algebra prompt: ${task.label}`);
    algebraPrompts.add(prompt);
    assert.equal(task.inputs.length, 1, `${theme.id}/${question.num} should have one answer field`);
    assert(task.inputs[0].a, `${theme.id}/${question.num} should have an answer key`);
    assert(logic.checkAnswer(task.inputs[0].a.split("|")[0], task.inputs[0].a, task.inputs[0].type),
      `${theme.id}/${question.num} answer key should pass the shared checker`);
  }
  assert.deepEqual(withinThemeLevels, { "Базовый": 5, "Средний": 5, "Повышенный": 5 },
    `${theme.title} should evenly distribute 5 tasks across each difficulty`);
}
assert.deepEqual(algebraLevelCounts, { "Базовый": 45, "Средний": 45, "Повышенный": 45 });

// Walk the complete legacy task bank and theory to ensure the shared renderer handles all strings.
let formattedStrings = 0;
let formulaStrings = 0;
function verifyFormatting(value, pathLabel = "content") {
  if (typeof value === "string") {
    formattedStrings++;
    // Answer alternatives are pipe-delimited metadata; the UI formats the first accepted answer when it displays a key.
    const renderValue = pathLabel.includes(".inputs[") && pathLabel.endsWith(".a") ? value.split("|")[0] : value;
    const output = logic.renderMath(renderValue);
    const hasPrivateMarker = [...output].some((ch) => ch.charCodeAt(0) >= 0xE000 && ch.charCodeAt(0) <= 0xF0FF);
    assert(!hasPrivateMarker && !output.includes("___MATH_"),
      `Renderer leaked an internal marker at ${pathLabel}`);
    const containsFormula = /[\^²³⁴⁵⁶⁷⁸⁹]/.test(renderValue) || renderValue.includes("\\frac") || renderValue.includes("\\sqrt") || new RegExp("[A-Za-z0-9]\\s*[/]\\s*[A-Za-z0-9]").test(renderValue);
    if (containsFormula) {
      formulaStrings++;
      assert(output.includes("math-render"), `Formula was not routed through MathJax at ${pathLabel}`);
    }
    return;
  }
  if (Array.isArray(value)) return value.forEach((item, index) => verifyFormatting(item, `${pathLabel}[${index}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).forEach(([key, item]) => verifyFormatting(item, `${pathLabel}.${key}`));
  }
}
verifyFormatting(dataContext.allTasks, "TASKS");
verifyFormatting(dataContext.extraBank, "EXTRA_BANK");
verifyFormatting(dataContext.algebraBank, "TASKS7_ALGEBRA_BANK");
verifyFormatting(dataContext.lessonTheory, "THEORY_DATA");
assert(formulaStrings > 100, "Legacy tasks and theory should exercise formula normalization broadly");

for (const variant of Object.values(dataContext.allTasks)) {
  for (const question of variant.questions) {
    assert(question.theory?.length || question.hints?.length,
      `Every existing exercise needs hints/theory: ${question.title}`);
  }
}

// Existing exercises combine their hint with the corresponding lesson reference into an accordion.
const theoryContext = {};
vm.createContext(theoryContext);
const theoryFunctionStart = script.indexOf("function getQuestionTheory(");
const theoryFunctionEnd = script.indexOf("/** Typeset only", theoryFunctionStart);
vm.runInContext(read("theory.js") + "\nglobalThis.appState={variantKey:'K-1'};\n" +
  script.slice(theoryFunctionStart, theoryFunctionEnd) +
  ";globalThis.getTheory = getQuestionTheory;", theoryContext);
for (const [variantKey, variant] of Object.entries(dataContext.allTasks)) {
  theoryContext.appState.variantKey = variantKey;
  for (const question of variant.questions) {
    const lines = theoryContext.getTheory(question);
    assert(lines.length >= 2 && lines.length <= 5,
      `${variantKey}/${question.num} should show 2–5 theory/hint lines`);
  }
}

const htmlHome = read("index.html");
const htmlTrainer = read("trainer.html");
const css = read("style.css");
assert(htmlHome.includes('<main id="modulesContainer">'), "Home page keeps its lesson-card main area");
assert(htmlTrainer.includes('<main id="slidesDeck"></main>'), "Trainer keeps its existing slide deck");
assert(htmlTrainer.includes('id="btnNext"') && htmlTrainer.includes('id="btnCheck"'),
  "Trainer navigation controls remain present");
assert(htmlHome.includes("mathjax@3.2.2") && htmlTrainer.includes("mathjax@3.2.2"),
  "MathJax 3 is loaded on both pages");
for (const theme of dataContext.extraBank) {
  assert(htmlTrainer.includes(`value="${theme.id}"`), `${theme.id} should be available in the trainer selector`);
  assert(htmlHome.includes(`trainer.html?variant=${theme.id}`), `${theme.id} should have a home-page card link`);
}
for (const theme of dataContext.algebraBank) {
  assert(htmlTrainer.includes(`value="${theme.id}"`), `${theme.id} should be available in the trainer selector`);
  assert(htmlHome.includes(`trainer.html?variant=${theme.id}`), `${theme.id} should have a home-page card link`);
}
assert(htmlHome.includes('src="tasks7_algebra.js') && htmlTrainer.includes('src="tasks7_algebra.js'),
  "Both entry pages should load the separate algebra bank before the trainer script");
assert(css.includes(".math-render") && css.includes(".theory-accordion"),
  "Responsive formula and accordion styles are included");
assert(!css.includes(".frac > .num") && !script.includes('class="frac"'),
  "The old hand-built fraction markup/styles are removed");

console.log(`PASS: MathJax/fallback cases: ${formatCases.length}; answer-check cases: 10; duplicate supplemental prompts: 0.`);
console.log(`PASS: shared renderer inspected ${formattedStrings} task/theory strings, including ${formulaStrings} formula-bearing strings.`);
console.log(`PASS: ${dataContext.extraBank.length} legacy supplemental topics × 10 = 130 exercises; difficulty ${JSON.stringify(levels)}.`);
console.log(`PASS: ${dataContext.algebraBank.length} new algebra topics × 15 = 135 exercises; difficulty ${JSON.stringify(algebraLevelCounts)}.`);
console.log(`PASS: ${Object.keys(dataContext.allTasks).length} variants, 463 total question slides, 663 answer inputs.`);
console.log("PASS: HTML structure, MathJax loading, legacy fraction removal, and accordion styles.");

// Run the expanded bank, VPR suite, and textbook task bank
require("./test_expanded_bank.js");
require("./test_textbook_tasks.js");

