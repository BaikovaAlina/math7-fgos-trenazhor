import json
import os
import sys

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from common import all_tasks
import mod01_02
import mod03_04
import mod05_07
import mod08_10
import mod11_12

print("Populating modules...")
mod01_02.populate()
print(f"After Mod 01-02: {len(all_tasks)} tasks")
mod03_04.populate()
print(f"After Mod 03-04: {len(all_tasks)} tasks")
mod05_07.populate()
print(f"After Mod 05-07: {len(all_tasks)} tasks")
mod08_10.populate()
print(f"After Mod 08-10: {len(all_tasks)} tasks")
mod11_12.populate()
print(f"After Mod 11-12: {len(all_tasks)} tasks")

# Validation
print(f"\nTotal new textbook tasks: {len(all_tasks)}")

# Check lessons and variants
by_variant = {}
for t in all_tasks:
    v = t["variant"]
    by_variant.setdefault(v, []).append(t)

print(f"Variants covered: {len(by_variant)}")
for v in sorted(by_variant.keys()):
    tasks_v = by_variant[v]
    nums = [t["num"] for t in tasks_v]
    print(f"  {v}: {len(tasks_v)} tasks (nums: {nums[0]}..{nums[-1]})")

# Check that every task has all required fields
for t in all_tasks:
    for field in ["id", "module", "lesson", "variant", "num", "textbook", "topic", "level", "title", "prompt", "answer", "solution", "hints", "theory"]:
        assert field in t and t[field], f"Missing or empty field {field} in {t['id']}"
    assert len(t["hints"]) > 0, f"Empty hints in {t['id']}"
    assert len(t["theory"]) > 0, f"Empty theory in {t['id']}"

# Write JSON
json_path = "/home/user/math7-fgos-trenazhor/textbook_tasks.json"
with open(json_path, "w", encoding="utf-8") as f:
    json.dump(all_tasks, f, ensure_ascii=False, indent=2)
print(f"\nWrote JSON: {json_path} ({os.path.getsize(json_path)} bytes)")

# Write JS
js_path = "/home/user/math7-fgos-trenazhor/textbook_tasks.js"
with open(js_path, "w", encoding="utf-8") as f:
    f.write("// ============================================================\n")
    f.write("// БАНК ЗАДАЧ ИЗ УЧЕБНИКОВ (ФГОС 7 КЛАСС)\n")
    f.write("// Источники: Галицкий М.Л., Петерсон Л.Г., Атанасян Л.С.\n")
    f.write("// Структурированный массив для расширения и тренажёра\n")
    f.write("// ============================================================\n\n")
    f.write("const TEXTBOOK_TASKS = ")
    f.write(json.dumps(all_tasks, ensure_ascii=False, indent=2))
    f.write(";\n\n")
    f.write("// Автоматическое дополнение уроков в TASKS до 10 заданий\n")
    f.write("if (typeof TASKS !== 'undefined' && Array.isArray(TEXTBOOK_TASKS)) {\n")
    f.write("  TEXTBOOK_TASKS.forEach(t => {\n")
    f.write("    const v = TASKS[t.variant];\n")
    f.write("    if (!v) return;\n")
    f.write("    if (!v.questions) v.questions = [];\n")
    f.write("    if (v.questions.some(q => String(q.num) === String(t.num))) return;\n")
    f.write("    v.questions.push({\n")
    f.write("      num: String(t.num),\n")
    f.write("      title: t.title,\n")
    f.write("      sub: `${t.textbook} · ${t.level}`,\n")
    f.write("      crumb: t.crumb || `Урок ${t.lesson} · Задание ${t.num} из 10`,\n")
    f.write("      level: t.level,\n")
    f.write("      textbook: t.textbook,\n")
    f.write("      hints: t.hints,\n")
    f.write("      theory: t.theory,\n")
    f.write("      solution: t.solution,\n")
    f.write("      tasks: [\n")
    f.write("        {\n")
    f.write("          label: t.prompt,\n")
    f.write("          parts: ['Ответ:', { _input: 0 }],\n")
    f.write("          inputs: [{ a: t.answer, type: t.type || '', g: String(t.num), w: 1 }]\n")
    f.write("        }\n")
    f.write("      ]\n")
    f.write("    });\n")
    f.write("  });\n")
    f.write("}\n\n")
    f.write("if (typeof module !== 'undefined' && module.exports) {\n")
    f.write("    module.exports = { TEXTBOOK_TASKS };\n")
    f.write("}\n")
    f.write("if (typeof window !== 'undefined') {\n")
    f.write("    window.TEXTBOOK_TASKS = TEXTBOOK_TASKS;\n")
    f.write("}\n")

print(f"Wrote JS: {js_path} ({os.path.getsize(js_path)} bytes)")
