#!/usr/bin/env node
/**
 * Заслон дизайн-системы: сверяет код проекта с registry.json и tokens.json.
 *
 * Заслон существует потому, что дизайн-система расползается тихо. Никто не решает
 * «сегодня напишу цвет мимо палитры» — просто в одном месте оказалось быстрее, и через
 * месяц таких мест сорок. Заметить это глазами нельзя: каждое отдельное отступление
 * выглядит безобидно.
 *
 * Шесть правил (по спеке набора):
 *   1 color-literal   цвет взят от примитива/литерала, а не от семантического токена
 *   2 focus-removed   индикатор фокуса снят без видимой замены
 *   3 type-scale      кегль вне шкалы
 *   4 local-override  локальное переопределение стиля контрола вне слоя компонентов
 *   5 contrast        пара «текст × поверхность» ниже нормы
 *   6 page-structure  правила уровня страницы: главные лендмарки и единственность h1
 *
 * САМОПРОВЕРКА. Перед каждым прогоном заслон прогоняет себя на встроенных образцах
 * нарушений — по одному на правило — и на заведомо чистом образце. Если правило
 * перестало срабатывать (удалили, ослабили, опечатались в шаблоне), заслон падает ещё
 * до того, как посмотрит на проект. Это машинная часть правила «заслон, который не
 * видели красным, заслоном не является». Немашинная часть — мутации на живом коде —
 * остаётся за человеком, см. references/guard-checks.md.
 *
 * Использование:
 *   node ds-guard.mjs <корень проекта> [--registry путь] [--tokens путь] [--ci файл]
 *   node ds-guard.mjs --self-test
 *
 * Код возврата: 0 — чисто, 1 — есть нарушения (или самопроверка не прошла).
 *
 * Зависимостей нет. Node 18+.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, extname } from 'node:path'

const RULES = ['color-literal', 'focus-removed', 'type-scale', 'local-override', 'contrast', 'page-structure']
/** Правил ровно столько. Удалили правило — самопроверка это заметит. */
const RULE_COUNT = 6

// ---------------------------------------------------------------- цвет и контраст

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

function normHex(h) {
  if (!h) return null
  let s = String(h).trim().toLowerCase()
  if (!HEX.test(s)) return null
  if (s.length === 4) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]
  return s
}

function luminance(hex) {
  const v = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
}

/** Коэффициент контраста по WCAG 2.1, округление до сотых. */
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100
}

// ---------------------------------------------------------------- чтение проекта

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'coverage', 'out', '.turbo'])

function walk(dir, exts, acc = []) {
  let items
  try { items = readdirSync(dir) } catch { return acc }
  for (const name of items) {
    if (SKIP_DIRS.has(name)) continue
    const p = join(dir, name)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) walk(p, exts, acc)
    else if (exts.has(extname(p))) acc.push(p)
  }
  return acc
}

/**
 * Карта «утилита → hex» из CSS-переменных проекта: `--color-rd-muted: #68686c`
 * даёт `text-rd-muted` и `bg-rd-muted`. Без этой карты заслон не может связать класс
 * в разметке со значением цвета, а значит не может считать контраст.
 */
function readCssColors(cssSources) {
  const map = new Map()
  for (const src of cssSources) {
    for (const m of src.matchAll(/--color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})/g)) {
      const hex = normHex(m[2])
      if (hex) map.set(m[1], hex)
    }
  }
  return map
}

/**
 * Классы, задающие фон градиентом или изображением. Слепое пятно проверки контраста:
 * под таким фоном пару «текст × поверхность» по коду не вычислить, и любая попытка даёт
 * ложное срабатывание. Заслон, краснеющий на здоровом коде, отключают — это хуже, чем
 * его отсутствие.
 */
function readBgImageClasses(cssSources) {
  const set = new Set()
  for (const src of cssSources) {
    for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = m[2]
      if (!/background(-image)?\s*:\s*[^;]*(gradient|url\()/i.test(body)) continue
      for (const c of m[1].matchAll(/\.([a-zA-Z0-9_-]+)/g)) set.add(c[1])
    }
  }
  return set
}

