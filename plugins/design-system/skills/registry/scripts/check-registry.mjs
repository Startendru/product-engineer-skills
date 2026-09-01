#!/usr/bin/env node
/**
 * Проверка registry.json и сборка registry.html.
 *
 * Скрипт существует потому, что реестр проваливается способом, который чтением
 * глазами не ловится вовсе: артефакт сходится сам с собой и не имеет отношения к
 * проекту. На отладке набора это было измерено прямо — реестр прошёл все проверки
 * внутренней согласованности, при этом самая массовая реализация кнопки в нём
 * отсутствовала, а два мёртвых компонента были записаны живыми. Ссылка на файл и
 * число выглядят одинаково достоверно независимо от того, измерены они или сочинены.
 *
 * Поэтому проверка принимает корень проекта и ПЕРЕСЧИТЫВАЕТ заявленное по коду.
 *
 * Использование:
 *   node check-registry.mjs design-system/registry.json . [design-system/tokens.json]
 *
 * Код возврата 0 — прошло, registry.html пересобран рядом.
 * Код возврата 1 — не прошло, причины напечатаны.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, basename, extname } from 'node:path'
import { renderRegistryHtml, entriesOf } from './build-registry-html.mjs'

const problems = []
const fail = (m) => problems.push(m)
const isCount = (v) => Number.isInteger(v) && v >= 0

const LEVELS = new Set(['foundation', 'atom', 'molecule', 'organism', 'pattern', 'template'])
const STATUSES = new Set(['ready', 'draft', 'missing'])
const COMPONENT_LEVELS = new Set(['atom', 'molecule', 'organism'])

/** Роли с нативным эквивалентом. У карточки или вкладок его нет — считать их по `<div>` бессмысленно. */
const NATIVE_TAGS = new Set(['button', 'input', 'select', 'textarea', 'label', 'a', 'form', 'table', 'dialog'])

/**
 * Каталог из 29 паттернов. Он покрывает типичную дизайн-систему целиком, а не только то,
 * что нашлось в конкретном проекте: иначе система молча наследует пробелы того продукта,
 * на котором её собирали. Отсутствие каждого — законный ответ, но записанный: статус
 * `missing` с причиной. Молчание ответом не считается.
 */
const CATALOG = [
  // 1–10 · cross-cutting.md
  ['focus-indicator', 'pattern'], ['control-states', 'pattern'], ['target-size', 'pattern'],
  ['accessible-name', 'pattern'], ['not-color-alone', 'pattern'], ['motion', 'pattern'],
  ['text-overflow', 'pattern'], ['tabular-numbers', 'pattern'], ['icons', 'pattern'],
  ['indicator-alignment', 'pattern'],
  // 11–22 · flows.md
  ['forms', 'pattern'], ['form-errors', 'pattern'], ['long-forms', 'pattern'],
  ['tables-and-lists', 'pattern'], ['empty-states', 'pattern'], ['loading', 'pattern'],
  ['modals-and-panels', 'pattern'], ['notifications', 'pattern'], ['destructive-confirm', 'pattern'],
  ['search-and-filter', 'pattern'], ['navigation', 'pattern'], ['file-upload', 'pattern'],
  // 23–29 · page-templates.md
  ['app-shell', 'template'], ['heading-hierarchy', 'template'], ['surface-model', 'template'],
  ['page-header', 'template'], ['screen-archetypes', 'template'], ['breakpoints', 'template'],
  ['line-length', 'template'],
]

/* ------------------------------------------------------------------ *
 * 1. Схема записи
 * ------------------------------------------------------------------ */

