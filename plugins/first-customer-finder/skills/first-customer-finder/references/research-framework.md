# Research and Qualification Framework

Use this framework to keep prospect research evidence-based, current, and respectful.

**RU-first by default.** This skill is tuned for the Russian-speaking market (Russia + CIS, Russian language). Search Russian sources and Russian-language signals first. Widen to global sources (Reddit, X, LinkedIn, ProductHunt, G2) only when the product clearly targets a non-RU audience.

## Research sequence

### Product brief

Define:

- product and promised outcome
- primary user and economic buyer
- urgent job to be done
- current alternative or workaround
- likely adoption trigger
- geography or language constraint — **assume RU unless the product clearly targets another market**
- clear disqualifiers

Do not begin broad lead collection until this brief is specific enough to reject weak matches.

### Query buckets

Search several buckets rather than repeating one query. Adapt wording to the audience's language — for RU, use natural Russian phrasings, not translated English.

1. **Explicit demand (RU):** «посоветуйте сервис/инструмент», «ищу аналог…», «чем заменить…», «есть ли что-то для…», «нужен инструмент, чтобы…»
2. **Pain (RU):** «надоело вручную», «трачу часы на…», «бесит», «неудобно», «постоянно ломается», «делаю на коленке»
3. **Workaround (RU):** «веду в экселе / гугл-таблице», «копипащу вручную», «через бота/скрипт», «наняли фрилансера на рутину», «делаем руками»
4. **Switching (RU):** «отказался от…», «мигрирую с…», «не хватает функции», «подняли цену», жалобы на конкурента
5. **Timing (RU):** запуск, найм (вакансии), расширение, новый процесс, регуляторика, интеграция — **и РУ-специфичный триггер ниже**

#### RU timing trigger — импортозамещение (import substitution) ⭐

The single strongest current RU buying trigger. Search for it explicitly:

- «зарубежный сервис ушёл из России / заблокировал / перестал принимать оплату»
- «ищу российский аналог <иностранный инструмент>», «импортозамещение <категория>»
- «отвалилась оплата зарубежной подписки», «санкции сломали наш стек / процесс»

A company forced off a foreign tool is actively looking **right now** — treat this as high timing and prioritise it.

### Source mix (RU platforms first)

Search these Russian public sources before any global one:

- **vc.ru** — статьи, раздел «Трибуна», комментарии
- **Habr** — статьи, комментарии, Q&A
- **Telegram** — публичные каналы и чаты (профессиональные сообщества, посты «ищу подрядчика/инструмент»)
- **VK** — тематические сообщества, обсуждения, комментарии
- **Пикабу** — тематические посты и комментарии
- **hh.ru / Хабр Карьера** — вакансии как сигнал найма, роста и внедрения нового процесса
- **Отзывы** — Otzovik, irecommend, отзывы в 2ГИС и Яндекс.Картах (локальный бизнес), отзывы на маркетплейсах Wildberries/Ozon
- **Профильные РУ-каталоги** — подборки «сервисы для …», «российские аналоги …»
- **GitHub** — по-прежнему релевантен для dev-инструментов

Widen to Reddit / X / LinkedIn / ProductHunt / G2 only if the RU assumption is wrong. Note: LinkedIn имеет ограниченный доступ в РФ — не полагайся на него как на основной канал.

Avoid private groups, gated communities, data brokers, scraped contact databases, and sources that prohibit access. Search the original public page and do not qualify from a search snippet alone.

## Qualification score

Score every dimension from 0 to 5:

- **Pain strength (25%)** — directness, severity, repetition, and cost of the stated problem.
- **Product fit (25%)** — how directly the startup solves the evidenced job.
- **Timing (20%)** — freshness and presence of a current trigger (импортозамещение counts as strong timing).
- **Public reachability (15%)** — a natural, relevant public or professional contact path exists (Telegram/VC/Habr/VK, публичная почта компании).
- **Evidence quality (15%)** — specificity, source reliability, and confidence that the signal belongs to the prospect.

Calculate:

```text
score = pain_strength/5*25
      + product_fit/5*25
      + timing/5*20
      + reachability/5*15
      + evidence_quality/5*15
```

Interpretation:

- **80–100:** strong first-customer candidate
- **65–79:** promising, validate quickly
- **50–64:** plausible but missing a material signal
- **Below 50:** do not include in the primary shortlist

For RU sources without a visible date, reduce timing and label the date as unavailable. A company that merely matches the industry without an evidenced trigger is not a qualified prospect.

## Prospect stages

- **High intent (высокий интент):** publicly requesting a solution or actively switching (в т.ч. ищет российский аналог).
- **Problem aware (проблема осознана):** clearly describing the pain or expensive workaround.
- **Trigger present (триггер):** a current business event makes the product relevant.
- **Potential fit (потенциальный фит):** ICP match with incomplete evidence; keep outside the primary shortlist.

## Privacy and compliance (RU / 152-ФЗ)

- Use only public, intentionally shared **business** information. Handle any personal data consistently with Russian law (152-ФЗ) and platform rules.
- Do not collect, store, or enrich personal data (личная почта, телефон, домашний адрес, семья). No data brokers, leaked datasets, or scraped contact databases.
- Do not target or infer sensitive traits (здоровье, финансовые трудности, политические/религиозные взгляды и т.п.).
- Prefer companies, public professional profiles, and public requests over private individuals.

## Outreach rules (RU)

Recommend the natural RU channel already tied to the source — Telegram (DM или чат), комментарий на vc.ru/Habr, сообщение в VK, публичная почта компании. Do not default to LinkedIn.

Tone — Startend house style: пиши на «Вы», начинай с «привет», честно, без продажных приёмов и без дедлайн-давления. Не изображай близкое знакомство.

Draft one opener using this shape:

1. упомяни публичный контекст (их пост/кейс) естественно
2. свяжи с конкретной болью
3. объясни продукт одним предложением
4. задай один необременительный вопрос

Keep it under 90 words. Never claim the message was sent. Do not include private emails, phone numbers, personal addresses, family information, or sensitive traits.

## Evidence ledger

For each qualified prospect record:

- displayed company, project, or public professional name
- source title and URL
- visible publication date or «дата неизвестна»
- source type
- concise pain or timing signal
- observed evidence versus inference
- score breakdown
- freshness warning when relevant

Use citations in the chat response whenever web research was performed.
