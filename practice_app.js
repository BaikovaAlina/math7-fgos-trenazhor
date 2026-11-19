/* Optional offline bank + timed VPR mode. It reuses the legacy answer checker and renderer. */
(() => {
  "use strict";
  const $ = (selector) => document.querySelector(selector);
  const params = new URLSearchParams(location.search);
  const mode = params.get("mode") === "vpr" ? "vpr" : "bank";
  let selectedVpr = null;
  let timerId = 0;
  let remainingSeconds = 0;
  let finished = false;

  const title = $("#practiceTitle");
  const description = $("#practiceDescription");
  const badge = $("#practiceModeBadge");
  const notice = $("#practiceNotice");
  const list = $("#practiceList");
  const actions = $("#practiceActions");
  const bankControls = $("#bankControls");
  const vprControls = $("#vprControls");
  const timer = $("#vprTimer");

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" })[ch]);
  }
  function math(value) {
    return window.Math7Format ? window.Math7Format(String(value ?? "")) : esc(value);
  }
  function levelText(value) { return value === "advanced" ? "Углублённый" : "Базовый"; }
  function cardHead(task) {
    const level = task.level === "advanced" ? "practice-tag advanced" : "practice-tag";
    return `<div class="practice-card-head"><span class="practice-id">${esc(task.id)}</span><div class="practice-tags"><span class="practice-tag">${esc(task.topic)}</span><span class="${level}">${levelText(task.level)}</span><span class="practice-tag">${task.type === "choice" ? "Выбор ответа" : task.type === "open" ? "Развёрнутый ответ" : "Краткий ответ"}</span></div></div>`;
  }
  function answerControls(task, prefix = "bank") {
    if (task.type === "choice") {
      return `<div class="practice-options">${task.options.map((option, index) => { const value = typeof option === "string" ? option : option.value; const label = typeof option === "string" ? option : option.label; return `<label class="practice-option"><input type="radio" name="${esc(prefix + "-" + task.id)}" value="${esc(value)}"><span>${String.fromCharCode(1040 + index)}. ${math(label)}</span></label>`; }).join("")}</div>`;
    }
    if (task.type === "open") {
      return `<label class="practice-answer-label" for="${esc(prefix + "-answer-" + task.id)}">Итоговый ответ</label><input class="practice-answer-input" id="${esc(prefix + "-answer-" + task.id)}" type="text" autocomplete="off"><label class="practice-answer-label" for="${esc(prefix + "-work-" + task.id)}">Ход решения</label><textarea class="practice-work-input" id="${esc(prefix + "-work-" + task.id)}" placeholder="Запишите обоснование или вычисления"></textarea>`;
    }
    return `<label class="practice-answer-label" for="${esc(prefix + "-answer-" + task.id)}">Ответ</label><input class="practice-answer-input" id="${esc(prefix + "-answer-" + task.id)}" type="text" autocomplete="off">`;
  }
  function hintBlock(task) {
    return `<details class="practice-hint"><summary>Подсказка</summary><div>${math(task.hint)}</div></details>`;
  }
  function solutionBlock(task, includeRubric = false) {
    const criteria = includeRubric && task.criteria ? `<ul>${task.criteria.map((entry) => `<li>${math(entry)}</li>`).join("")}</ul>` : "";
    return `<div class="practice-solution"><strong>Ответ:</strong> ${math(task.answer.split("|")[0])}<br><strong>Разбор:</strong> ${math(task.solution)}${criteria}</div>`;
  }
  function taskInputValue(task, prefix) {
    if (task.type === "choice") return document.querySelector(`input[name="${CSS.escape(prefix + "-" + task.id)}"]:checked`)?.value ?? "";
    return $(`#${CSS.escape(prefix + "-answer-" + task.id)}`)?.value.trim() ?? "";
  }
  function checkTask(task, prefix) {
    const value = taskInputValue(task, prefix);
    return Boolean(value && window.Math7Answer?.checkAnswer(value, task.answer, task.answerType || ""));
  }

  function initBank() {
    badge.textContent = "Дополнительный банк · 160 заданий";
    title.textContent = "Тематический банк заданий";
    description.textContent = "Выберите тему и уровень. У каждого задания есть подсказка и краткий разбор.";
    bankControls.hidden = false;
    vprControls.hidden = true;
    timer.hidden = true;
    actions.hidden = true;
    const themeSelect = $("#themeSelect");
    const levelSelect = $("#levelSelect");
    themeSelect.innerHTML = `<option value="all">Все темы</option>` + EXPANDED_THEMES.map((theme) => `<option value="${esc(theme.id)}">${esc(theme.title)} · 8</option>`).join("");
    const requestedTheme = params.get("topic");
    if (requestedTheme && EXPANDED_THEMES.some((theme) => theme.id === requestedTheme)) themeSelect.value = requestedTheme;
    else themeSelect.value = EXPANDED_THEMES[0].id;
    themeSelect.addEventListener("change", renderBank);
    levelSelect.addEventListener("change", renderBank);
    renderBank();
  }
  function renderBank() {
    const themeId = $("#themeSelect").value;
    const level = $("#levelSelect").value;
    const tasks = EXPANDED_BANK.filter((task) => (themeId === "all" || task.themeId === themeId) && (level === "all" || task.level === level));
    notice.textContent = `${tasks.length} заданий · ${themeId === "all" ? "все темы" : EXPANDED_THEMES.find((theme) => theme.id === themeId)?.title} · ${level === "all" ? "оба уровня" : levelText(level)}`;
    list.innerHTML = tasks.length ? tasks.map((task) => `<article class="practice-card" data-task-card="${esc(task.id)}">${cardHead(task)}<div class="practice-prompt">${math(task.prompt)}</div>${answerControls(task)}${hintBlock(task)}<button type="button" class="btn-nav" data-action="check-bank" data-id="${esc(task.id)}">Проверить</button><div class="practice-feedback" id="bank-feedback-${esc(task.id)}" aria-live="polite"></div><div id="bank-solution-${esc(task.id)}" hidden>${solutionBlock(task)}</div></article>`).join("") : `<div class="practice-empty">Для выбранного фильтра заданий нет.</div>`;
    typesetIfPresent(list);
  }
  function typesetIfPresent(root) {
    if (window.MathJax?.typesetPromise) window.MathJax.typesetPromise([root]).catch(() => {});
  }

  function selectVpr() {
    const requested = params.get("variant");
    const variant = VPR_VARIANTS.find((item) => item.id === requested) || VPR_VARIANTS[0];
    $("#vprSelect").value = variant.id;
    showVprIntro(variant);
  }
  function initVpr() {
    badge.textContent = "Режим ВПР · авторские пробники";
    title.textContent = "Пробники ВПР · математика, 7 класс";
    description.textContent = "Три тренировочных варианта: краткие ответы, развёрнутые решения, ключи и критерии оценивания.";
    bankControls.hidden = true;
    vprControls.hidden = false;
    timer.hidden = true;
    actions.hidden = true;
    $("#vprSelect").innerHTML = VPR_VARIANTS.map((variant) => `<option value="${esc(variant.id)}">${esc(variant.title)}</option>`).join("");
    $("#vprSelect").addEventListener("change", () => {
      showVprIntro(VPR_VARIANTS.find((variant) => variant.id === $("#vprSelect").value));
    });
    selectVpr();
  }
  function showVprIntro(variant) {
    clearInterval(timerId);
    $("#vprSelect").disabled = false;
    selectedVpr = variant;
    finished = false;
    timer.hidden = true;
    actions.hidden = true;
    notice.textContent = "";
    title.textContent = variant.title;
    description.textContent = "";
    list.innerHTML = `<section class="practice-intro"><h2>${esc(variant.title)}</h2><p>${esc(variant.instructions)}</p><ul><li>${variant.tasks.length} заданий · ${variant.durationMinutes} минут.</li><li>Выбор и краткие ответы проверяются автоматически.</li><li>В развёрнутых заданиях 1 балл даётся за итоговый ответ, оставшиеся баллы можно выставить по критериям после самопроверки.</li><li>Пробники авторские и тренировочные, не являются официальными материалами ВПР.</li></ul><button type="button" class="btn-send-tg" id="beginVpr">Начать пробник</button></section>`;
    $("#beginVpr").addEventListener("click", () => startVpr(variant));
  }
  function startVpr(variant) {
    selectedVpr = variant;
    $("#vprSelect").disabled = true;
    finished = false;
    remainingSeconds = variant.durationMinutes * 60;
    timer.hidden = false;
    actions.hidden = false;
    $("#submitVpr").hidden = false;
    $("#restartVpr").hidden = true;
    renderVprTasks(variant);
    updateTimer();
    clearInterval(timerId);
    timerId = window.setInterval(() => {
      remainingSeconds -= 1;
      updateTimer();
      if (remainingSeconds <= 0) submitVpr(true);
    }, 1000);
  }
  function renderVprTasks(variant) {
    notice.textContent = "Таймер запущен. Развёрнутые ответы оцениваются по критериям; сохранение выполняется только в этой вкладке.";
    list.innerHTML = variant.tasks.map((task, index) => {
      const openAssessment = task.type === "open" ? `<label class="practice-answer-label" for="method-score-${esc(task.id)}">Баллы за ход решения (самооценка, максимум ${task.methodPoints})</label><select class="practice-answer-input practice-score-select" id="method-score-${esc(task.id)}">${Array.from({length: task.methodPoints + 1}, (_, score) => `<option value="${score}">${score}</option>`).join("")}</select><details class="practice-rubric"><summary>Критерии оценивания</summary><ul>${task.criteria.map((criterion) => `<li>${math(criterion)}</li>`).join("")}</ul></details>` : "";
      return `<article class="practice-card" data-vpr-card="${esc(task.id)}"><div class="practice-card-head"><span class="practice-id">Задание ${index + 1} · ${esc(task.id)} · ${task.points} б.</span><div class="practice-tags"><span class="practice-tag">${esc(task.topic)}</span><span class="practice-tag">${task.type === "open" ? "Развёрнутое решение" : task.type === "choice" ? "Выбор ответа" : "Краткий ответ"}</span></div></div><div class="practice-prompt">${math(task.prompt)}</div>${answerControls(task, "vpr")}${task.hint ? hintBlock(task) : ""}${openAssessment}<div class="practice-feedback" id="vpr-feedback-${esc(task.id)}"></div><div id="vpr-solution-${esc(task.id)}" hidden></div></article>`;
    }).join("");
    typesetIfPresent(list);
  }
  function updateTimer() {
    const minutes = Math.floor(Math.max(0, remainingSeconds) / 60);
    const seconds = Math.max(0, remainingSeconds) % 60;
    timer.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    timer.setAttribute("aria-label", `Осталось ${minutes} минут ${seconds} секунд`);
  }
  function submitVpr(timeExpired = false) {
    if (!selectedVpr || finished) return;
    finished = true;
    clearInterval(timerId);
    const earned = [];
    let totalPoints = 0;
    let maxPoints = 0;
    selectedVpr.tasks.forEach((task, index) => {
      const isCorrect = checkTask(task, "vpr");
      const methodScore = task.type === "open" ? Number($(`#method-score-${CSS.escape(task.id)}`)?.value || 0) : 0;
      const points = task.type === "open" ? (isCorrect ? 1 : 0) + methodScore : (isCorrect ? task.points : 0);
      earned.push(points);
      totalPoints += points;
      maxPoints += task.points;
      const feedback = $(`#vpr-feedback-${CSS.escape(task.id)}`);
      feedback.className = `practice-feedback ${isCorrect ? "correct" : "incorrect"}`;
      feedback.textContent = task.type === "open"
        ? `${isCorrect ? "Итоговый ответ верен" : "Итоговый ответ не совпал с ключом"}; баллы за способ: ${methodScore}/${task.methodPoints}.`
        : (isCorrect ? "Верно · " : "Неверно · ") + `${points}/${task.points} балл.`;
      const solution = $(`#vpr-solution-${CSS.escape(task.id)}`);
      solution.innerHTML = solutionBlock(task, true);
      solution.hidden = false;
      const card = document.querySelector(`[data-vpr-card="${CSS.escape(task.id)}"]`);
      card.classList.add(isCorrect ? "correct" : "incorrect");
      card.querySelectorAll("input, textarea, select").forEach((control) => { control.disabled = true; });
    });
    const percent = Math.round(totalPoints / maxPoints * 100);
    const resultsHtml = `<section class="practice-summary"><strong>Результат: ${totalPoints} из ${maxPoints} баллов (${percent}%)</strong><p>${timeExpired ? "Время вышло. " : ""}Сверьте развёрнутые ответы с критериями и разбором под каждым заданием.</p></section>`;
    list.insertAdjacentHTML("afterbegin", resultsHtml);
    notice.textContent = "Пробник завершён. Ключи ответов, решения и критерии открыты.";
    $("#submitVpr").hidden = true;
    $("#restartVpr").hidden = false;
    $("#vprSelect").disabled = false;
    list.querySelectorAll(".practice-rubric").forEach((details) => { details.open = true; });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  list.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="check-bank"]');
    if (!button) return;
    const task = EXPANDED_BANK.find((item) => item.id === button.dataset.id);
    if (!task) return;
    const ok = checkTask(task, "bank");
    const feedback = $(`#bank-feedback-${CSS.escape(task.id)}`);
    feedback.className = `practice-feedback ${ok ? "correct" : "incorrect"}`;
    feedback.textContent = ok ? "✓ Ответ верный." : "✗ Ответ не совпал с ключом. Откройте разбор и проверьте вычисления.";
    const solution = $(`#bank-solution-${CSS.escape(task.id)}`);
    solution.innerHTML = solutionBlock(task);
    solution.hidden = false;
    typesetIfPresent(solution);
  });
  $("#submitVpr").addEventListener("click", () => submitVpr(false));
  $("#restartVpr").addEventListener("click", () => {
    if (selectedVpr) showVprIntro(selectedVpr);
  });
  if (mode === "vpr") initVpr(); else initBank();
})();