function checkSchema(entries) {
  if (entries.length === 0) {
    fail('entries: пусто. Реестр без единой записи — не реестр')
    return
  }
  const seen = new Map()
  for (const [i, e] of entries.entries()) {
    const w = `entries[${i}]${e.id ? ` (${e.id})` : ''}`
    if (!e.id || typeof e.id !== 'string') fail(`${w}: нет поля id`)
    else if (seen.has(e.id)) fail(`${w}: id «${e.id}» уже занят записью entries[${seen.get(e.id)}]`)
    else seen.set(e.id, i)

    if (!e.title) fail(`${w}: нет названия (title) — просмотр реестра покажет пустую карточку`)
    if (!LEVELS.has(e.level)) fail(`${w}: level = ${JSON.stringify(e.level)}, а должен быть одним из: ${[...LEVELS].join(', ')}`)
    if (!STATUSES.has(e.status)) fail(`${w}: status = ${JSON.stringify(e.status)}, а должен быть ready, draft или missing`)
    if (!e.description) fail(`${w}: нет описания. Одна строка «что это и когда применяется» обязательна`)

    // доля внедрения
    const a = e.adoption
    if (a !== null && a !== undefined) {
      if (typeof a !== 'object') fail(`${w}: adoption должен быть объектом { migrated, total } либо null`)
      else {
        if (!isCount(a.migrated)) fail(`${w}: adoption.migrated не целое число. Сколько мест уже пользуются?`)
        if (!isCount(a.total)) fail(`${w}: adoption.total не целое число. Сколько всего мест?`)
        if (isCount(a.migrated) && isCount(a.total) && a.migrated > a.total) {
          fail(`${w}: adoption.migrated = ${a.migrated} больше, чем total = ${a.total}`)
        }
      }
    }

    // статус ready — самое обходимое место реестра, поэтому проверяется машинно
    if (e.status === 'ready') {
      if (!a || !isCount(a.total) || a.total === 0) {
        fail(`${w}: статус ready без посчитанной доли внедрения. Готовность без числа — заявление, а не факт`)
      } else if (a.migrated !== a.total) {
        const pct = Math.round((a.migrated / a.total) * 100)
        fail(`${w}: статус ready при доле внедрения ${pct}% (${a.migrated} из ${a.total}). ` +
             `ready запрещён ниже 100%: правка в компоненте не доедет до ${a.total - a.migrated} мест`)
      }
    }

    if ((e.status === 'draft' || e.status === 'missing') && !e.note) {
      fail(`${w}: статус ${e.status} без note. Отсутствие, не объяснённое явно, через месяц неотличимо от «не нужно»`)
    }

    for (const [k, v] of [['variants', e.variants], ['states', e.states], ['usedOn', e.usedOn]]) {
      if (v !== undefined && v !== null && !Array.isArray(v)) fail(`${w}: ${k} должен быть массивом строк`)
    }

    if (e.impl !== null && e.impl !== undefined) {
      if (typeof e.impl !== 'object') fail(`${w}: impl должен быть объектом либо null`)
      else {
        if (e.impl.nativeTag && !NATIVE_TAGS.has(e.impl.nativeTag)) {
          fail(`${w}: impl.nativeTag = «${e.impl.nativeTag}» — такого нативного контрола нет. ` +
               `У роли без нативного тега ставьте null: считать её по <div> бессмысленно`)
        }
        if (e.impl.alternatives !== undefined && e.impl.alternatives !== null && !Array.isArray(e.impl.alternatives)) {
          fail(`${w}: impl.alternatives должен быть массивом имён компонентов`)
        }
      }
    } else if (COMPONENT_LEVELS.has(e.level)) {
      fail(`${w}: у записи уровня ${e.level} нет impl. Без привязки к коду числа проверить нечем`)
    }
  }

  // blockedBy обязан указывать на существующую запись
  for (const e of entries) {
    if (e.blockedBy && !seen.has(e.blockedBy)) {
      fail(`entries (${e.id}): blockedBy = «${e.blockedBy}», но записи с таким id в реестре нет`)
    }
  }
}

/* ------------------------------------------------------------------ *
 * 2. Полнота каталога
 * ------------------------------------------------------------------ */

