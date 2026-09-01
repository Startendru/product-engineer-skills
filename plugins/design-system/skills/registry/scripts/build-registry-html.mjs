#!/usr/bin/env node
/**
 * registry.json -> registry.html: автономный просмотр реестра дизайн-системы.
 *
 * Зачем отдельный файл, а не «откройте json»: реестр адресован человеку, который
 * не читает код. Он должен открываться двойным щелчком, без сборки, без сервера
 * и без интернета — поэтому стили и данные лежат внутри html, а внешних ссылок
 * в нём нет вовсе.
 *
 * Использование:
 *   node build-registry-html.mjs design-system/registry.json design-system/registry.html
 *
 * Второй аргумент необязателен: по умолчанию registry.html рядом с исходным json.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Уровни в порядке показа: сначала материал, потом детали, потом сборки, потом правила. */
export const LEVELS = [
  ['foundation', 'Основания', 'Материал системы: цвета, кегли, отступы, иконки. Не компоненты, но из них сделано всё остальное'],
  ['atom', 'Атомы', 'Самые мелкие контролы: кнопка, поле, чекбокс. Дальше делить нечего'],
  ['molecule', 'Молекулы', 'Несколько атомов, собранных ради одной задачи'],
  ['organism', 'Организмы', 'Самостоятельные куски экрана со своим поведением: таблица, окно, шапка'],
  ['pattern', 'Паттерны', 'Правила и повторяющиеся решения, обязательные для всех компонентов'],
  ['template', 'Шаблоны страниц', 'Правила уровня страницы целиком — то, чего отдельный компонент знать не может'],
]

export const STATUS = {
  ready: { label: 'Готово', mark: '✓', hint: 'Компонент готов и все места в продукте им пользуются' },
  draft: { label: 'Черновик', mark: '◐', hint: 'Есть, но недоделан либо внедрён не везде' },
  missing: { label: 'Отсутствует', mark: '—', hint: 'В системе этого нет. Записано намеренно, чтобы не потерялось' },
}

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/** Принимает и объект `{ entries: [...] }`, и голый массив записей. */
export function entriesOf(data) {
  if (Array.isArray(data)) return data
  if (data && Array.isArray(data.entries)) return data.entries
  return []
}

function adoptionCell(a) {
  if (!a || typeof a.total !== 'number' || a.total === 0) {
    return '<div class="cell adopt"><span class="dim">доля не считалась</span></div>'
  }
  const pct = Math.round((a.migrated / a.total) * 100)
  return (
    '<div class="cell adopt">' +
    `<div class="bar" role="img" aria-label="внедрено ${pct} процентов"><i style="width:${pct}%"></i></div>` +
    `\n<div class="num">${a.migrated} из ${a.total} мест · ${pct}%</div>` +
    '</div>'
  )
}

function chips(title, list) {
  if (!Array.isArray(list) || list.length === 0) return ''
  return (
    `<div class="kv"><span class="k">${esc(title)}</span><span class="v chips">` +
    list.map((x) => `<span class="chip">${esc(x)}</span>`).join('') +
    '</span></div>\n'
  )
}

function line(title, value) {
  if (!value) return ''
  return `<div class="kv"><span class="k">${esc(title)}</span><span class="v">${esc(value)}</span></div>\n`
}

function renderEntry(e) {
  const st = STATUS[e.status] ?? { label: e.status, mark: '?', hint: '' }
  const used = Array.isArray(e.usedOn) && e.usedOn.length
    ? `<div class="kv"><span class="k">Где применяется</span><span class="v"><ul>` +
      e.usedOn.map((u) => `<li>${esc(u)}</li>`).join('') + '</ul></span></div>\n'
    : ''
  const impl = e.impl && e.impl.source
    ? line('Файл компонента', e.impl.source)
    : ''
  const forks = e.impl && Array.isArray(e.impl.alternatives) && e.impl.alternatives.length
    ? chips('Обходные реализации', e.impl.alternatives)
    : ''

  return (
    `<article class="entry" data-status="${esc(e.status)}" data-text="${esc((e.title || '') + ' ' + (e.id || '') + ' ' + (e.description || '')).toLowerCase()}">\n` +
      '<div class="head">\n' +
        `<div class="cell name"><h3>${esc(e.title || e.id)}</h3><code>${esc(e.id)}</code></div>\n` +
        `<div class="cell status s-${esc(e.status)}" title="${esc(st.hint)}"><span class="mark">${esc(st.mark)}</span> ${esc(st.label)}</div>\n` +
        adoptionCell(e.adoption) + '\n' +
      '</div>\n' +
      `<p class="desc">${esc(e.description || '')}</p>\n` +
      chips('Варианты', e.variants) +
      chips('Состояния', e.states) +
      line('Доступность', e.a11y) +
      impl + forks + used +
      line('Почему не готово', e.note) +
      line('Ждёт другой записи', e.blockedBy) +
    '</article>\n'
  )
}