// ---------------------------------------------------------------- разбор разметки

/** Строковые литералы без подстановок — то, из чего состоят наборы классов. */
function stringLiterals(text) {
  const out = []
  for (const m of text.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\$]*)`/g)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '')
  }
  return out
}

/** Значение className целиком: строкой, шаблоном или выражением в фигурных скобках. */
function classNameRegion(attrs) {
  const i = attrs.indexOf('className')
  if (i === -1) return ''
  let j = attrs.indexOf('=', i)
  if (j === -1) return ''
  j++
  while (attrs[j] === ' ') j++
  const q = attrs[j]
  if (q === '"' || q === "'" || q === '`') {
    const end = attrs.indexOf(q, j + 1)
    return end === -1 ? '' : attrs.slice(j + 1, end)
  }
  if (q !== '{') return ''
  let depth = 0
  for (let k = j; k < attrs.length; k++) {
    if (attrs[k] === '{') depth++
    else if (attrs[k] === '}') { depth--; if (depth === 0) return attrs.slice(j + 1, k) }
  }
  return attrs.slice(j + 1)
}

/** Все классы из значения className. */
function classesOf(region) {
  const parts = /['"`]/.test(region) ? stringLiterals(region) : [region]
  return parts.join(' ').split(/\s+/).filter(Boolean)
}

/**
 * Обход разметки со стеком предков. Нужен ровно для двух вещей: узнать ближайший
 * непрозрачный фон под текстом и узнать, не лежит ли выше по дереву фон-картинка.
 * По одной строке кода ни того, ни другого не видно.
 */
function walkJsx(src, visit) {
  const stack = []
  let i = 0
  let line = 1
  let scanned = 0
  const lineAt = (pos) => {
    for (; scanned < pos && scanned < src.length; scanned++) if (src[scanned] === '\n') line++
    return line
  }
  while (i < src.length) {
    const lt = src.indexOf('<', i)
    if (lt === -1) break
    const next = src[lt + 1]
    if (next === '/') {
      const gt = src.indexOf('>', lt)
      if (gt === -1) break
      const name = src.slice(lt + 2, gt).trim()
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].tag === name) { stack.length = k; break }
      }
      i = gt + 1
      continue
    }
    if (!/[A-Za-z]/.test(next ?? '')) { i = lt + 1; continue }
    let k = lt + 1, depth = 0, quote = null
    while (k < src.length) {
      const ch = src[k]
      if (quote) { if (ch === quote) quote = null }
      else if (ch === '"' || ch === "'" || ch === '`') quote = ch
      else if (ch === '{') depth++
      else if (ch === '}') depth--
      else if (ch === '>' && depth <= 0) break
      k++
    }
    if (k >= src.length) break
    const inner = src.slice(lt + 1, k)
    const selfClosing = inner.trimEnd().endsWith('/')
    const sp = inner.search(/[\s>]/)
    const tag = sp === -1 ? inner : inner.slice(0, sp)
    const attrs = sp === -1 ? '' : inner.slice(sp)
    const node = { tag, classes: classesOf(classNameRegion(attrs)), attrs, line: lineAt(lt) }
    visit(node, stack)
    if (!selfClosing && !/^(br|hr|img|input|meta|link)$/i.test(tag)) stack.push(node)
    i = k + 1
  }
}

// ---------------------------------------------------------------- сами правила

const SIZE_WORDS = { 'text-xs': 12, 'text-sm': 14, 'text-base': 16, 'text-lg': 18, 'text-xl': 20, 'text-2xl': 24, 'text-3xl': 30, 'text-4xl': 36 }

/** Свойства, которыми перекрашивают и перекраивают контрол. Отступы и раскладка — не они. */
const OVERRIDE_PREFIXES = ['bg-', 'rounded-', 'shadow-', 'ring-', 'border-', 'h-', 'min-h-', 'font-', 'text-']
const LAYOUT_SAFE = /^(flex|grid|block|inline|hidden|absolute|relative|sticky|fixed|truncate|shrink|grow|border|border-0)$|^(w-|max-w-|min-w-|m[trblxy]?-|p[trblxy]?-|gap-|items-|justify-|self-|order-|col-|row-|z-|overflow-|basis-|space-)/