function checkCatalog(entries) {
  const byId = new Map(entries.map((e) => [e.id, e]))
  const absent = []
  for (const [id, level] of CATALOG) {
    const e = byId.get(id)
    if (!e) { absent.push(id); continue }
    if (e.level !== level) {
      fail(`каталог: «${id}» записан уровнем ${e.level}, а это ${level}`)
    }
  }
  if (absent.length) {
    fail(
      `каталог паттернов неполон: нет ${absent.length} из ${CATALOG.length}.\n      ` +
      absent.join(', ') +
      `\n      Каждый заводится записью, даже если в вашем продукте такого случая нет: ` +
      `тогда статус missing и причина. Иначе система наследует пробелы проекта, на котором собиралась`
    )
  }
}

/* ------------------------------------------------------------------ *
 * 3. Сверка с кодом проекта
 * ------------------------------------------------------------------ */

const CODE_EXT = new Set(['.tsx', '.jsx', '.ts', '.js'])
const SKIP_DIR = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'out', 'coverage', 'tests', '__tests__', 'e2e'])
const isTestFile = (p) => /\.(test|spec|stories)\.[jt]sx?$/.test(p)
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function collectFiles(root) {
  const out = []
  const walk = (dir) => {
    let entries
    try { entries = readdirSync(dir) } catch { return }
    for (const name of entries) {
      if (SKIP_DIR.has(name)) continue
      const full = join(dir, name)
      let st
      try { st = statSync(full) } catch { continue }
      if (st.isDirectory()) walk(full)
      else if (CODE_EXT.has(extname(name)) && !isTestFile(name)) out.push(full)
    }
  }
  walk(root)
  return out
}

/** Считает открывающие теги: `<Name` со следующим пробелом, `>` или `/`. */
function countTag(sources, tag) {
  const re = new RegExp(`<${escapeRe(tag)}(?=[\\s>/])`, 'g')
  let n = 0
  for (const src of sources) n += (src.match(re) || []).length
  return n
}

