# product-engineer-skills

**Claude Code skills for product engineers who ship with AI.**
Навыки Claude Code для продакт-инженеров, которые собирают и выводят продукт сами — без команды разработки.

Это открытая библиотека навыков (skills) для [Claude Code](https://code.claude.com). Ставится либо одной терминальной командой, либо как нативный плагин-маркетплейс. Первый кит — **growth / customer discovery**.

---

## Установка

### Вариант 1 — нативный плагин (рекомендуется)

```bash
claude plugin marketplace add Startendru/product-engineer-skills

claude plugin install first-customer-finder@startend   # growth
claude plugin install startend@startend                # design и остальной крафт
```

Навыки зонтичного плагина вызываются с префиксом: `/startend:design-leading-trim`.

В самой сессии Claude Code то же самое доступно через `/plugin marketplace add …` и `/plugin install …`.

### Вариант 2 — одной терминальной командой

```bash
# один навык
npx github:Startendru/product-engineer-skills first-customer-finder
npx github:Startendru/product-engineer-skills design-leading-trim

# целый кит
npx github:Startendru/product-engineer-skills growth
npx github:Startendru/product-engineer-skills design

# всё сразу
npx github:Startendru/product-engineer-skills --all

# что вообще есть
npx github:Startendru/product-engineer-skills --list
```

Навык копируется в `~/.claude/skills/`. Флаг `--codex` ставит в `~/.codex/skills/` (для Codex), `--skills-dir PATH` — в произвольную папку.

После установки перезапусти агента и вызови навык — он триггерится сам по описанию или командой.

**Разница между путями установки видна в имени навыка.** Плагин держит своё пространство имён: `/startend:design-leading-trim`. Установщик копирует файлы в `~/.claude/skills/`, где пространства имён нет, и навык зовётся `/design-leading-trim`. Работает одинаково, отличается только вызов.

---

## Навыки

| Навык | Кит | Что делает |
|---|---|---|
| **first-customer-finder** | growth | По URL стартапа находит и квалифицирует первых потенциальных клиентов по публичным сигналам боли и спроса, скорит их и собирает HTML-отчёт с персонализированными заготовками для аутрича. Ничего не отправляет автоматически. |
| **design-leading-trim** | design | Чинит текст, который стоит не по центру блока, и вертикальный ритм, который зависит от гарнитуры: отступы CSS отмеряются от границ строчного бокса, а не от букв. Два независимых замера — перекос внутри бокса и оптический зазор между блоками, — `text-box-trim`, правило перенастройки ритма и заслон в CI. |

### Roadmap (growth-кит)

- `icp-builder` — собрать профиль идеального клиента из продукта/лендинга
- `signal-scanner` — мониторить публичные сигналы боли/спроса по нише
- `outreach-writer` — черновики аутрича строго от публичного контекста

### Roadmap (design-кит)

- `design-contrast-audit` — аудит контраста по всем поверхностям, а не только на белом фоне
- `design-reflow` — проверка вёрстки на 320px без двумерной прокрутки

> Библиотека будет прирастать и другими категориями работы продакт-инженера. Growth — первая.

---

## Как устроен репозиторий

```
product-engineer-skills/
├── .claude-plugin/marketplace.json   # каталог плагинов (маркетплейс @startend)
├── plugins/<plugin>/                 # плагин: один навык или зонтик с префиксами
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
| Гранулярность, ревизия 2026-08-28 | Добавлен зонтичный плагин `startend` с префиксами доменов в именах навыков (`design-…`). Заменяет прежнее правило для всего, кроме флагманов: при десятке навыков «одна команда на навык» превращается в десяток команд, а пространство имён плагина даёт `/startend:design-leading-trim` — сразу видно, чьё и про что. `first-customer-finder` остаётся отдельным плагином как флагман со своей страницей установки |
| Флагман | `first-customer-finder` — основан на MIT-скилле Francesco Mistero (Kappaemme), портирован на Claude Code и адаптирован под РУ (см. [NOTICE](NOTICE)) |

---

## Про Startend

Собрано в [Startend](https://startend.ru) — интенсиве, где продакты, фаундеры и маркетологи учатся собирать рабочие MVP на Claude Code без разработчиков. Эти навыки — то, что умеет выпускник. Хочешь научиться делать такое сам — приходи на интенсив.

## Атрибуция

Навык **first-customer-finder** основан на open-source скилле [`codex-first-customer-finder-skill`](https://github.com/Kappaemme-git/codex-first-customer-finder-skill) (MIT) авторства **Francesco Mistero ([@Kappaemme1926](https://x.com/Kappaemme1926))**. Startend портировал его на формат Claude Code и адаптировал под русскоязычный рынок (РУ-источники, импортозамещение, 152-ФЗ, русский отчёт). Копирайт оригинала сохранён — детали и полный список изменений в [NOTICE](NOTICE).

## Лицензия

[MIT](LICENSE) — двойной копирайт (оригинал Francesco Mistero + РУ-адаптация Startend).
