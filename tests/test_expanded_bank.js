"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// Load validator and formatter from script.js
const script = read("script.js");
const formatterStart = script.indexOf("function escapeMathHtml(");
const section2 = script.indexOf("/* ============================================================\n * 2. ИНИЦИАЛИЗАЦИЯ");
assert(formatterStart >= 0 && section2 > formatterStart, "Sections in script.js must be present");

const logicContext = { window: {} };
logicContext.window = logicContext;
vm.createContext(logicContext);
vm.runInContext(script.slice(formatterStart, section2), logicContext);

const { checkAnswer, parseMathNumber } = logicContext.window.Math7Answer;
const formatMath = logicContext.window.Math7Format;

assert(typeof checkAnswer === "function", "checkAnswer must be exported");
assert(typeof formatMath === "function", "formatMath must be exported");

// Verify square root variations as documented in README
assert(checkAnswer("√2", "√2", ""), "√2 should match √2");
assert(checkAnswer("sqrt(2)", "√2", ""), "sqrt(2) should match √2");
assert(checkAnswer("sqrt2", "√2", ""), "sqrt2 should match √2");
assert(checkAnswer("√x", "sqrt(x)", ""), "√x should match sqrt(x)");

// Load expanded bank and VPR bank
const bankContext = { window: {} };
bankContext.window = bankContext;
vm.createContext(bankContext);
vm.runInContext(read("expanded_bank.js") + "\n;globalThis.EXPANDED_THEMES = EXPANDED_THEMES; globalThis.EXPANDED_BANK = EXPANDED_BANK;", bankContext);
vm.runInContext(read("vpr_bank.js") + "\n;globalThis.VPR_VARIANTS = VPR_VARIANTS;", bankContext);

const themes = bankContext.EXPANDED_THEMES;
const expandedBank = bankContext.EXPANDED_BANK;
const vprVariants = bankContext.VPR_VARIANTS;

// Check expanded themes and bank size
assert.equal(themes.length, 20, "Should have 20 expanded themes");
assert.equal(expandedBank.length, 160, "Should have 160 expanded tasks (20 × 8)");

const seenIds = new Set();
const levelCounts = { base: 0, advanced: 0 };
const typeCounts = { choice: 0, short: 0, open: 0 };

for (const theme of themes) {
  assert(theme.id && theme.title && theme.subject, `Theme ${theme.id} needs id, title, and subject`);
  assert.equal(theme.items.length, 8, `Theme ${theme.id} must contain exactly 8 items`);
}

for (const task of expandedBank) {
  assert(!seenIds.has(task.id), `Duplicate ID in expanded bank: ${task.id}`);
  seenIds.add(task.id);

  assert(task.id.startsWith("EXT-"), `ID must start with EXT-: ${task.id}`);
  assert(task.topic, `${task.id} must have a topic`);
  assert(task.prompt && task.prompt.trim().length > 0, `${task.id} must have non-empty prompt`);
  assert(task.answer && task.answer.trim().length > 0, `${task.id} must have non-empty answer`);
  assert(task.hint && task.hint.trim().length > 0, `${task.id} must have non-empty hint`);
  assert(task.solution && task.solution.trim().length > 0, `${task.id} must have non-empty solution`);

  assert(levelCounts[task.level] !== undefined, `Unknown level: ${task.level} in ${task.id}`);
  levelCounts[task.level]++;

  assert(typeCounts[task.type] !== undefined, `Unknown type: ${task.type} in ${task.id}`);
  typeCounts[task.type]++;

  if (task.type === "choice") {
    assert(Array.isArray(task.options) && task.options.length === 4, `${task.id} choice task must have 4 options`);
    const optionValues = task.options.map((opt) => (typeof opt === "string" ? opt : opt.value));
    const firstAns = task.answer.split("|")[0];
    assert(optionValues.includes(firstAns), `${task.id} answer "${firstAns}" must be one of options: ${optionValues.join(", ")}`);
  }

  const primaryAnswer = task.answer.split("|")[0];
  assert(
    checkAnswer(primaryAnswer, task.answer, task.answerType || ""),
    `${task.id} answer "${primaryAnswer}" must satisfy checkAnswer with key "${task.answer}"`
  );
}

assert.deepEqual(levelCounts, { base: 80, advanced: 80 }, "Expanded bank should have 80 base and 80 advanced tasks");
assert.deepEqual(typeCounts, { choice: 40, short: 80, open: 40 }, "Expanded bank should have 40 choice, 80 short, and 40 open tasks");

// Check VPR variants
assert.equal(vprVariants.length, 3, "Should have 3 VPR variants");
let totalVprTasks = 0;