export function renderRegistryHtml(data) {
  const all = entriesOf(data)
  const count = (s) => all.filter((e) => e.status === s).length
  const withAdoption = all.filter((e) => e.adoption && e.adoption.total > 0)
  const totalPlaces = withAdoption.reduce((n, e) => n + e.adoption.total, 0)
  const migratedPlaces = withAdoption.reduce((n, e) => n + e.adoption.migrated, 0)
  const overall = totalPlaces ? Math.round((migratedPlaces / totalPlaces) * 100) : 0

  const sections = LEVELS.map(([key, title, hint]) => {
    const list = all.filter((e) => e.level === key)
    if (list.length === 0) return ''
    return (
      `<section class="level" data-level="${key}">` +
        `<h2>${esc(title)} <span class="count">${list.length}</span></h2>` +
        `<p class="lead">${esc(hint)}</p>` +
        list.map(renderEntry).join('') +
      '</section>\n'
    )
  }).join('')

  const orphans = all.filter((e) => !LEVELS.some(([k]) => k === e.level))
  const orphanSection = orphans.length
    ? '<section class="level"><h2>Уровень не распознан <span class="count">' + orphans.length + '</span></h2>' +
      '<p class="lead">У этих записей в поле «уровень» стоит что-то неизвестное. Проверка такое не пропускает — значит просмотр собран из непроверенного файла.</p>' +
      orphans.map(renderEntry).join('') + '</section>\n'
    : ''

  const today = new Date().toISOString().slice(0, 10)

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Реестр дизайн-системы</title>
<style>
  :root{
    --paper:#ffffff; --canvas:#f4f2ee; --line:#e2ded6; --ink:#1c1b1a; --soft:#5c5952;
    --ok:#1f6f43; --ok-bg:#e6f2ea; --draft:#8a5a00; --draft-bg:#fbf0da; --none:#7a3b34; --none-bg:#f6e6e3;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--canvas);color:var(--ink);
    font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
  .wrap{max-width:1080px;margin:0 auto;padding:32px 20px 96px}
  h1{font-size:30px;margin:0 0 6px}
  .sub{color:var(--soft);margin:0 0 24px}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}
  .tile{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
  .tile b{display:block;font-size:26px;line-height:1.1}
  .tile span{color:var(--soft);font-size:13px}
  .legend{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin-bottom:20px}
  .legend p{margin:0 0 6px}
  .legend p:last-child{margin:0}
  .controls{position:sticky;top:0;z-index:5;background:var(--canvas);padding:12px 0;margin-bottom:8px;
    display:flex;gap:8px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--line)}
  .controls button{font:inherit;font-size:14px;padding:7px 14px;border-radius:999px;cursor:pointer;
    border:1px solid var(--line);background:var(--paper);color:var(--ink)}
  .controls button[aria-pressed="true"]{background:var(--ink);color:var(--paper);border-color:var(--ink)}
  .controls button:focus-visible,.controls input:focus-visible{outline:3px solid #2f6feb;outline-offset:2px}
  .controls input{font:inherit;font-size:14px;padding:7px 12px;border-radius:999px;border:1px solid var(--line);
    background:var(--paper);min-width:220px;flex:1}
  section.level{margin-top:34px}
  section.level h2{font-size:20px;margin:0 0 2px;display:flex;align-items:center;gap:10px}
  .count{font-size:13px;font-weight:400;color:var(--soft);border:1px solid var(--line);
    border-radius:999px;padding:1px 9px;background:var(--paper)}
  .lead{color:var(--soft);font-size:14px;margin:0 0 14px}
  .entry{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:10px}
  /* Фиксированные ячейки: одноимённые индикаторы стоят строго друг под другом
     во всех строках и не скачут от длины соседнего содержимого. */
  .head{display:grid;grid-template-columns:1fr 150px 230px;gap:14px;align-items:start}
  .cell.name h3{margin:0;font-size:17px}
  .cell.name code{font-size:12px;color:var(--soft)}
  .cell.status{justify-self:stretch;text-align:center;font-size:13px;font-weight:600;
    border-radius:999px;padding:5px 8px;white-space:nowrap}
  .cell.status .mark{font-weight:700}
  .s-ready{color:var(--ok);background:var(--ok-bg)}
  .s-draft{color:var(--draft);background:var(--draft-bg)}
  .s-missing{color:var(--none);background:var(--none-bg)}
  .cell.adopt{text-align:right}
  .bar{height:8px;border-radius:999px;background:#eceae5;overflow:hidden}
  .bar i{display:block;height:100%;background:var(--ink)}
  .num{font-size:12px;color:var(--soft);margin-top:4px;
    font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1}
  .dim{font-size:12px;color:var(--soft)}
  .desc{margin:12px 0 8px}
  .kv{display:grid;grid-template-columns:170px 1fr;gap:10px;font-size:14px;padding:4px 0;
    border-top:1px solid #f0eee9}
  .kv .k{color:var(--soft)}
  .kv ul{margin:0;padding-left:18px}
  .chips{display:flex;flex-wrap:wrap;gap:6px}
  .chip{border:1px solid var(--line);border-radius:999px;padding:1px 9px;font-size:13px;background:var(--canvas)}
  .empty{padding:24px;text-align:center;color:var(--soft)}
  @media (max-width:720px){
    .head{grid-template-columns:1fr}
    .cell.adopt{text-align:left}
    .kv{grid-template-columns:1fr}
  }
</style>
</head>
<body>
<div class="wrap">
  <h1>Реестр дизайн-системы</h1>
  <p class="sub">Что в системе есть, чего в ней нет и какие правила обязательны для всех. Собрано ${today}.</p>

  <div class="tiles">
    <div class="tile"><b>${all.length}</b><span>записей всего</span></div>
    <div class="tile"><b>${count('ready')}</b><span>готово</span></div>
    <div class="tile"><b>${count('draft')}</b><span>черновик</span></div>
    <div class="tile"><b>${count('missing')}</b><span>отсутствует</span></div>
    <div class="tile"><b>${overall}%</b><span>мест в продукте переведено</span></div>
  </div>

  <div class="legend">
    <p><b>✓ Готово</b> — компонент доделан <i>и</i> все места в продукте им пользуются. Пока хоть одно место идёт мимо, статус не «готово».</p>
    <p><b>◐ Черновик</b> — существует, но недоделан либо внедрён не везде. В строке видно, сколько мест уже переведено.</p>
    <p><b>— Отсутствует</b> — этого в системе нет, и это записано намеренно. Такая строка — не упущение, а пункт плана работ.</p>
  </div>

  <div class="controls">
    <button type="button" data-filter="all" aria-pressed="true">Все</button>
    <button type="button" data-filter="ready" aria-pressed="false">✓ Готово</button>
    <button type="button" data-filter="draft" aria-pressed="false">◐ Черновик</button>
    <button type="button" data-filter="missing" aria-pressed="false">— Отсутствует</button>
    <input type="search" id="q" placeholder="Найти по названию" aria-label="Найти запись по названию">
  </div>

  <div id="list">${sections}${orphanSection}</div>
  <p class="empty" id="nothing" hidden>Ничего не подошло. Снимите фильтр или измените запрос.</p>
</div>
<script>
  var state = { status: 'all', q: '' };
  var entries = Array.prototype.slice.call(document.querySelectorAll('.entry'));
  var sections = Array.prototype.slice.call(document.querySelectorAll('section.level'));

  function apply() {
    var shown = 0;
    entries.forEach(function (el) {
      var okStatus = state.status === 'all' || el.dataset.status === state.status;
      var okText = !state.q || el.dataset.text.indexOf(state.q) !== -1;
      var visible = okStatus && okText;
      el.hidden = !visible;
      if (visible) shown++;
    });
    sections.forEach(function (s) {
      s.hidden = s.querySelectorAll('.entry:not([hidden])').length === 0;
    });
    document.getElementById('nothing').hidden = shown !== 0;
  }

  document.querySelectorAll('.controls button').forEach(function (b) {
    b.addEventListener('click', function () {
      state.status = b.dataset.filter;
      document.querySelectorAll('.controls button').forEach(function (o) {
        o.setAttribute('aria-pressed', String(o === b));
      });
      apply();
    });
  });
  document.getElementById('q').addEventListener('input', function (e) {
    state.q = e.target.value.trim().toLowerCase();
    apply();
  });
</script>
</body>
</html>
`
}

/* --- запуск из командной строки --- */
const invokedDirectly = process.argv[1] && process.argv[1].endsWith('build-registry-html.mjs')
if (invokedDirectly) {
  const src = process.argv[2]
  if (!src) {
    console.error('Использование: node build-registry-html.mjs <registry.json> [registry.html]')
    process.exit(1)
  }
  const out = process.argv[3] || join(dirname(src), 'registry.html')
  let data
  try {
    data = JSON.parse(readFileSync(src, 'utf8'))
  } catch (e) {
    console.error(`Не читается ${src}: ${e.message}`)
    process.exit(1)
  }
  writeFileSync(out, renderRegistryHtml(data), 'utf8')
  console.log(`Просмотр реестра собран: ${out}`)
  console.log('Откройте файл двойным щелчком — сборка и сервер не нужны.')
}