function checkAgainstCode(entries, root) {
  const files = collectFiles(root)
  if (files.length === 0) {
    fail(`в «${root}» не найдено файлов интерфейса. Верный ли путь к корню проекта?`)
    return
  }
  const sources = files.map((f) => { try { return readFileSync(f, 'utf8') } catch { return '' } })
  const srcOf = new Map(files.map((f, i) => [f, sources[i]]))

  for (const e of entries) {
    const w = `entries (${e.id})`
    const impl = e.impl
    if (!impl) continue

    const compName = impl.component || null
    const src = impl.source || null

    // --- 3.1 файл компонента существует, и компонент из него действительно экспортируется
    let srcText = null
    if (src) {
      const abs = join(root, src)
      if (!existsSync(abs)) {
        fail(`${w}: impl.source = «${src}» — такого файла в проекте нет. Компонент назван, но не найден`)
      } else {
        srcText = srcOf.get(abs) ?? (() => { try { return readFileSync(abs, 'utf8') } catch { return '' } })()
        if (compName) {
          const exported = new RegExp(
            `export\\s+(default\\s+)?(function|const|class)\\s+${escapeRe(compName)}\\b|` +
            `export\\s*\\{[^}]*\\b${escapeRe(compName)}\\b`
          ).test(srcText)
          if (!exported) {
            fail(`${w}: «${compName}» не экспортируется из ${src}. Имя компонента угадано, а не найдено в коде`)
          }
        }
      }
    }

    // --- 3.2 «отсутствует» про существующий компонент
    if (e.status === 'missing') {
      if (src && existsSync(join(root, src))) {
        fail(`${w}: статус missing, но файл ${src} в проекте есть. Либо статус неверен, либо ссылка чужая`)
      }
      if (compName && countTag(sources, compName) > 0) {
        fail(`${w}: статус missing, но «${compName}» вызывается в коде ${countTag(sources, compName)} раз`)
      }
      continue
    }

    if (!compName) continue

    // --- 3.3 пересчёт доли внедрения по коду
    const migratedActual = countTag(sources, compName)
    const altNames = Array.isArray(impl.alternatives) ? impl.alternatives : []
    let altTotal = 0
    for (const alt of altNames) {
      const n = countTag(sources, alt)
      if (n === 0) {
        fail(`${w}: обходная реализация «${alt}» в коде не встречается ни разу. ` +
             `Форк либо назван неверно, либо его уже нет — тогда его не надо считать`)
      }
      altTotal += n
    }
    const rawActual = impl.nativeTag ? countTag(sources, impl.nativeTag) : 0
    const totalActual = migratedActual + altTotal + rawActual

    const a = e.adoption
    if (a && isCount(a.migrated) && a.migrated !== migratedActual) {
      fail(`${w}: adoption.migrated = ${a.migrated}, а вызовов «${compName}» в коде ${migratedActual}`)
    }
    if (a && isCount(a.total) && a.total !== totalActual) {
      fail(
        `${w}: adoption.total = ${a.total}, а по коду ${totalActual} ` +
        `(${compName}: ${migratedActual}` +
        (altNames.length ? `, форки ${altNames.join(' + ')}: ${altTotal}` : '') +
        (impl.nativeTag ? `, сырых <${impl.nativeTag}>: ${rawActual}` : '') +
        `). Если число мимо — обычно не найдена ещё одна реализация: впишите её в impl.alternatives`
      )
    }

    // --- 3.4 мёртвый компонент не может быть готовым
    if (e.status === 'ready' && src && srcText !== null) {
      const stem = basename(src, extname(src))
      const re = new RegExp(`from\\s+['"][^'"]*${escapeRe(stem)}['"]`)
      const importers = sources.filter((s, i) => files[i] !== join(root, src) && re.test(s)).length
      if (importers === 0) {
        fail(`${w}: статус ready, но ${src} не импортирует ни один модуль проекта. Готовым назван мёртвый код`)
      }
    }
  }

  // --- 3.5 ссылки «где применяется» ведут в существующие файлы
  for (const e of entries) {
    for (const u of e.usedOn ?? []) {
      if (!existsSync(join(root, String(u)))) {
        fail(`entries (${e.id}): usedOn → «${u}» — такого файла в проекте нет`)
      }
    }
  }

  // --- 3.6 каждый файл компонента учтён
  // Иначе параллельная реализация просто не попадает в реестр, а это главная его потеря.
  const compRoot = String(reg.project?.componentsRoot ?? 'components').replace(/^\.\//, '').replace(/\/$/, '')
  const componentFiles = files.filter((f) => {
    const rel = relative(root, f).replace(/\\/g, '/')
    return rel.startsWith(compRoot + '/') && (extname(f) === '.tsx' || extname(f) === '.jsx')
  })
  if (componentFiles.length === 0) {
    fail(`в «${compRoot}/» не найдено файлов компонентов. Укажите верный project.componentsRoot`)
    return
  }
  const mentioned = new Set()
  const forkNames = new Set()
  for (const e of entries) {
    const s = e.impl?.source
    if (s) mentioned.add(String(s).replace(/\\/g, '/').replace(/^\.\//, ''))
    for (const alt of e.impl?.alternatives ?? []) forkNames.add(String(alt))
  }
  const scopeDirs = (reg.outOfScope ?? []).filter((p) => String(p).endsWith('/')).map((p) => String(p).replace(/^\.\//, ''))
  for (const p of (reg.outOfScope ?? []).filter((x) => !String(x).endsWith('/'))) {
    mentioned.add(String(p).replace(/^\.\//, ''))
  }

  const looksLikeComponent = (abs) => {
    const s = srcOf.get(abs) ?? ''
    return /export\s+(default\s+)?(function|const)\s+[A-Z]/.test(s) || /export\s*\{[^}]*[A-Z]/.test(s)
  }
  // Файл, экспортирующий названный форк, тоже учтён: он попал в реестр через impl.alternatives.
  const isNamedFork = (abs) => {
    const s = srcOf.get(abs) ?? ''
    return [...forkNames].some((n) =>
      new RegExp(`export\\s+(default\\s+)?(function|const|class)\\s+${escapeRe(n)}\\b|export\\s*\\{[^}]*\\b${escapeRe(n)}\\b`).test(s))
  }
  const missed = componentFiles
    .filter(looksLikeComponent)
    .filter((abs) => !isNamedFork(abs))
    .map((f) => relative(root, f).replace(/\\/g, '/'))
    .filter((rel) => !scopeDirs.some((d) => rel.startsWith(d)))
    .filter((rel) => ![...mentioned].some((m) => rel.endsWith(m) || m.endsWith(rel)))

  if (missed.length) {
    fail(
      `не учтено файлов компонентов: ${missed.length}. Каждый должен попасть в запись реестра ` +
      `(impl.source) либо в outOfScope:\n      ` + missed.slice(0, 12).join('\n      ') +
      (missed.length > 12 ? `\n      … и ещё ${missed.length - 12}` : '')
    )
  }
}

/* ------------------------------------------------------------------ *
 * 4. Стык с предыдущим шагом
 * ------------------------------------------------------------------ */

function checkTokens(entries, tokensPath) {
  if (!existsSync(tokensPath)) {
    console.error(`Предусловие не выполнено: нет ${tokensPath}.`)
    console.error('')
    console.error('Реестр опирается на токены: компоненты красятся от семантических ролей,')
    console.error('а не от сырых значений. Сначала вызовите скилл design-system:tokens —')
    console.error('он выпустит design-system/tokens.json, и тогда возвращайтесь сюда.')
    process.exit(1)
  }
  let tokens
  try {
    tokens = JSON.parse(readFileSync(tokensPath, 'utf8'))
  } catch (e) {
    fail(`${tokensPath} не читается как json: ${e.message}`)
    return
  }
  const roles = tokens && typeof tokens.semantic === 'object' && tokens.semantic
    ? new Set(Object.keys(tokens.semantic))
    : null
  if (!roles) {
    console.warn(`Предупреждение: в ${tokensPath} нет раздела semantic — роли из tokensUsed не сверялись.`)
    return
  }
  for (const e of entries) {
    for (const t of e.tokensUsed ?? []) {
      if (!roles.has(t)) {
        fail(`entries (${e.id}): tokensUsed → «${t}» — такой семантической роли в tokens.json нет`)
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * Вход
 * ------------------------------------------------------------------ */

const regPath = process.argv[2]
const projectRoot = process.argv[3]
if (!regPath || !projectRoot) {
  console.error('Использование: node check-registry.mjs <путь к registry.json> <корень проекта> [путь к tokens.json]')
  console.error('')
  console.error('Корень проекта обязателен. Без него проверяется только внутренняя согласованность,')
  console.error('а реестр, сходящийся сам с собой и не имеющий отношения к коду, реестром не является:')
  console.error('ссылка на файл и число выглядят одинаково достоверно независимо от того, измерены они или сочинены.')
  process.exit(1)
}
const tokensPath = process.argv[4] || join(dirname(regPath), 'tokens.json')

let reg
try {
  reg = JSON.parse(readFileSync(regPath, 'utf8'))
} catch (e) {
  console.error(`Не читается ${regPath}: ${e.message}`)
  process.exit(1)
}

const entries = entriesOf(reg)

checkTokens(entries, tokensPath)
checkSchema(entries)
checkCatalog(entries)
checkAgainstCode(entries, projectRoot)

if (problems.length) {
  console.error(`Реестр не прошёл проверку — ${problems.length} замечаний:\n`)
  for (const p of problems) console.error(`  • ${p}`)
  console.error('\nПока эти пункты не закрыты, шаг не завершён: витрина и внедрение прочитают этот же файл.')
  process.exit(1)
}

const htmlPath = join(dirname(regPath), 'registry.html')
writeFileSync(htmlPath, renderRegistryHtml(reg), 'utf8')
console.log(`Проверка пройдена. Просмотр реестра пересобран: ${htmlPath}`)
console.log('Покажите пользователю именно этот файл — реестр не читают в исходнике.')
