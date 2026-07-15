# product-engineer-skills

**Claude Code skills for product engineers who ship with AI.**
Навыки Claude Code для продакт-инженеров, которые собирают и выводят продукт сами — без команды разработки.

Это открытая библиотека навыков (skills) для [Claude Code](https://code.claude.com). Ставится либо одной терминальной командой, либо как нативный плагин-маркетплейс. Первый кит — **growth / customer discovery**.

---

## Установка

### Вариант 1 — нативный плагин (рекомендуется)

```bash
claude plugin marketplace add Startendru/product-engineer-skills
claude plugin install first-customer-finder@startend
```

В самой сессии Claude Code то же самое доступно через `/plugin marketplace add …` и `/plugin install …`.

### Вариант 2 — одной терминальной командой

```bash
# один навык
npx github:Startendru/product-engineer-skills first-customer-finder

# целый кит
npx github:Startendru/product-engineer-skills growth

# всё сразу
npx github:Startendru/product-engineer-skills --all

# что вообще есть
npx github:Startendru/product-engineer-skills --list
```

Навык копируется в `~/.claude/skills/`. Флаг `--codex` ставит в `~/.codex/skills/` (для Codex), `--skills-dir PATH` — в произвольную папку.

После установки перезапусти агента и вызови навык — он триггерится сам по описанию или командой `/first-customer-finder`.

---

## Навыки

| Навык | Кит | Что делает |
|---|---|---|
| **first-customer-finder** | growth | По URL стартапа находит и квалифицирует первых потенциальных клиентов по публичным сигналам боли и спроса, скорит их и собирает HTML-отчёт с персонализированными заготовками для аутрича. Ничего не отправляет автоматически. |

### Roadmap (growth-кит)

- `icp-builder` — собрать профиль идеального клиента из продукта/лендинга
- `signal-scanner` — мониторить публичные сигналы боли/спроса по нише
- `outreach-writer` — черновики аутрича строго от публичного контекста

> Библиотека будет прирастать и другими категориями работы продакт-инженера. Growth — первая.

---

## Как устроен репозиторий

```
product-engineer-skills/
├── .claude-plugin/marketplace.json   # каталог плагинов (маркетплейс @startend)
├── plugins/<plugin>/                 # 1 плагин = 1 навык
│   ├── .claude-plugin/plugin.json
│   └── skills/<skill>/SKILL.md · references/ · scripts/
├── kits.json                         # именованные комплекты для установщика
└── bin/install.mjs                   # npx-установщик (single / kit / --all / --codex)
```

Одна и та же раскладка навыка обслуживает оба пути установки: плагин держит навык в `skills/`, а `install.mjs` копирует его оттуда же.

---

## Журнал ключевых решений

| Решение | Выбор |
|---|---|
| Контейнер | GitHub-организация `Startendru` + категорийное имя репо `product-engineer-skills` — бренд в орг, находимость в имени. Маркетплейс-суффикс оставлен `@startend` (не обязан совпадать с github-слагом) |
| Имя-фокус | Identity-coupling (роль «продакт-инженер»), не tool-coupling — не привязывать вечнозелёное имя к инструменту, который сменится |
| Первый скоуп | Growth / customer discovery как первый кит под зонтом, а не отдельный узкий репо |
| Механизм раздачи | Гибрид: нативный плагин-маркетплейс (основной) + npx-установщик (сырой терминал + кросс-харнесс Codex) |
| Гранулярность | 1 плагин = 1 навык (каждый ставится своей командой); киты — через `kits.json` в установщике |
| Флагман | `first-customer-finder` (портирован из Codex-скилла Kappaemme, адаптирован под Claude Code) |

---

## Про Startend

Собрано в [Startend](https://startend.ru) — интенсиве, где продакты, фаундеры и маркетологи учатся собирать рабочие MVP на Claude Code без разработчиков. Эти навыки — то, что умеет выпускник. Хочешь научиться делать такое сам — приходи на интенсив.

## Лицензия

[MIT](LICENSE)