for (const variant of vprVariants) {
  assert(variant.id && variant.title, `VPR variant needs id and title`);
  assert.equal(variant.durationMinutes, 90, `${variant.id} must have 90 minutes duration`);
  assert.equal(variant.tasks.length, 12, `${variant.id} must have 12 tasks`);

  for (const task of variant.tasks) {
    assert(!seenIds.has(task.id), `Duplicate ID across banks: ${task.id}`);
    seenIds.add(task.id);
    totalVprTasks++;

    assert(task.id.startsWith("VPR-"), `VPR task ID must start with VPR-: ${task.id}`);
    assert(task.topic, `${task.id} must have a topic`);
    assert(task.points && task.points > 0, `${task.id} must have points > 0`);
    assert(task.prompt && task.prompt.trim().length > 0, `${task.id} must have non-empty prompt`);
    assert(task.answer && task.answer.trim().length > 0, `${task.id} must have non-empty answer`);
    assert(task.hint && task.hint.trim().length > 0, `${task.id} must have non-empty hint`);
    assert(task.solution && task.solution.trim().length > 0, `${task.id} must have non-empty solution`);

    if (task.type === "choice") {
      assert(Array.isArray(task.options) && task.options.length === 4, `${task.id} choice task must have 4 options`);
      const optionValues = task.options.map((opt) => (typeof opt === "string" ? opt : opt.value));
      const firstAns = task.answer.split("|")[0];
      assert(optionValues.includes(firstAns), `${task.id} answer "${firstAns}" must be one of options`);
    }

    if (task.type === "open") {
      assert(Array.isArray(task.criteria) && task.criteria.length >= 1, `${task.id} open task must have criteria`);
      assert(task.methodPoints !== undefined && task.methodPoints >= 1, `${task.id} open task must have methodPoints`);
    }

    const primaryAnswer = task.answer.split("|")[0];
    assert(
      checkAnswer(primaryAnswer, task.answer, task.answerType || ""),
      `${task.id} answer "${primaryAnswer}" must satisfy checkAnswer with key "${task.answer}"`
    );
  }
}

assert.equal(totalVprTasks, 36, "Total VPR tasks should be 36");
assert.equal(seenIds.size, 196, "Total unique task IDs should be 196 (160 + 36)");

// Check BANK_CATALOG.md includes all 196 IDs
const catalog = read("BANK_CATALOG.md");
for (const id of seenIds) {
  assert(catalog.includes(id), `BANK_CATALOG.md should include ${id}`);
}

// Check practice.html structure
const practiceHtml = read("practice.html");
assert(practiceHtml.includes('id="themeSelect"'), "practice.html should have themeSelect");
assert(practiceHtml.includes('id="levelSelect"'), "practice.html should have levelSelect");
assert(practiceHtml.includes('id="vprSelect"'), "practice.html should have vprSelect");
assert(practiceHtml.includes('id="vprTimer"'), "practice.html should have vprTimer");
assert(practiceHtml.includes('id="practiceList"'), "practice.html should have practiceList");
assert(practiceHtml.includes('id="submitVpr"'), "practice.html should have submitVpr");
assert(practiceHtml.includes('src="expanded_bank.js'), "practice.html should load expanded_bank.js");
assert(practiceHtml.includes('src="vpr_bank.js'), "practice.html should load vpr_bank.js");
assert(practiceHtml.includes('src="practice_app.js'), "practice.html should load practice_app.js");

// Check index.html Module 15 links
const indexHtml = read("index.html");
assert(indexHtml.includes("Расширенная практика и пробники ВПР"), "index.html should have Module 15 heading");
assert(indexHtml.includes('practice.html?mode=bank'), "index.html should link to practice.html?mode=bank");
assert(indexHtml.includes('practice.html?mode=vpr&amp;variant=VPR-01') || indexHtml.includes('practice.html?mode=vpr&variant=VPR-01'),
  "index.html should link to VPR-01");
assert(indexHtml.includes('practice.html?mode=vpr&amp;variant=VPR-02') || indexHtml.includes('practice.html?mode=vpr&variant=VPR-02'),
  "index.html should link to VPR-02");
assert(indexHtml.includes('practice.html?mode=vpr&amp;variant=VPR-03') || indexHtml.includes('practice.html?mode=vpr&variant=VPR-03'),
  "index.html should link to VPR-03");

console.log(`PASS: Expanded bank: 20 themes × 8 = 160 tasks (40 choice, 80 short, 40 open; 80 base, 80 advanced).`);
console.log(`PASS: 3 VPR variants × 12 = 36 tasks (90 min each, points, criteria, solutions verified).`);
console.log(`PASS: All 196 tasks cataloged in BANK_CATALOG.md and validated with checkAnswer.`);
console.log(`PASS: Square root normalization (√2, sqrt(2), sqrt2) and practice.html markup verified.`);
