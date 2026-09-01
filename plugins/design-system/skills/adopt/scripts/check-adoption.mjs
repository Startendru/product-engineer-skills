#!/usr/bin/env node
/**
 * Проверка доли внедрения в registry.json и генерация читаемого adoption.md.
 *
 * Скрипт существует потому, что правило «статус `ready` запрещён при доле ниже 100%»
 * относится к тем, которые обходят не по незнанию, а под давлением срока. В базовой
 * линии агент, услышав «завтра показывать инвесторам», поставил `ready` при доле 61%
 * и тут же в соседнем поле записал, что 86 мест ещё не мигрированы. Правило было
 * известно из самих данных и всё равно нарушено — значит, его должен пересчитывать
 * не человек, а машина.
 *
 * Использование:
 *   node check-adoption.mjs design-system/registry.json <корень проекта>
 *
 * Код возврата 0 — прошло, adoption.md перезаписан рядом с реестром.
 * Код возврата 1 — не прошло, причины напечатаны.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, extname } from 'node:path'

const problems = []
const fail = (m) => problems.push(m)

const STATUSES = ['ready', 'draft', 'missing']
const isCount = (v) => Number.isInteger(v) && v >= 0

/** Доля внедрения в процентах, округлённая вниз: 218/219 обязано показываться как 99%, а не 100%. */
const share = (m, t) => (t > 0 ? Math.floor((m / t) * 100) : 0)

// --- обход исходников целевого проекта -------------------------------------

/**
 * Папки, которые не являются продуктом. `docs` и `artifacts` попали сюда по итогу
 * прогона GREEN: в них лежали выгруженные html-отчёты с 264 тегами `<button>`, и
 * знаменатель раздувался вчетверо. Ошибка в безопасную сторону — доля занижалась, — но
 * число, которое очевидно не про продукт, обесценивает всю метрику и провоцирует считать
 * мимо проверки.
 */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage',
  '.turbo', '.vercel', 'design-system',
  'docs', 'artifacts', 'public', 'storybook-static', 'fixtures', '__fixtures__',
])
const EXTS = new Set(['.tsx', '.jsx', '.ts', '.js', '.mjs', '.vue', '.svelte', '.astro', '.html'])
const isTest = (p) => /(\.|_)(test|spec)\.|__tests__|\/tests?\//.test(p)

/**
 * Исходники продукта. `roots` — необязательное сужение области счёта: если запись
 * называет папки явно (`["app", "components"]`), считаем только их. Сужение честнее
 * расширения: оно записано в реестре и видно проверяющему.
 */
function collectSources(root, roots) {
  if (Array.isArray(roots) && roots.length) {
    return roots.flatMap((r) => collectSources(join(root, r), null))
  }
  const out = []
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(dir, e)
      let st
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(e) && !e.startsWith('.')) walk(full)
      } else if (EXTS.has(extname(e)) && !isTest(full)) {
        out.push(full)
      }
    }
  }
  walk(root)
  return out.map((f) => {
    try {
      return readFileSync(f, 'utf8')
    } catch {
      return ''
    }
  })
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Число мест вызова тега. Считаем открывающие теги, а не упоминания: объявление
 * компонента и его импорт местами вызова не являются.
 */
function countTag(sources, tag) {
  const re = new RegExp(`<${escapeRe(tag)}(?=[\\s/>])`, 'g')
  let n = 0
  for (const s of sources) n += (s.match(re) ?? []).length
  return n
}

// --- проверки ---------------------------------------------------------------

/** Ключи, которыми пробуют завести второй, «витринный» статус в обход основного. */
function checkNoSecondStatus(rec, where) {
  for (const [key, value] of Object.entries(rec)) {
    if (key === 'status') continue
    if (typeof value !== 'string') continue
    const norm = value.trim().toLowerCase()
    if (norm === 'ready' || norm === 'готов' || norm === 'готово') {
      fail(
        `${where}: поле «${key}» содержит «${value}». Статус в записи ровно один — поле status. ` +
        `Второе поле со значением «готов» — это тот же ready, просто под другим именем`
      )
    }
  }
}

function checkStatusValue(rec, where) {
  const raw = rec.status
  if (typeof raw !== 'string') {
    fail(`${where}: нет поля status`)
    return null
  }
  if (STATUSES.includes(raw)) return raw

  const norm = raw.trim().toLowerCase()
  // «Ready», «ready », «READY» — то же самое правило, просто записанное иначе
  if (STATUSES.includes(norm)) {
    fail(`${where}: status = «${raw}». Допустимы ровно три значения: ready, draft, missing — строчными и без пробелов`)
    return norm
  }
  // «ready*», «почти ready», «ready (частично)», «pre-ready» — попытка сохранить слово,
  // но вывести значение из-под проверки
  if (/ready|готов/i.test(raw)) {
    fail(
      `${where}: status = «${raw}» — выдуманное значение со словом «ready». ` +
      `Статусов ровно три: ready, draft, missing. Оговорка в названии статуса не смягчает статус, ` +
      `а прячет его от проверки: витрина покажет такую запись зелёной, а доля останется прежней`
    )
    return null
  }
  fail(`${where}: status = «${raw}». Допустимы ровно три значения: ready, draft, missing`)
  return null
}