function isColorClass(cls, cssColors) {
  const m = /^(?:text|bg|border|ring|fill|stroke)-(.+)$/.exec(cls)
  if (!m) return null
  const raw = m[1]
  const arb = /^\[(#[0-9a-fA-F]{3,8})\]$/.exec(raw)
  if (arb) {
    const hex = normHex(arb[1])
    return hex ? { hex, literal: true, name: raw } : null
  }
  const base = raw.replace(/\/\d+$/, '') // text-rd-muted/50 — прозрачность отбрасываем
  const hex = cssColors.get(base) ?? null
  return hex ? { hex, literal: false, name: base } : null
}

function fontSizeOf(classes) {
  for (const c of classes) {
    const arb = /^text-\[([0-9.]+)px\]$/.exec(c)
    if (arb) return Number(arb[1])
    if (SIZE_WORDS[c]) return SIZE_WORDS[c]
  }
  return null
}

function readScale(tokens, registry, cli) {
  if (cli) return cli.split(',').map(Number).filter((n) => !Number.isNaN(n))
  for (const src of [tokens, registry]) {
    if (Array.isArray(src?.typeScale)) return src.typeScale.map(Number)
    if (Array.isArray(src?.typeScale?.sizes)) return src.typeScale.sizes.map(Number)
  }
  return null
}

/**
 * Цвета одного канала (текст или фон) на узле — с учётом вариантных префиксов
 * (`hover:`, `focus-visible:`, `data-[state=active]:`) и веток условия внутри `cn(...)`.
 *
 * Если на узле два разных значения канала — цвет зависит от состояния или от ветки,
 * и какая из них совпадёт с каким фоном, по коду неизвестно. Считать контраст в этом
 * случае нельзя: получится пара, которой на экране не бывает. Так заслон и дал первые
 * ложные срабатывания на живом проекте — сравнивал текст одной ветки с фоном другой.
 */
function channelColors(classes, channel, cssColors) {
  const hexes = new Set()
  let plain = null
  for (const c of classes) {
    const bare = c.includes(':') ? c.slice(c.lastIndexOf(':') + 1) : c
    if (!bare.startsWith(channel + '-')) continue
    const col = isColorClass(bare, cssColors)
    if (!col) continue
    hexes.add(col.hex)
    if (bare === c && plain === null) plain = { cls: c, hex: col.hex }
  }
  return { hexes, plain, ambiguous: hexes.size > 1 }
}

/** Нормы WCAG по назначению роли — те же, что в матрице контраста скилла tokens. */
const MIN_BY_USE = { bodyText: 4.5, largeText: 3, nonText: 3, surface: null }

function makeChecks({ tokens, registry, cssColors, bgImageClasses, componentsRoot, scale: scaleList }) {
  const scale = new Set((scaleList ?? []).map(Number))
  const primitives = tokens.primitives ?? {}
  const semantic = tokens.semantic ?? {}

  // Примитив в схеме tokens.json — запись DTCG: { "$value": "#hex", "origin": "existing" }.
  const primHex = new Map()
  for (const [name, def] of Object.entries(primitives)) {
    const h = normHex(typeof def === 'string' ? def : def?.$value)
    if (h) primHex.set(name, h)
  }
  // Семантическая роль ссылается на примитив полем ref.
  const roleHex = new Map()
  const roleUse = new Map()
  for (const [role, def] of Object.entries(semantic)) {
    const h = def?.ref ? primHex.get(def.ref) : normHex(def?.$value)
    if (h) roleHex.set(role, h)
    if (def?.use) roleUse.set(role, def.use)
  }
  const rolesByHex = new Map()
  for (const [role, h] of roleHex) {
    if (!rolesByHex.has(h)) rolesByHex.set(h, [])
    rolesByHex.get(h).push(role)
  }
  const hexToPrimitive = new Map([...primHex].map(([n, h]) => [h, n]))

  // Осознанно принятые провалы контраста: в матрице у пары стоит waiver.
  // Заслон обязан их уважать, иначе его отключат целиком из-за одной известной строки.
  const waived = new Set()
  for (const m of tokens.matrix ?? []) {
    if (m?.waiver && m?.role) waived.add(`${m.role}|${normHex(m.surface) ?? m.surface}`)
  }

  // Компоненты реестра. Имя берём из impl.component — оно записано явно и гадать не нужно;
  // путь из impl.source нужен только для сообщения. Старый плоский e.source поддержан
  // на случай реестра, собранного до появления impl.
  const registryComponents = new Map()
  for (const e of registry.entries ?? []) {
    const source = e.impl?.source ?? e.source ?? null
    let name = e.impl?.component ?? null
    if (!name && source) {
      const stem = String(source).split('/').pop().replace(/\.[jt]sx?$/, '')
      name = stem.split('-').map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join('')
    }
    if (!name) continue
    registryComponents.set(name, { ...e, sourcePath: source })
  }

  /** Один файл → список нарушений. */
  return function checkFile(rel, src) {
    const out = []
    const add = (rule, line, message) => out.push({ rule, file: rel, line, message })
    const inComponentLayer = rel.startsWith(componentsRoot + '/')

    // ---- правила 1–3: работают по наборам классов, дерево им не нужно
    src.split('\n').forEach((text, idx) => {
      const line = idx + 1
      if (/^\s*(\/\/|\*|\/\*)/.test(text)) return // комментарии — не разметка
      const chunks = stringLiterals(text)
      const classes = chunks.join(' ').split(/\s+/).filter(Boolean)

      for (const cls of classes) {
        // 1. цвет литералом вместо семантики
        const arb = /^(?:text|bg|border|ring|fill|stroke)-\[(#[0-9a-fA-F]{3,8})\]$/.exec(cls)
        if (arb) {
          const hex = normHex(arb[1])
          const roles = hex ? rolesByHex.get(hex) : null
          const prim = hex ? hexToPrimitive.get(hex) : null
          add('color-literal', line,
            roles?.length
              ? `${cls}: цвет написан значением, хотя для него есть семантическая роль «${roles[0]}»`
              : prim
                ? `${cls}: взят примитив «${prim}» напрямую, минуя семантический ярус`
                : `${cls}: цвет ${hex ?? arb[1]} вне палитры — ни примитива, ни семантической роли`)
        }
        // 1б. утилита, ведущая прямо на примитив, там где у него есть роль
        const util = /^(?:text|bg|border|ring)-([a-z0-9-]+)(?:\/\d+)?$/.exec(cls)
        if (util && primHex.has(util[1]) && !roleHex.has(util[1])) {
          const roles = rolesByHex.get(primHex.get(util[1]))
          add('color-literal', line,
            `${cls}: примитив «${util[1]}» использован напрямую` +
            (roles?.length ? `, семантическая роль для него — «${roles[0]}»` : ', семантической роли у него нет'))
        }
        // 1в. полупрозрачный вариант роли для ТЕКСТА.
        // Итоговый цвет зависит от подложки и не равен ни одной роли: система про него
        // ничего не знает, матрица контраста его не содержит, посчитать его по коду нельзя.
        // Роль, разбавленная на месте, — это молча заведённая четвёртая роль.
        const faded = /^text-([a-z0-9-]+)\/(\d+)$/.exec(cls)
        if (faded && (roleHex.has(faded[1]) || cssColors.has(faded[1]))) {
          add('color-literal', line,
            `${cls}: роль разбавлена прозрачностью на месте. Итоговый цвет не принадлежит ` +
            `ни одной роли и в матрице контраста его нет — заведите роль или уберите прозрачность`)
        }
        // 3. кегль вне шкалы
        const px = /^text-\[([0-9.]+)px\]$/.exec(cls)
        if (px && scale.size && !scale.has(Number(px[1]))) {
          add('type-scale', line, `${cls}: кегля ${px[1]}px нет в шкале (${[...scale].join(', ')})`)
        }
      }

      // 2. индикатор фокуса снят без замены — смотрим набор классов целиком
      for (const chunk of chunks) {
        const cs = chunk.split(/\s+/).filter(Boolean)
        // Снятие: outline-none / outline-0, с любым префиксом состояния.
        const isRemoval = (c) => /(^|:)outline-(none|0)$/.test(c)
        // Пустышка: класс выглядит заменой, но ничего не рисует.
        const isNoop = (c) => /(^|:)(ring-0|ring-transparent|shadow-none|border-transparent|outline-transparent)$/.test(c)
        const removes = cs.some(isRemoval)
        if (!removes) continue
        // Замена — отдельный класс, а не то же самое снятие. `focus-visible:outline-none`
        // сам по себе заменой не является: именно на этом заслон и провалил мутацию 1
        // при первой проверке — правило считало снятие своей же заменой.
        const replaces = cs.some((c) =>
          !isRemoval(c) && !isNoop(c) &&
          /^(focus|focus-visible|focus-within):(ring|border|outline|shadow|bg|text|underline)/.test(c))
        if (!replaces) {
          add('focus-removed', line,
            'снят индикатор фокуса (outline-none), а видимой замены в том же наборе классов нет — ' +
            'ни кольца, ни рамки, ни тени на :focus-visible')
        }
      }
    })

    // ---- правила 4–5: требуют дерева
    walkJsx(src, (node, stack) => {
      // 4. локальное переопределение контрола вне слоя компонентов
      if (!inComponentLayer && registryComponents.has(node.tag)) {
        const bad = node.classes.filter((c) =>
          !LAYOUT_SAFE.test(c) &&
          OVERRIDE_PREFIXES.some((p) => c.startsWith(p)) &&
          !/^text-(left|right|center|justify|nowrap|wrap|balance)$/.test(c))
        if (bad.length) {
          add('local-override', node.line,
            `<${node.tag}> переопределён на месте: ${bad.slice(0, 4).join(' ')}${bad.length > 4 ? ' …' : ''}. ` +
            `Оформление живёт в ${registryComponents.get(node.tag).sourcePath ?? 'компоненте'} — иначе вариант в реестре есть, а на экране другой`)
        }
      }

      // 5. контраст пары «текст × поверхность»
      const chain = [...stack, node]
      // слепое пятно: фон-картинка или градиент где угодно выше по дереву
      const painted = chain.some((n) =>
        n.classes.some((c) => bgImageClasses.has(c) || c.startsWith('bg-gradient') || /^bg-\[url\(/.test(c)) ||
        /style=\{\{[^}]*background/i.test(n.attrs ?? ''))
      if (painted) return

      const fg = channelColors(node.classes, 'text', cssColors)
      if (fg.ambiguous || !fg.plain) return // цвет зависит от состояния или ветки — не гадаем
      const fgCls = fg.plain.cls
      if (/\/\d+$/.test(fgCls)) return // прозрачный текст: фактический цвет по коду не вычислить
      const fgHex = fg.plain.hex

      let bgHex = null
      for (let k = chain.length - 1; k >= 0; k--) {
        const bg = channelColors(chain[k].classes, 'bg', cssColors)
        if (bg.ambiguous) return // фон зависит от состояния или ветки
        if (!bg.plain) continue
        if (/\/\d+$/.test(bg.plain.cls)) return // полупрозрачная подложка — тот же случай
        bgHex = bg.plain.hex
        break
      }
      if (!bgHex) return // поверхность неизвестна — молчим, а не догадываемся

      let size = null
      for (let k = chain.length - 1; k >= 0 && size === null; k--) size = fontSizeOf(chain[k].classes)
      const bold = chain.some((n) => n.classes.some((c) => /^font-(bold|semibold|black|extrabold)$/.test(c)))

      // норму задаёт назначение роли (use) из tokens.json; если роли нет — по кеглю
      const roles = rolesByHex.get(fgHex) ?? []
      if (roles.some((r) => waived.has(`${r}|${bgHex}`))) return // провал принят осознанно, waiver в матрице
      const useMin = roles.map((r) => MIN_BY_USE[roleUse.get(r)]).find((x) => typeof x === 'number')
      const large = size !== null && (size >= 24 || (size >= 18.66 && bold))
      const min = useMin ?? (large ? 3 : 4.5)

      const ratio = contrast(fgHex, bgHex)
      if (ratio < min) {
        add('contrast', node.line,
          `${fgCls} (${fgHex}) на ${bgHex}: контраст ${ratio} при норме ${min}` +
          (roles.length ? ` для роли «${roles[0]}»` : '') +
          (size ? `, кегль ${size}px` : ''))
      }
    })

    // ---- 6. правила уровня страницы
    if (/(^|\/)(page|layout)\.[jt]sx$/.test(rel)) {
      const mains = [...src.matchAll(/<main[\s>]/g)].length
      if (mains > 1) {
        add('page-structure', 1,
          `главных лендмарков <main> в файле: ${mains}. Главный лендмарк на экране один — ` +
          'иначе «перейти к содержимому» ведёт неизвестно куда')
      }
      const h1 = [...src.matchAll(/<h1[\s>]/g)].length
      if (h1 > 1) {
        add('page-structure', 1,
          `заголовков <h1> в файле: ${h1}. Заголовок первого уровня на экране один — он и есть название экрана`)
      }
    }

    return out
  }
}

// ---------------------------------------------------------------- самопроверка

const SELF_TOKENS = {
  // схема — как в design-system/tokens.json скилла tokens: DTCG-примитивы и роли по ref
  primitives: {
    paper: { $value: '#ffffff', $type: 'color', origin: 'existing' },
    faint: { $value: '#a3a3a3', $type: 'color', origin: 'existing' },
    ink: { $value: '#17171a', $type: 'color', origin: 'existing' },
    brand: { $value: '#bf502e', $type: 'color', origin: 'existing' },
  },
  semantic: {
    'surface-paper': { ref: 'paper', use: 'surface', usages: 10, evidence: 'app/page.tsx:1' },
    'text-primary': { ref: 'ink', use: 'bodyText', usages: 10, evidence: 'app/page.tsx:2', onSurfaces: 'all' },
    'text-quiet': { ref: 'faint', use: 'bodyText', usages: 3, evidence: 'app/page.tsx:3', onSurfaces: 'all' },
    accent: { ref: 'brand', use: 'nonText', usages: 4, evidence: 'app/page.tsx:4', onSurfaces: 'all' },
  },
  surfaces: [{ color: '#ffffff', name: 'бумага', textNodes: 10, origin: 'existing' }],
  matrix: [{ role: 'text-quiet', surface: '#ffffff', ratio: 2.32, required: 4.5, verdict: 'fail' }],
  typeScale: [12, 14, 16],
}
const SELF_REGISTRY = {
  entries: [{
    id: 'button', title: 'Кнопка', level: 'atom', status: 'ready',
    impl: { component: 'Button', source: 'components/ui/button.tsx', nativeTag: 'button', alternatives: [] },
  }],
}
const SELF_CSS = [
  ':root { --color-surface-paper: #ffffff; --color-text-primary: #17171a; --color-text-quiet: #a3a3a3;',
  '        --color-accent: #bf502e; --color-paper: #ffffff; --color-faint: #a3a3a3; --color-ink: #17171a; }',
  '.hero { background: linear-gradient(#000, #fff); }',
]

const SELF_CASES = [
  { rule: 'color-literal', what: 'цвет значением', file: 'app/x.tsx', src: '<div className="bg-[#bf502e] p-2">текст</div>' },
  { rule: 'color-literal', what: 'примитив напрямую', file: 'app/x.tsx', src: '<p className="text-faint">подпись</p>' },
  { rule: 'color-literal', what: 'роль разбавлена прозрачностью', file: 'app/x.tsx', src: '<p className="text-text-primary/50">подпись</p>' },
  { rule: 'focus-removed', what: 'фокус снят без замены', file: 'app/x.tsx', src: '<button className="outline-none px-2">жми</button>' },
  { rule: 'focus-removed', what: 'снятие выдаёт себя за замену', file: 'app/x.tsx', src: '<button className="px-2 focus-visible:outline-none">жми</button>' },
  { rule: 'focus-removed', what: 'замена-пустышка', file: 'app/x.tsx', src: '<button className="outline-none focus-visible:ring-0">жми</button>' },
  { rule: 'type-scale', what: 'кегль вне шкалы', file: 'app/x.tsx', src: '<span className="text-[13px]">подпись</span>' },
  { rule: 'local-override', what: 'контрол перекрашен на месте', file: 'app/x.tsx', src: '<Button className="bg-surface-paper rounded-full">жми</Button>' },
  { rule: 'contrast', what: 'пара ниже нормы', file: 'app/x.tsx', src: '<div className="bg-surface-paper"><p className="text-text-quiet text-[14px]">подпись</p></div>' },
  { rule: 'page-structure', what: 'два main и два h1', file: 'app/page.tsx', src: '<div><main><h1>А</h1></main><main><h1>Б</h1></main></div>' },
]
const SELF_CLEAN = {
  file: 'app/page.tsx',
  src: [
    '<main className="bg-surface-paper">',
    '  <h1 className="text-text-primary text-[16px]">Заголовок</h1>',
    '  <p className="text-text-primary text-[14px]">Текст на белом</p>',
    '  <section className="hero"><p className="text-text-quiet text-[12px]">Подпись поверх градиента</p></section>',
    '  <button className="outline-none focus-visible:ring-2 focus-visible:ring-accent">Жми</button>',
    '  <span className={cn("text-[12px]", active ? "text-text-quiet" : "text-text-primary")}>Вкладка</span>',
    '</main>',
  ].join('\n'),
}

function selfTest() {
  const cssColors = readCssColors(SELF_CSS)
  const bgImageClasses = readBgImageClasses(SELF_CSS)
  const check = makeChecks({
    tokens: SELF_TOKENS, registry: SELF_REGISTRY, cssColors, bgImageClasses,
    componentsRoot: 'components', scale: SELF_TOKENS.typeScale,
  })
  const problems = []
  if (RULES.length !== RULE_COUNT) {
    problems.push(`правил объявлено ${RULES.length}, а должно быть ${RULE_COUNT} — правило удалили?`)
  }
  for (const c of SELF_CASES) {
    const hits = check(c.file, c.src).filter((v) => v.rule === c.rule)
    if (hits.length === 0) {
      problems.push(`правило «${c.rule}» не сработало на образце «${c.what}» — оно больше ничего не ловит`)
    }
  }
  const clean = check(SELF_CLEAN.file, SELF_CLEAN.src)
  if (clean.length) {
    problems.push(`на заведомо чистом образце найдено ${clean.length} нарушений: ` +
      clean.map((v) => `${v.rule} — ${v.message}`).join('; '))
  }
  // waiver обязан гасить известный провал, иначе заслон отключат целиком из-за одной строки
  const withWaiver = makeChecks({
    tokens: { ...SELF_TOKENS, matrix: [{ role: 'text-quiet', surface: '#ffffff', ratio: 2.32, required: 4.5, verdict: 'fail', waiver: 'меняем в следующей пачке' }] },
    registry: SELF_REGISTRY, cssColors, bgImageClasses, componentsRoot: 'components', scale: SELF_TOKENS.typeScale,
  })
  const waivedHits = withWaiver('app/x.tsx', '<div className="bg-surface-paper"><p className="text-text-quiet text-[14px]">подпись</p></div>')
    .filter((v) => v.rule === 'contrast')
  if (waivedHits.length) problems.push('пара с waiver всё равно краснеет — заслон не уважает осознанно принятые провалы')
  return problems
}

// ---------------------------------------------------------------- вход

function main(argv) {
  const args = argv.slice(2)
  const VALUE_FLAGS = new Set(['--registry', '--tokens', '--ci'])
  const flag = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1] ?? null }
  const selfOnly = args.includes('--self-test')

  const selfProblems = selfTest()
  if (selfProblems.length) {
    console.error('Самопроверка заслона не прошла — смотреть проект бессмысленно:\n')
    for (const p of selfProblems) console.error(`  • ${p}`)
    console.error('\nЗаслон, который не срабатывает на заведомом нарушении, не заслон, а строка в CI.')
    return 1
  }
  if (selfOnly) {
    console.log(`Самопроверка пройдена: ${RULE_COUNT}/${RULE_COUNT} правил краснеют на образцах, чистый образец проходит.`)
    return 0
  }

  const root = args.find((a, i) => !a.startsWith('--') && !VALUE_FLAGS.has(args[i - 1]))
  if (!root) {
    console.error('Использование: node ds-guard.mjs <корень проекта> [--registry путь] [--tokens путь] [--ci файл]')
    console.error('               node ds-guard.mjs --self-test')
    return 1
  }
  const registryPath = flag('--registry') ?? join(root, 'design-system/registry.json')
  const tokensPath = flag('--tokens') ?? join(root, 'design-system/tokens.json')
  for (const [what, p] of [['registry.json', registryPath], ['tokens.json', tokensPath]]) {
    if (!existsSync(p)) {
      console.error(`Нет ${what}: ${p}`)
      console.error('Заслон сверяет код с системой. Нет описания системы — сверять не с чем: вызовите design-system:registry.')
      return 1
    }
  }
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
  const tokens = JSON.parse(readFileSync(tokensPath, 'utf8'))

  const cssSources = walk(root, new Set(['.css'])).map((f) => readFileSync(f, 'utf8'))
  const cssColors = readCssColors(cssSources)
  const bgImageClasses = readBgImageClasses(cssSources)

  const componentsRoot = (registry.project?.componentsRoot ?? 'components').replace(/\/$/, '')

  // Шкала кеглей: план не назначил ей дом, поэтому берём в порядке «токены → реестр → флаг».
  // Молча пропустить правило нельзя: заслон, у которого одно из шести правил тихо выключено,
  // ровно то, что этот скилл запрещает.
  const scale = readScale(tokens, registry, flag('--scale'))
  if (!scale || !scale.length) {
    console.error('Не найдена шкала кеглей: ни tokens.typeScale, ни registry.typeScale, ни --scale 12,14,16.')
    console.error('Без шкалы правило «кегль вне шкалы» проверять нечем, а тихо выключенное правило хуже отсутствующего.')
    return 1
  }
  const check = makeChecks({ tokens, registry, cssColors, bgImageClasses, componentsRoot, scale })

  const files = walk(root, new Set(['.tsx', '.jsx'])).filter((f) => !/\.(test|spec)\.[jt]sx?$/.test(f))
  const violations = []
  for (const f of files) {
    const rel = relative(root, f).replace(/\\/g, '/')
    violations.push(...check(rel, readFileSync(f, 'utf8')))
  }

  // Необязательная проверка: шаг в CI на месте. Мутацию «удалить вызов заслона» изнутри
  // самого заслона не поймать — её ловит либо этот флаг из соседней задачи, либо человек.
  const ci = flag('--ci')
  if (ci) {
    if (!existsSync(ci)) {
      console.error(`Файл CI не найден: ${ci}`)
      return 1
    }
    if (!/ds-guard/.test(readFileSync(ci, 'utf8'))) {
      console.error(`В ${ci} нет вызова ds-guard: заслон лежит в репозитории и не работает ни на одном изменении.`)
      return 1
    }
  }

  if (!violations.length) {
    console.log(`Заслон: нарушений нет. Файлов проверено: ${files.length}. Самопроверка: ${RULE_COUNT}/${RULE_COUNT}.`)
    return 0
  }

  console.error(`Заслон дизайн-системы: нарушений ${violations.length} в ${new Set(violations.map((v) => v.file)).size} файлах.\n`)
  for (const rule of RULES) {
    const list = violations.filter((v) => v.rule === rule)
    if (!list.length) continue
    console.error(`[${rule}] ${list.length}`)
    for (const v of list.slice(0, 25)) console.error(`  ${v.file}:${v.line}  ${v.message}`)
    if (list.length > 25) console.error(`  … и ещё ${list.length - 25}`)
    console.error('')
  }
  return 1
}

process.exit(main(process.argv))
