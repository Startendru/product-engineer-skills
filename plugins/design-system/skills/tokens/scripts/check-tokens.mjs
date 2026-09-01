#!/usr/bin/env node
/**
 * Проверка tokens.json и генерация читаемого tokens.md.
 *
 * Скрипт существует потому, что подбор цветов проваливается не небрежностью, а
 * уверенно сформулированной выдумкой. На отладке набора агент выдал отчёт с чёткой
 * структурой и таблицей уровней WCAG, в котором: один коэффициент был назван неверно
 * (2.36 вместо 2.55), среди «проверенных существующих цветов палитры» стоял токен,
 * которого в проекте нет, а предложенная починка схлопывала две семантические роли
 * в один цвет. Отличить это чтением невозможно: выдуманное число и измеренное
 * выглядят одинаково достоверно.
 *
 * Поэтому скрипт ничего не принимает на веру:
 *   1. пересчитывает каждую пару матрицы из hex-значений;
 *   2. проверяет, что каждая ссылка ведёт в существующую запись;
 *   3. ловит две роли, указывающие на одно значение без пометки о слиянии;
 *   4. сверяет примитивы и поверхности с кодом проекта, а не только с самим артефактом.
 *
 * Использование:
 *   node check-tokens.mjs design-system/tokens.json <корень проекта>
 *
 * Код возврата 0 — прошло, tokens.md перезаписан рядом.
 * Код возврата 1 — не прошло, причины напечатаны.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, extname } from 'node:path'

const problems = []
const fail = (m) => problems.push(m)

/* ------------------------------------------------------------------ *
 * Контраст по WCAG 2.1. Одна реализация на весь скрипт: заявленные
 * коэффициенты сверяются именно с ней.
 * ------------------------------------------------------------------ */

const HEX6 = /^#[0-9a-fA-F]{6}$/

/** `#abc` → `#aabbcc`, регистр приводится к нижнему. Прочее возвращается как есть. */
function normHex(v) {
  if (typeof v !== 'string') return null
  const s = v.trim().toLowerCase()
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]
  return HEX6.test(s) ? s : null
}