function checkAdoptionShape(rec, where) {
  const a = rec.adoption
  if (!a || typeof a !== 'object' || Array.isArray(a)) {
    fail(`${where}: нет поля adoption { migrated, total }. Запись без доли внедрения непроверяема`)
    return null
  }
  let ok = true
  if (!isCount(a.migrated)) {
    fail(`${where}: adoption.migrated не целое число ≥ 0. Сколько мест уже берут компонент из системы?`)
    ok = false
  }
  if (!isCount(a.total)) {
    fail(`${where}: adoption.total не целое число ≥ 0. Сколько всего мест этой роли в продукте?`)
    ok = false
  }
  if (ok && a.migrated > a.total) {
    fail(`${where}: adoption.migrated (${a.migrated}) больше adoption.total (${a.total})`)
    ok = false
  }
  return ok ? a : null
}

function checkExclusions(rec, where) {
  const list = rec.adoption?.exclusions
  if (list === undefined) return 0
  if (!Array.isArray(list)) {
    fail(`${where}: adoption.exclusions должно быть массивом`)
    return 0
  }
  let sum = 0
  for (const [i, ex] of list.entries()) {
    const w = `${where}.adoption.exclusions[${i}]`
    if (!ex || typeof ex !== 'object') {
      fail(`${w}: не объект { where, count, reason }`)
      continue
    }
    if (!ex.where || typeof ex.where !== 'string') fail(`${w}: нет поля where — какие именно места выведены из знаменателя`)
    if (!isCount(ex.count) || ex.count === 0) {
      fail(`${w}: count не целое число больше нуля`)
    } else {
      sum += ex.count
    }
    const reason = typeof ex.reason === 'string' ? ex.reason.trim() : ''
    if (reason.length < 30) {
      fail(
        `${w}: reason короче 30 знаков («${reason}»). Исключение уменьшает знаменатель, то есть ` +
        `поднимает долю. Причина, которую нельзя прочитать и оспорить, превращает знаменатель в ручку громкости`
      )
    }
  }
  return sum
}

/** Главное правило набора. Проверяется числами, а не чтением записи. */
function checkReadyRule(rec, status, a, where) {
  if (status !== 'ready') return
  if (!a) return
  if (a.total === 0) {
    fail(`${where}: status = ready при adoption.total = 0. Готовым называется то, что где-то используется`)
    return
  }
  if (a.migrated !== a.total) {
    const left = a.total - a.migrated
    fail(
      `${where}: status = ready при доле ${share(a.migrated, a.total)}% ` +
      `(${a.migrated} из ${a.total}, не мигрировано ${left}). ` +
      `Статус ready разрешён только при 100%. Пока доля ниже — это draft, сколько бы ни было готово в самом компоненте`
    )
  }
}

function checkNote(rec, status, a, where) {
  if (status === 'ready') return
  const note = typeof rec.note === 'string' ? rec.note.trim() : ''
  if (!note) {
    fail(`${where}: статус «${status}», но поле note пустое. Незакрытая запись обязана объяснять, что именно мешает`)
  }
}

/** Пересчёт заявленных чисел по коду. Заявленному не верим — это урок прогонов 4 и 5. */
function recount(rec, status, a, projectRoot, where, exclusionsSum) {
  const cb = rec.adoption?.countedBy
  if (!cb) {
    if (status === 'ready') {
      fail(
        `${where}: status = ready, но нет adoption.countedBy — доля не пересчитывается по коду. ` +
        `Стопроцентная доля, которую никто не пересчитал, ничем не отличается от желаемой`
      )
    }
    return null
  }
  const migratedTags = cb.migratedTags ?? []
  const legacyTags = cb.legacyTags ?? []
  const rawTags = cb.rawTags ?? []
  if (!Array.isArray(migratedTags) || migratedTags.length === 0) {
    fail(`${where}: adoption.countedBy.migratedTags пуст — нечем считать мигрированные места`)
    return null
  }
  if (!Array.isArray(legacyTags) || !Array.isArray(rawTags)) {
    fail(`${where}: adoption.countedBy.legacyTags и rawTags должны быть массивами (пустыми, если таких нет)`)
    return null
  }
  const sources = collectSources(projectRoot, cb.roots)
  if (!sources.length) {
    fail(`${where}: в области счёта не нашлось ни одного файла исходников (roots: ${(cb.roots ?? ['<весь проект>']).join(', ')})`)
    return null
  }

  const migrated = migratedTags.reduce((n, t) => n + countTag(sources, t), 0)
  const legacy = [...legacyTags, ...rawTags].reduce((n, t) => n + countTag(sources, t), 0)
  const total = migrated + legacy - exclusionsSum

  if (a && a.migrated !== migrated) {
    fail(
      `${where}: adoption.migrated = ${a.migrated}, а пересчёт по коду даёт ${migrated} ` +
      `(теги: ${migratedTags.join(', ')})`
    )
  }
  if (a && a.total !== total) {
    fail(
      `${where}: adoption.total = ${a.total}, а пересчёт по коду даёт ${total} ` +
      `(мигрировано ${migrated} + осталось ${legacy} − исключено ${exclusionsSum})`
    )
  }
  return { migrated, total }
}

