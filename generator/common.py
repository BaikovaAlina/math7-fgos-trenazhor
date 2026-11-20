import json

PETERSON = "Петерсон Л.Г. «Алгебра 7 класс»"
GALITSKY = "Галицкий М.Л. «Сборник задач по алгебре 7 класс»"
ATANASYAN = "Атанасян Л.С. «Геометрия 7–9 класс»"

all_tasks = []
seen_prompts = set()

# Load existing prompts from existing files to ensure zero duplicate prompts
try:
    with open("/tmp/existing_prompts.json", "r", encoding="utf-8") as f:
        existing_prompts = set(json.load(f))
        seen_prompts.update(existing_prompts)
except Exception:
    pass

def add(module, lesson, variant, num, textbook, topic, level, title, prompt, answer, solution, hints, theory):
    p_norm = prompt.strip().lower()
    if p_norm in seen_prompts:
        raise ValueError(f"Duplicate prompt: {prompt}")
    seen_prompts.add(p_norm)
    task_id = f"TB-{lesson:02d}-{variant}-{num:02d}"
    t = {
        "id": task_id,
        "module": module,
        "lesson": lesson,
        "variant": variant,
        "num": str(num),
        "textbook": textbook,
        "topic": topic,
        "level": level,
        "title": title,
        "crumb": f"Урок {lesson} · Задание {num} из 10",
        "sub": f"{textbook} · {level}",
        "prompt": prompt,
        "answer": str(answer),
        "solution": solution,
        "hints": [hints] if isinstance(hints, str) else hints,
        "theory": theory if isinstance(theory, list) else [theory]
    }
    all_tasks.append(t)
