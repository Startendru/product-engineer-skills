#!/usr/bin/env node
/**
 * Проверка inventory.json и генерация читаемого inventory.md.
 *
 * Скрипт существует потому, что инвентаризация проваливается предсказуемо: агент
 * пересказывает объявленное вместо подсчёта используемого, и отчёт без единого числа
 * выглядит убедительно. Читать такой отчёт глазами бесполезно — числа и их отсутствие
 * замечаются только машиной.
 *
 * Использование:
 *   node check-inventory.mjs design-system/inventory.json
 *
 * Код возврата 0 — прошло, inventory.md перезаписан рядом.
 * Код возврата 1 — не прошло, причины напечатаны.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, basename, extname } from 'node:path'

const problems = []
const fail = (m) => problems.push(m)

/** Целое число ≥ 0 и не `null`. Строку «много» и пропущенное поле отвергаем. */
const isCount = (v) => Number.isInteger(v) && v >= 0

function checkNumbersEverywhere(inv) {
  // --- контролы: главный предмет инвентаризации
  if (!Array.isArray(inv.controls) || inv.controls.length === 0) {
    fail('controls: пусто. Не найдено ни одной роли контролов — считать нечего?')
  } else {
    for (const [i, role] of inv.controls.entries()) {
      const where = `controls[${i}]${role.role ? ` (${role.role})` : ''}`
      if (!role.role) fail(`${where}: нет поля role`)
      if (!Array.isArray(role.implementations) || role.implementations.length === 0) {
        fail(`${where}: нет ни одной реализации. Даже если она одна, её надо назвать`)
        continue
      }
      let sum = 0
      for (const [j, impl] of role.implementations.entries()) {
        const w = `${where}.implementations[${j}]${impl.name ? ` (${impl.name})` : ''}`
        if (!impl.name) fail(`${w}: нет поля name`)
        if (!isCount(impl.usages)) fail(`${w}: usages не целое число. Сколько раз это вызывается?`)
        else sum += impl.usages
        if (!isCount(impl.files)) fail(`${w}: files не целое число`)
      }
      // пересчёт: заявленную сумму не принимаем на веру
      if (!isCount(role.totalUsages)) {
        fail(`${where}: totalUsages не целое число`)
      } else if (role.totalUsages !== sum) {
        fail(`${where}: totalUsages = ${role.totalUsages}, а сумма по реализациям = ${sum}`)
      }
      // сырая вёрстка — тоже реализация; её отсутствие почти всегда значит, что её не искали
      const hasRaw = role.implementations.some((x) => /raw|сыр|native|нативн/i.test(x.name || ''))
      if (!hasRaw) {
        fail(`${where}: нет реализации «сырая вёрстка». Если её правда нет — впишите с usages: 0`)
      }
    }
  }

  // --- мёртвые компоненты: шаг, который пропускают чаще всего
  if (!Array.isArray(inv.deadComponents)) {
    fail('deadComponents: поля нет. Если мёртвых компонентов не нашлось — поставьте пустой массив')
  } else {
    for (const [i, d] of inv.deadComponents.entries()) {
      if (!d.source) fail(`deadComponents[${i}]: нет source`)
      if (d.imports !== 0) fail(`deadComponents[${i}]: imports = ${d.imports}. Мёртвый компонент — это ровно ноль импортов`)
    }
  }

  // --- поверхности
  if (!Array.isArray(inv.surfaces) || inv.surfaces.length === 0) {
    fail('surfaces: пусто. Хотя бы одна поверхность с текстом в интерфейсе есть всегда')
  } else {
    for (const [i, s] of inv.surfaces.entries()) {
      const w = `surfaces[${i}]${s.color ? ` (${s.color})` : ''}`
      if (!/^#[0-9a-fA-F]{6}$/.test(s.color || '')) fail(`${w}: color не hex вида #rrggbb`)
      if (!isCount(s.textNodes)) fail(`${w}: textNodes не целое число. Сколько текстовых узлов на этом фоне?`)
      if (!isCount(s.screens)) fail(`${w}: screens не целое число`)
      if (!isCount(s.contrastFailures)) fail(`${w}: contrastFailures не целое число`)
    }
  }

  // --- шкала кеглей: пересчёт заявленного
  const ts = inv.typeScale
  if (!ts || !Array.isArray(ts.declared)) {
    fail('typeScale.declared: нет массива размеров')
  } else {
    for (const [i, d] of ts.declared.entries()) {
      if (typeof d.px !== 'number') fail(`typeScale.declared[${i}]: px не число`)
      if (!isCount(d.occurrences)) fail(`typeScale.declared[${i}]: occurrences не целое число`)
    }
    if (!isCount(ts.distinctSizes)) fail('typeScale.distinctSizes не целое число')
    else if (ts.distinctSizes !== ts.declared.length) {
      fail(`typeScale.distinctSizes = ${ts.distinctSizes}, а размеров перечислено ${ts.declared.length}`)
    }
    if (!isCount(ts.scaleTokenUsages)) fail('typeScale.scaleTokenUsages не целое число')
  }

  // --- токены
  if (!Array.isArray(inv.tokens) || inv.tokens.length === 0) {
    fail('tokens: пусто. Палитра проекта где-то объявлена — перечислите её')
  } else {
    for (const [i, t] of inv.tokens.entries()) {
      if (!t.name) fail(`tokens[${i}]: нет name`)
      if (!isCount(t.usages)) fail(`tokens[${i}] (${t.name}): usages не целое число`)
    }
  }

  // --- структура страниц
  if (!Array.isArray(inv.pageStructure) || inv.pageStructure.length === 0) {
    fail('pageStructure: пусто. Нужен хотя бы один осмотренный экран')
  } else {
    for (const [i, p] of inv.pageStructure.entries()) {
      const w = `pageStructure[${i}]${p.url ? ` (${p.url})` : ''}`
      if (!p.url) fail(`${w}: нет url`)
      if (!isCount(p.mainLandmarks)) fail(`${w}: mainLandmarks не целое число`)
      if (!isCount(p.h1)) fail(`${w}: h1 не целое число`)
      if (!isCount(p.headings)) fail(`${w}: headings не целое число`)
    }
  }

  // --- честность про браузер: пропуск замера допустим, но только объявленный
  if (typeof inv.measuredInBrowser !== 'boolean') {
    fail('measuredInBrowser: нет булева поля. Замеры в браузере делались или нет?')
  } else if (inv.measuredInBrowser === false) {
    if (!Array.isArray(inv.notMeasured) || inv.notMeasured.length === 0) {
      fail('measuredInBrowser: false, но notMeasured пуст. Перечислите, что осталось непроверенным')
    }
  }
}

/* ------------------------------------------------------------------ *
 * Сверка с кодом.
 *
 * Проверка внутренней согласованности пропускает артефакт, который сходится
 * сам с собой и не имеет отношения к проекту. Так и случилось на отладке:
 * инвентарь прошёл все проверки, при этом самая массовая реализация кнопки
 * в нём отсутствовала, а два мёртвых компонента были объявлены живыми.
 *
 * Поэтому числа не принимаются на веру — они пересчитываются по исходникам.
 * ------------------------------------------------------------------ */

const CODE_EXT = new Set(['.tsx', '.jsx', '.ts', '.js'])
const SKIP_DIR = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'out', 'coverage', 'tests', '__tests__', 'e2e'])
/** Тест — не употребление: вызов из теста не значит, что компонентом пользуются в продукте. */
const isTestFile = (p) => /\.(test|spec|stories)\.[jt]sx?$/.test(p)