// --- отчёт ------------------------------------------------------------------

function renderMd(records) {
  const L = []
  L.push('# Внедрение дизайн-системы', '')
  L.push('Сгенерировано из `registry.json`. Руками не править — правьте реестр и перезапустите проверку.', '')

  const rows = records.filter((r) => r.status !== 'missing')
  const done = rows.filter((r) => r.adoption?.total > 0 && r.adoption.migrated === r.adoption.total).length
  L.push(`Записей со стопроцентным внедрением: **${done}** из **${rows.length}**.`, '')

  L.push('| Запись | Статус | Доля | Мигрировано | Всего | Осталось | Что мешает |')
  L.push('| --- | --- | ---: | ---: | ---: | ---: | --- |')
  for (const r of [...records].sort((x, y) => share(x.adoption?.migrated ?? 0, x.adoption?.total ?? 0) - share(y.adoption?.migrated ?? 0, y.adoption?.total ?? 0))) {
    const a = r.adoption ?? { migrated: 0, total: 0 }
    const pct = a.total > 0 ? `${share(a.migrated, a.total)}%` : '—'
    const left = a.total - a.migrated
    L.push(`| ${r.title ?? r.id} | ${r.status} | ${pct} | ${a.migrated} | ${a.total} | ${left} | ${r.note ?? ''} |`)
  }
  L.push('')

  const excluded = records.flatMap((r) =>
    (r.adoption?.exclusions ?? []).map((e) => ({ id: r.title ?? r.id, ...e }))
  )
  if (excluded.length) {
    L.push('## Выведено из знаменателя', '')
    L.push('| Запись | Где | Мест | Почему |', '| --- | --- | ---: | --- |')
    for (const e of excluded) L.push(`| ${e.id} | \`${e.where}\` | ${e.count} | ${e.reason} |`)
    L.push('')
  }

  const next = [...records]
    .filter((r) => r.status === 'draft' && (r.adoption?.total ?? 0) > 0)
    .sort((x, y) => (y.adoption.total - y.adoption.migrated) - (x.adoption.total - x.adoption.migrated))[0]
  if (next) {
    L.push('## Следующая пачка', '')
    L.push(
      `Больше всего немигрированных мест у записи «${next.title ?? next.id}»: ` +
      `${next.adoption.total - next.adoption.migrated}. С неё и начинать.`,
      ''
    )
  }
  return L.join('\n')
}

// --- вход -------------------------------------------------------------------

const path = process.argv[2]
const projectRoot = process.argv[3]
if (!path || !projectRoot) {
  console.error('Использование: node check-adoption.mjs <путь к registry.json> <корень проекта>')
  console.error('')
  console.error('Корень проекта обязателен: без него доля внедрения проверяется только сама с собой,')
  console.error('а доля, которую никто не пересчитал по коду, — это не измерение, а намерение.')
  process.exit(1)
}

let records
try {
  records = JSON.parse(readFileSync(path, 'utf8'))
} catch (e) {
  console.error(`Не читается ${path}: ${e.message}`)
  process.exit(1)
}
if (!Array.isArray(records) || records.length === 0) {
  console.error(`${path}: ожидался непустой массив записей реестра`)
  process.exit(1)
}

try {
  statSync(projectRoot)
} catch (e) {
  console.error(`Не читается корень проекта ${projectRoot}: ${e.message}`)
  process.exit(1)
}

for (const [i, rec] of records.entries()) {
  const where = `запись[${i}]${rec?.id ? ` (${rec.id})` : ''}`
  if (!rec || typeof rec !== 'object') {
    fail(`${where}: не объект`)
    continue
  }
  const status = checkStatusValue(rec, where)
  checkNoSecondStatus(rec, where)
  const a = checkAdoptionShape(rec, where)
  const exclusionsSum = checkExclusions(rec, where)
  if (status === 'missing' && a && a.migrated !== 0) {
    fail(`${where}: статус missing при adoption.migrated = ${a.migrated}. Отсутствующее не бывает мигрированным`)
  }
  checkReadyRule(rec, status, a, where)
  checkNote(rec, status, a, where)
  if (status !== 'missing') recount(rec, status, a, projectRoot, where, exclusionsSum)
}

if (problems.length) {
  console.error(`Учёт внедрения не прошёл проверку — ${problems.length} замечаний:\n`)
  for (const p of problems) console.error(`  • ${p}`)
  console.error('\nПока эти пункты не закрыты, шаг не завершён. Срок показа не является закрытием пункта:')
  console.error('реестр переживёт этот показ, а неверная доля в нём — следующие полгода.')
  process.exit(1)
}

const mdPath = join(dirname(path), 'adoption.md')
writeFileSync(mdPath, renderMd(records), 'utf8')
console.log(`Проверка пройдена. Читаемый отчёт записан: ${mdPath}`)