const channel = (c) => {
  const x = c / 255
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

/** Коэффициент контраста двух цветов. Порядок аргументов не важен. */
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Нормы WCAG 2.1 по назначению роли. */
const NORM = {
  bodyText: 4.5,   // SC 1.4.3, обычный текст
  largeText: 3,    // SC 1.4.3, от 18.66px жирный или 24px обычный
  nonText: 3,      // SC 1.4.11, границы, иконки, индикатор фокуса
  surface: null,   // роль-фон: сама ничего не должна проходить
}
const USES = Object.keys(NORM)
/** Роли переднего плана — те, у которых обязана быть строка на каждую поверхность. */
const FOREGROUND = USES.filter((u) => NORM[u] !== null)

/* ------------------------------------------------------------------ *
 * Проверка 0. Схема и типы.
 * ------------------------------------------------------------------ */

function checkShape(t) {
  if (!t.primitives || typeof t.primitives !== 'object' || Array.isArray(t.primitives)) {
    fail('primitives: нет объекта «имя → значение». Ярус примитивов пуст — красить не от чего')
    return
  }
  for (const [name, p] of Object.entries(t.primitives)) {
    const w = `primitives.${name}`
    if (!p || typeof p !== 'object') { fail(`${w}: запись должна быть объектом с $value`); continue }
    if (!normHex(p.$value)) fail(`${w}: $value = ${JSON.stringify(p.$value)} — нужен hex вида #rrggbb`)
    if (p.$type !== 'color') fail(`${w}: $type должен быть "color"`)
    if (p.origin !== 'existing' && p.origin !== 'new') {
      fail(`${w}: origin должен быть "existing" (цвет уже есть в проекте) или "new" (вводится этим шагом). ` +
           `Без этого поля нельзя проверить, существует ли цвет на самом деле`)
    }
  }

  if (!t.semantic || typeof t.semantic !== 'object' || Array.isArray(t.semantic)) {
    fail('semantic: нет объекта «роль → { ref, purpose, use }». Ярус семантики — то, от чего красятся компоненты')
    return
  }
  if (Object.keys(t.semantic).length === 0) fail('semantic: пусто. Хотя бы одна роль в интерфейсе есть всегда')
  for (const [role, s] of Object.entries(t.semantic)) {
    const w = `semantic.${role}`
    if (!s || typeof s !== 'object') { fail(`${w}: запись должна быть объектом`); continue }
    if (typeof s.ref !== 'string' || !s.ref) fail(`${w}: нет ref — имени примитива, от которого роль берёт цвет`)
    if (typeof s.purpose !== 'string' || s.purpose.trim().length < 3) {
      fail(`${w}: нет purpose — что именно этой ролью красят`)
    }
    if (!USES.includes(s.use)) {
      fail(`${w}: use = ${JSON.stringify(s.use)}. Допустимо: ${USES.join(', ')}. ` +
           `От назначения зависит норма контраста, поэтому его нельзя не указать`)
    }
    if (!Number.isInteger(s.usages) || s.usages < 0) {
      fail(`${w}: usages не целое число. Роли выводятся из фактического употребления — сколько мест её просят?`)
    }
    if (FOREGROUND.includes(s.use) && s.onSurfaces !== 'all' && !Array.isArray(s.onSurfaces)) {
      fail(`${w}: нет onSurfaces. Поставьте "all", если роль встречается на всех поверхностях продукта, ` +
           `либо перечислите поверхности, на которых она бывает, и объясните ограничение в restrictedWhy`)
    }
  }

  if (t.component && (typeof t.component !== 'object' || Array.isArray(t.component))) {
    fail('component: должен быть объектом «компонент.свойство → роль» либо отсутствовать')
  }

  if (!Array.isArray(t.surfaces) || t.surfaces.length === 0) {
    fail('surfaces: пусто. Хотя бы одна поверхность с текстом в продукте есть всегда')
  } else {
    for (const [i, s] of t.surfaces.entries()) {
      const w = `surfaces[${i}]${s && s.color ? ` (${s.color})` : ''}`
      if (!normHex(s && s.color)) fail(`${w}: color не hex вида #rrggbb`)
      if (!Number.isInteger(s?.textNodes) || s.textNodes < 0) fail(`${w}: textNodes не целое число`)
      if (s?.origin !== 'existing' && s?.origin !== 'new') {
        fail(`${w}: origin должен быть "existing" (поверхность найдена инвентаризацией) или "new" (вводится этим шагом)`)
      }
    }
  }

  if (!Array.isArray(t.matrix)) fail('matrix: нет массива пар «роль × поверхность». Это сердце артефакта')
  if (typeof t.greenfield !== 'boolean') {
    fail('greenfield: нет булева поля. Проект с нуля (true) или уже есть интерфейс (false)?')
  }
}

/* ------------------------------------------------------------------ *
 * Проверка 2 (по базовым линиям). Ссылки ведут в существующие записи.
 * Ловит выдуманный токен: «rd-ink-soft-darker» среди проверенных цветов палитры.
 * ------------------------------------------------------------------ */

function checkReferences(t) {
  const prims = t.primitives ?? {}
  const roles = t.semantic ?? {}

  for (const [role, s] of Object.entries(roles)) {
    if (typeof s?.ref !== 'string') continue
    if (!(s.ref in prims)) {
      const near = Object.keys(prims).filter((p) => p.startsWith(s.ref.slice(0, 4)))
      fail(`semantic.${role}: ref → «${s.ref}», но такого примитива нет.` +
           (near.length ? ` Похожие есть: ${near.join(', ')}` : ' Ни одного похожего имени в primitives тоже нет'))
    }
  }

  // компоненты красятся от семантики, никогда напрямую от примитива —
  // это правило проверяется здесь, а не остаётся пожеланием в прозе
  for (const [key, val] of Object.entries(t.component ?? {})) {
    if (typeof val !== 'string') { fail(`component.${key}: значение должно быть именем семантической роли`); continue }
    if (val in roles) continue
    if (val in prims) {
      fail(`component.${key} → «${val}»: это примитив, а не семантическая роль. ` +
           `Компоненты красятся от семантики: иначе смена смысла требует правки каждого компонента`)
    } else {
      fail(`component.${key} → «${val}»: такой семантической роли нет`)
    }
  }
}

/* ------------------------------------------------------------------ *
 * Проверка 3 (по базовым линиям). Две роли — не один цвет.
 * Ловит схлопывание семантики: «заменить rd-muted на #54545a», где #54545a —
 * значение уже существующей роли rd-ink-soft. Ярус семантики уничтожается
 * ровно в тот момент, когда его чинят.
 * ------------------------------------------------------------------ */

function checkRoleCollapse(t) {
  const prims = t.primitives ?? {}
  const roles = Object.entries(t.semantic ?? {})
  const byValue = new Map()

  // Сравниваем роли внутри одной группы: две роли переднего плана одним цветом —
  // это схлопнутая семантика. Совпадение переднего плана с фоном — не про семантику,
  // а про контраст, и его ловит матрица (кольцо, ставшее цветом заливки кнопки, даёт 1.00).
  for (const [role, s] of roles) {
    const hex = normHex(prims[s?.ref]?.$value)
    if (!hex) continue
    const key = `${s?.use === 'surface' ? 'surface' : 'fg'}|${hex}`
    if (!byValue.has(key)) byValue.set(key, [])
    byValue.get(key).push(role)
  }

  for (const [key, list] of byValue) {
    if (list.length < 2) continue
    const hex = key.split('|')[1]
    // Достаточно одной явной пометки на группу: слияние объявлено, значит оно намеренное.
    const declared = list.some((role) => {
      const merged = t.semantic[role].mergedWith
      return typeof merged === 'string' && list.includes(merged) && merged !== role
    })
    if (!declared) {
      fail(`semantic: роли ${list.map((r) => `«${r}»`).join(', ')} указывают на одно значение ${hex}. ` +
           `Две роли одним цветом — это ярус семантики, свёрнутый обратно в палитру: смысл, ради которого ` +
           `роли и заводили, исчезает ровно в момент починки. Разведите цвета либо пометьте слияние ` +
           `намеренным: "mergedWith": "${list[0]}" у одной из них`)
    }
  }
}

/* ------------------------------------------------------------------ *
 * Проверка 1 (по базовым линиям). Матрица пересчитывается.
 * Ловит заявленный коэффициент, разошедшийся с вычисленным: остальные числа
 * в том отчёте сошлись, поэтому неверное выглядело таким же достоверным.
 * ------------------------------------------------------------------ */

function checkMatrix(t) {
  const prims = t.primitives ?? {}
  const roles = t.semantic ?? {}
  const surfaces = (t.surfaces ?? []).map((s) => normHex(s?.color)).filter(Boolean)
  const seen = new Set()

  for (const [i, m] of (t.matrix ?? []).entries()) {
    const w = `matrix[${i}] (${m?.role} × ${m?.surface})`
    const role = roles[m?.role]
    if (!role) { fail(`${w}: роли «${m?.role}» нет в semantic`); continue }
    const fg = normHex(prims[role.ref]?.$value)
    const bg = normHex(m?.surface)
    if (!fg) { fail(`${w}: у роли не разрешается цвет — ref «${role.ref}» не даёт hex`); continue }
    if (!bg) { fail(`${w}: surface не hex вида #rrggbb`); continue }
    if (surfaces.length && !surfaces.includes(bg)) {
      fail(`${w}: поверхности ${bg} нет в списке surfaces. Матрица строится по поверхностям продукта, а не по произвольным фонам`)
    }
    seen.add(`${m.role}|${bg}`)

    // пересчёт коэффициента
    const actual = contrast(fg, bg)
    if (typeof m.ratio !== 'number') {
      fail(`${w}: ratio не число. Посчитанный коэффициент — ${actual.toFixed(2)}`)
    } else if (Math.abs(m.ratio - actual) >= 0.05) {
      fail(`${w}: заявлен контраст ${m.ratio}, пересчёт по ${fg} на ${bg} даёт ${actual.toFixed(2)}`)
    }

    // пересчёт нормы: она следует из назначения роли, а не выбирается по вкусу
    const required = NORM[role.use]
    if (required === null) {
      fail(`${w}: роль помечена как поверхность (use: surface) — она не участвует в матрице как передний план`)
      continue
    }
    if (m.required !== required) {
      fail(`${w}: заявлена норма ${m.required}, для назначения «${role.use}» норма ${required} ` +
           `(${role.use === 'bodyText' ? 'SC 1.4.3, обычный текст' : role.use === 'largeText' ? 'SC 1.4.3, крупный текст' : 'SC 1.4.11, нетекстовый элемент'})`)
    }

    // пересчёт вердикта
    const verdict = actual >= required - 0.005 ? 'pass' : 'fail'
    if (m.verdict !== verdict) {
      fail(`${w}: заявлен вердикт «${m.verdict}», при контрасте ${actual.toFixed(2)} и норме ${required} это «${verdict}»`)
    }
    if (verdict === 'fail') {
      const waiver = typeof m.waiver === 'string' && m.waiver.trim().length >= 5
      if (!waiver) {
        fail(`${w}: пара не проходит норму — ${actual.toFixed(2)} при ${required}. ` +
             `Подберите другой цвет либо запишите причину отсрочки в поле waiver`)
      }
    }
  }

  // полнота: порог берётся по худшей поверхности, значит проверить надо все поверхности,
  // где роль встречается. Сузить набор можно только назвав причину.
  for (const [role, s] of Object.entries(roles)) {
    if (!FOREGROUND.includes(s?.use)) continue
    let expected = surfaces
    if (Array.isArray(s.onSurfaces)) {
      expected = s.onSurfaces.map(normHex).filter(Boolean)
      for (const bg of expected) {
        if (!surfaces.includes(bg)) fail(`semantic.${role}: onSurfaces содержит ${bg}, а такой поверхности в surfaces нет`)
      }
      if (expected.length < surfaces.length) {
        const why = s.restrictedWhy
        if (typeof why !== 'string' || why.trim().length < 10) {
          const missing = surfaces.filter((x) => !expected.includes(x))
          fail(`semantic.${role}: роль проверяется не на всех поверхностях — пропущены ${missing.join(', ')}. ` +
               `Так можно, только если роль там физически не встречается: напишите это в restrictedWhy. ` +
               `«Проверю на типовой, остальные похожи» — ровно тот способ пропустить худшую поверхность`)
        }
      }
    }
    for (const bg of expected) {
      if (!seen.has(`${role}|${bg}`)) {
        fail(`matrix: нет пары «${role} × ${bg}». Порог берётся по худшей поверхности, ` +
             `поэтому каждая роль проверяется на каждой поверхности, где она бывает`)
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * Сверка с кодом.
 *
 * Валидатор внутренней согласованности бесполезен против уверенно неверных
 * данных: артефакт сходится сам с собой и не имеет отношения к проекту.
 * Так уже случилось на соседнем скилле, поэтому корень проекта обязателен.
 * ------------------------------------------------------------------ */

const CODE_EXT = new Set(['.css', '.scss', '.ts', '.tsx', '.js', '.jsx', '.json'])
const SKIP_DIR = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'out', 'coverage', 'design-system'])

function collectSources(root) {
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
      else if (CODE_EXT.has(extname(name))) {
        try { out.push(readFileSync(full, 'utf8')) } catch { /* нечитаемый файл пропускаем */ }
      }
    }
  }
  walk(root)
  return out
}

/** Ищет объявление токена вида `--color-rd-muted: #95949a;` или `rd-muted: '#95949a'`. */
function findDeclaration(sources, name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(?:--(?:[\\w-]+-)?|["'\`]?)${esc}["'\`]?\\s*:\\s*([^;,}\\n]+)`, 'i')
  for (const src of sources) {
    const m = re.exec(src)
    if (m) return m[1].trim().replace(/["'\`]/g, '')
  }
  return null
}

function checkAgainstCode(t, root) {
  const sources = collectSources(root)
  if (sources.length === 0) {
    fail(`В ${root} не найдено файлов проекта. Верный ли путь к корню?`)
    return
  }

  // 1. Примитивы, заявленные как существующие, обязаны найтись в коде с тем же значением.
  for (const [name, p] of Object.entries(t.primitives ?? {})) {
    const declared = findDeclaration(sources, name)
    if (p?.origin === 'existing') {
      if (declared === null) {
        fail(`primitives.${name}: помечен origin "existing", но объявления в коде проекта нет. ` +
             `Либо это выдуманный токен, либо он новый — тогда origin "new"`)
        continue
      }
      const inCode = normHex((declared.match(/#[0-9a-fA-F]{3,6}/) || [])[0])
      const inArt = normHex(p.$value)
      if (inCode && inArt && inCode !== inArt) {
        fail(`primitives.${name}: в артефакте ${inArt}, в коде проекта объявлено ${inCode}`)
      }
    } else if (p?.origin === 'new' && declared !== null) {
      fail(`primitives.${name}: помечен origin "new", но такое имя в проекте уже занято (${declared}). ` +
           `Возьмите другое имя либо признайте его существующим`)
    }
  }

  // 2. Роли выводятся из фактического употребления: у каждой должен быть реальный след в коде.
  if (t.greenfield === false) {
    for (const [role, s] of Object.entries(t.semantic ?? {})) {
      const ev = s?.evidence
      if (typeof ev !== 'string' || !ev.trim()) {
        fail(`semantic.${role}: нет evidence — файла проекта, где эта роль сейчас употребляется. ` +
             `Роли выводятся из употребления, а не придумываются`)
        continue
      }
      const [file, line] = ev.split(':')
      const abs = join(root, file)
      if (!existsSync(abs)) {
        fail(`semantic.${role}: evidence указывает на «${file}», такого файла в проекте нет`)
        continue
      }
      if (line !== undefined && /^\d+$/.test(line)) {
        let count = 0
        try { count = readFileSync(abs, 'utf8').split('\n').length } catch { count = 0 }
        if (Number(line) > count) {
          fail(`semantic.${role}: evidence указывает на строку ${line}, а в «${file}» строк ${count}`)
        }
      }
    }
  }

  // 3. Поверхности сверяются с инвентарём — их не выбирают, их меряют.
  const invPath = join(root, 'design-system', 'inventory.json')
  if (!existsSync(invPath)) {
    if (t.greenfield !== true) {
      fail(`инвентарь не найден: ${invPath}. Вызовите design-system:inventory — поверхности берутся из замера, ` +
           `а не из палитры. Если проект действительно с нуля, поставьте "greenfield": true`)
    }
    return
  }
  let inv
  try { inv = JSON.parse(readFileSync(invPath, 'utf8')) } catch (e) {
    fail(`inventory.json не читается: ${e.message}`)
    return
  }
  const invSurfaces = new Map()
  for (const s of inv.surfaces ?? []) {
    const hex = normHex(s?.color)
    if (hex) invSurfaces.set(hex, s)
  }
  const own = new Map()
  for (const s of t.surfaces ?? []) {
    const hex = normHex(s?.color)
    if (hex) own.set(hex, s)
  }

  for (const [hex, s] of invSurfaces) {
    if ((s.textNodes ?? 0) > 0 && !own.has(hex)) {
      fail(`поверхность ${hex} есть в инвентаре (${s.textNodes} текстовых узлов), но пропущена в surfaces. ` +
           `Редкая поверхность — тоже поверхность: именно на ней порог и проваливается`)
    }
  }
  for (const [hex, s] of own) {
    if (!invSurfaces.has(hex) && s.origin !== 'new') {
      fail(`поверхность ${hex} помечена как существующая, но в инвентаре её нет. ` +
           `Если она вводится этим шагом — origin "new"; если взята из палитры, а не из замера, — это не поверхность продукта`)
    }
  }
}

/* ------------------------------------------------------------------ *
 * Читаемый вид. Артефакт — данные; человек смотрит на них отсюда.
 * ------------------------------------------------------------------ */

function renderMd(t) {
  const prims = t.primitives ?? {}
  const L = []
  L.push('# Токены дизайн-системы', '')
  L.push('Сгенерировано из `tokens.json`. Руками не править — правьте json и перезапустите проверку.', '')

  L.push('## Примитивы — сырые значения', '')
  L.push('| Имя | Значение | Откуда |', '| --- | --- | --- |')
  for (const [n, p] of Object.entries(prims)) {
    L.push(`| \`${n}\` | \`${p.$value}\` | ${p.origin === 'existing' ? 'уже в проекте' : 'вводится'} |`)
  }
  L.push('')

  L.push('## Семантика — что этим красят', '')
  L.push('| Роль | Примитив | Значение | Назначение | Норма | Мест |', '| --- | --- | --- | --- | ---: | ---: |')
  for (const [r, s] of Object.entries(t.semantic ?? {})) {
    const v = prims[s.ref]?.$value ?? '—'
    const norm = NORM[s.use] ?? '—'
    L.push(`| \`${r}\` | \`${s.ref}\` | \`${v}\` | ${s.purpose} | ${norm} | ${s.usages ?? '—'} |`)
  }
  L.push('')

  const restricted = Object.entries(t.semantic ?? {}).filter(([, s]) => Array.isArray(s.onSurfaces) && s.restrictedWhy)
  if (restricted.length) {
    L.push('### Роли, проверенные не на всех поверхностях', '')
    L.push('| Роль | Где бывает | Почему только там |', '| --- | --- | --- |')
    for (const [r, s] of restricted) L.push(`| \`${r}\` | ${s.onSurfaces.join(', ')} | ${s.restrictedWhy} |`)
    L.push('')
  }

  const comp = Object.entries(t.component ?? {})
  L.push('## Компонентный ярус', '')
  if (comp.length) {
    L.push('| Компонент и свойство | Роль |', '| --- | --- |')
    for (const [k, v] of comp) L.push(`| \`${k}\` | \`${v}\` |`)
  } else {
    L.push('Пуст: компоненты красятся напрямую от семантики. Это нормально, пока нет исключений.')
  }
  L.push('')

  L.push('## Поверхности продукта', '')
  L.push('| Фон | Имя | Текстовых узлов | Откуда |', '| --- | --- | ---: | --- |')
  for (const s of t.surfaces ?? []) {
    L.push(`| \`${s.color}\` | ${s.name ?? '—'} | ${s.textNodes} | ${s.origin === 'existing' ? 'из инвентаря' : 'вводится'} |`)
  }
  L.push('')

  L.push('## Матрица «роль × поверхность»', '')
  L.push('Порог берётся по худшей поверхности: роль считается принятой, только если проходит везде.', '')
  const roles = [...new Set((t.matrix ?? []).map((m) => m.role))]
  const surfs = (t.surfaces ?? []).map((s) => normHex(s.color)).filter(Boolean)
  L.push(`| Роль | ${surfs.map((s) => `\`${s}\``).join(' | ')} | Норма | Худшая |`)
  L.push(`| --- | ${surfs.map(() => '---:').join(' | ')} | ---: | ---: |`)
  for (const r of roles) {
    const rows = (t.matrix ?? []).filter((m) => m.role === r)
    const cells = surfs.map((s) => {
      const m = rows.find((x) => normHex(x.surface) === s)
      if (!m) return '—'
      return `${Number(m.ratio).toFixed(2)}${m.verdict === 'pass' ? '' : ' ✗'}`
    })
    const worst = rows.reduce((a, b) => (a === null || b.ratio < a.ratio ? b : a), null)
    L.push(`| \`${r}\` | ${cells.join(' | ')} | ${rows[0]?.required ?? '—'} | ${worst ? Number(worst.ratio).toFixed(2) : '—'} |`)
  }
  L.push('')

  const waived = (t.matrix ?? []).filter((m) => m.verdict === 'fail' && m.waiver)
  if (waived.length) {
    L.push('## Принятые отсрочки', '')
    L.push('Эти пары норму не проходят, и это записано осознанно.', '')
    L.push('| Пара | Контраст | Норма | Причина |', '| --- | ---: | ---: | --- |')
    for (const m of waived) L.push(`| \`${m.role}\` × \`${m.surface}\` | ${m.ratio} | ${m.required} | ${m.waiver} |`)
    L.push('')
  }
  return L.join('\n')
}

// --- вход
const path = process.argv[2]
const projectRoot = process.argv[3]
if (!path || !projectRoot) {
  console.error('Использование: node check-tokens.mjs <путь к tokens.json> <корень проекта>')
  console.error('')
  console.error('Корень проекта обязателен: без него проверяется только внутренняя согласованность,')
  console.error('а набор токенов, сходящийся сам с собой и не имеющий отношения к коду, — не набор токенов.')
  process.exit(1)
}

let tokens
try {
  tokens = JSON.parse(readFileSync(path, 'utf8'))
} catch (e) {
  console.error(`Не читается ${path}: ${e.message}`)
  process.exit(1)
}

checkShape(tokens)
checkReferences(tokens)
checkRoleCollapse(tokens)
checkMatrix(tokens)
checkAgainstCode(tokens, projectRoot)

if (problems.length) {
  console.error(`Токены не прошли проверку — ${problems.length} замечаний:\n`)
  for (const p of problems) console.error(`  • ${p}`)
  console.error('\nПока эти пункты не закрыты, шаг не завершён: реестр покрасит компоненты от этих же значений.')
  process.exit(1)
}

const mdPath = join(dirname(path), 'tokens.md')
writeFileSync(mdPath, renderMd(tokens), 'utf8')
console.log(`Проверка пройдена. Читаемый вид записан: ${mdPath}`)