/**
 * Роли с нативным эквивалентом. Только для них «сырая вёрстка» считается по тегу.
 * У карточки или алерта нативного тега нет: считать их по `<div>` бессмысленно —
 * в проекте сотни div, и ни один из них не «сырая карточка».
 */
const NATIVE_TAGS = new Set(['button', 'input', 'select', 'textarea', 'label', 'a', 'form', 'table', 'dialog'])

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

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Считает открывающие теги: `<Name` со следующим пробелом, `>` или `/`. */
function countTag(sources, tag) {
  const re = new RegExp(`<${escapeRe(tag)}(?=[\\s>/])`, 'g')
  let n = 0
  for (const src of sources) n += (src.match(re) || []).length
  return n
}

/** Из имени реализации достаёт тег: `raw <button>` → button, `RegisterButton` → RegisterButton. */
function tagOf(name) {
  const raw = /<\s*([a-zA-Z][\w-]*)\s*>/.exec(name || '')
  if (raw) return raw[1]
  return /^[A-Za-z][\w.]*$/.test(name || '') ? name : null
}

function checkAgainstCode(inv, root) {
  const files = collectFiles(root)
  if (files.length === 0) {
    fail(`В ${root} не найдено файлов интерфейса. Верный ли путь к проекту?`)
    return
  }
  const sources = files.map((f) => { try { return readFileSync(f, 'utf8') } catch { return '' } })

  // 1. Пересчёт вызовов. Заявленное сверяется с фактическим.
  for (const role of inv.controls ?? []) {
    for (const impl of role.implementations ?? []) {
      const tag = tagOf(impl.name)
      if (!tag) continue
      const isRaw = /<\s*[a-z]/.test(impl.name || '')
      if (isRaw && !NATIVE_TAGS.has(tag)) {
        fail(`controls (${role.role}) → ${impl.name}: «${tag}» не нативный контрол. ` +
             `У этой роли нет нативного эквивалента — назовите реализацию «ручная сборка» и посчитайте её по своему признаку`)
        continue
      }
      const actual = countTag(sources, tag)
      if (actual !== impl.usages) {
        fail(`controls (${role.role}) → ${impl.name}: заявлено ${impl.usages} вызовов, в коде ${actual}`)
      }
    }
  }

  // 2. Все файлы компонентов должны быть учтены.
  //    Иначе параллельная реализация просто не попадает в инвентарь — а именно она
  //    и есть главная находка этого шага.
  const compRoot = (inv.project?.componentsRoot ?? 'components').replace(/^\.\//, '').replace(/\/$/, '')
  const componentFiles = files.filter((f) => {
    const rel = relative(root, f).replace(/\\/g, '/')
    return rel.startsWith(compRoot + '/') && (extname(f) === '.tsx' || extname(f) === '.jsx')
  })
  if (componentFiles.length === 0) {
    fail(`в «${compRoot}/» не найдено файлов компонентов. Укажите верный project.componentsRoot`)
  }
  const mentioned = new Set()
  const note = (p) => { if (p) mentioned.add(String(p).replace(/\\/g, '/').replace(/^\.\//, '')) }
  for (const role of inv.controls ?? []) for (const i of role.implementations ?? []) note(i.source)
  for (const d of inv.deadComponents ?? []) note(d.source)
  // outOfScope принимает и файл, и папку: запись, оканчивающаяся на «/», закрывает всё внутри.
  // Перечислять сорок файлов по одному тедиозно, а признать папку не относящейся к системе — осознанное решение.
  const scopeDirs = (inv.outOfScope ?? []).filter((p) => String(p).endsWith('/')).map((p) => String(p).replace(/^\.\//, ''))
  for (const p of (inv.outOfScope ?? []).filter((x) => !String(x).endsWith('/'))) note(p)

  const unaccounted = componentFiles
    .map((f) => relative(root, f).replace(/\\/g, '/'))
    .filter((rel) => !scopeDirs.some((d) => rel.startsWith(d)))
    .filter((rel) => ![...mentioned].some((m) => rel.endsWith(m) || m.endsWith(rel)))

  // Файл считаем компонентом роли, только если он экспортирует что-то с большой буквы.
  const looksLikeComponent = (rel) => {
    const src = sources[files.indexOf(join(root, rel))] ?? ''
    return /export\s+(default\s+)?(function|const)\s+[A-Z]/.test(src) || /export\s*\{[^}]*[A-Z]/.test(src)
  }
  const missed = unaccounted.filter(looksLikeComponent)
  if (missed.length) {
    fail(
      `не учтено файлов компонентов: ${missed.length}. Каждый должен попасть в implementations, ` +
      `в deadComponents или в outOfScope:\n      ` + missed.slice(0, 12).join('\n      ') +
      (missed.length > 12 ? `\n      … и ещё ${missed.length - 12}` : '')
    )
  }

  // 3. Мёртвые компоненты ищутся, а не объявляются.
  //    Компонент без импортёров, не попавший в deadComponents, — пропущенная находка.
  const declaredDead = new Set((inv.deadComponents ?? []).map((d) => String(d.source).replace(/\\/g, '/')))
  const reallyDead = []
  for (const f of componentFiles) {
    const rel = relative(root, f).replace(/\\/g, '/')
    const stem = basename(f, extname(f))
    if (stem === 'index') continue
    const re = new RegExp(`from\\s+['"][^'"]*${escapeRe(stem)}['"]`)
    const importers = sources.filter((s, i) => files[i] !== f && re.test(s)).length
    if (importers === 0) reallyDead.push(rel)
  }
  const missedDead = reallyDead.filter((rel) => ![...declaredDead].some((d) => rel.endsWith(d) || d.endsWith(rel)))
  if (missedDead.length) {
    fail(
      `компонентов без единого импорта: ${missedDead.length}, но в deadComponents их нет:\n      ` +
      missedDead.slice(0, 12).join('\n      ') +
      (missedDead.length > 12 ? `\n      … и ещё ${missedDead.length - 12}` : '')
    )
  }
}

function renderMd(inv) {
  const L = []
  L.push('# Инвентаризация интерфейса', '')
  L.push('Сгенерировано из `inventory.json`. Руками не править — правьте json и перезапустите проверку.', '')

  L.push('## Системы контролов', '')
  L.push('| Роль | Реализация | Вызовов | Файлов | Доля |', '| --- | --- | ---: | ---: | ---: |')
  for (const role of inv.controls ?? []) {
    for (const impl of role.implementations ?? []) {
      const share = role.totalUsages ? Math.round((impl.usages / role.totalUsages) * 100) : 0
      // имя в кавычках: у сырой вёрстки оно содержит <button>, иначе markdown съест его как тег
      L.push(`| ${role.role} | \`${impl.name}\` | ${impl.usages} | ${impl.files} | ${share}% |`)
    }
    L.push(`| **${role.role} — всего** | | **${role.totalUsages}** | | |`)
  }
  L.push('')

  const dead = inv.deadComponents ?? []
  L.push('## Мёртвые компоненты', '')
  if (dead.length) {
    L.push('| Файл | Импортов |', '| --- | ---: |')
    for (const d of dead) L.push(`| \`${d.source}\` | ${d.imports} |`)
  } else {
    L.push('Не найдено.')
  }
  L.push('')

  L.push('## Поверхности с текстом', '')
  L.push('| Фон | Токен | Текстовых узлов | Экранов | Провалов контраста |', '| --- | --- | ---: | ---: | ---: |')
  for (const s of inv.surfaces ?? []) {
    L.push(`| \`${s.color}\` | ${s.token ?? '—'} | ${s.textNodes} | ${s.screens} | ${s.contrastFailures} |`)
  }
  L.push('')

  const ts = inv.typeScale ?? {}
  L.push('## Шкала кеглей', '')
  L.push(`Различных размеров: **${ts.distinctSizes}**. Обращений к шкале фреймворка: **${ts.scaleTokenUsages}**.`, '')
  L.push('| Кегль | Вхождений |', '| ---: | ---: |')
  for (const d of [...(ts.declared ?? [])].sort((a, b) => b.occurrences - a.occurrences)) {
    L.push(`| ${d.px}px | ${d.occurrences} |`)
  }
  L.push('')

  L.push('## Токены', '')
  L.push('| Токен | Значение | Употреблений |', '| --- | --- | ---: |')
  for (const t of [...(inv.tokens ?? [])].sort((a, b) => b.usages - a.usages)) {
    L.push(`| \`${t.name}\` | ${t.value ?? '—'} | ${t.usages} |`)
  }
  L.push('')

  L.push('## Структура страниц', '')
  L.push('| Экран | Главных лендмарков | h1 | Заголовков |', '| --- | ---: | ---: | ---: |')
  for (const p of inv.pageStructure ?? []) {
    L.push(`| ${p.url} | ${p.mainLandmarks} | ${p.h1} | ${p.headings} |`)
  }
  L.push('')

  if (inv.measuredInBrowser === false) {
    L.push('## Не проверено', '')
    for (const n of inv.notMeasured ?? []) L.push(`- ${n}`)
    L.push('')
  }
  return L.join('\n')
}

// --- вход
const path = process.argv[2]
const projectRoot = process.argv[3]
if (!path || !projectRoot) {
  console.error('Использование: node check-inventory.mjs <путь к inventory.json> <корень проекта>')
  console.error('')
  console.error('Корень проекта обязателен: без него проверяется только внутренняя согласованность,')
  console.error('а инвентарь, сходящийся сам с собой и не имеющий отношения к коду, — не инвентарь.')
  process.exit(1)
}

let inv
try {
  inv = JSON.parse(readFileSync(path, 'utf8'))
} catch (e) {
  console.error(`Не читается ${path}: ${e.message}`)
  process.exit(1)
}

checkNumbersEverywhere(inv)
checkAgainstCode(inv, projectRoot)

if (problems.length) {
  console.error(`Инвентаризация не прошла проверку — ${problems.length} замечаний:\n`)
  for (const p of problems) console.error(`  • ${p}`)
  console.error('\nПока эти пункты не закрыты, шаг не завершён: следующий скилл прочитает ваш json и упрётся в те же дыры.')
  process.exit(1)
}

const mdPath = join(dirname(path), 'inventory.md')
writeFileSync(mdPath, renderMd(inv), 'utf8')
console.log(`Проверка пройдена. Читаемый вид записан: ${mdPath}`)
