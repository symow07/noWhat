#!/usr/bin/env node
// Regenerates the README's screenshots in docs/media from the Acme Notes demo.
//
// 1. builds the demo (docs/demo/make-demo.mjs) and runs detection over it (evidence.ts)
// 2. mounts the real sidebar in Claude Code's plugin test kit, in each state
// 3. turns each drawing into dark and light PNGs at 2x with a headless Chromium browser
//
//   node scripts/screenshots/render.mjs            the screenshots
//   node scripts/screenshots/render.mjs --brand    also the wordmark and the plugin icon
//
// Needs Node 20+, Bun, Claude Code (`claude` on PATH, or CLAUDE_BIN) and Chrome,
// Brave or Chromium (found by itself, or BROWSER). Writes scratch files to .sandbox/.

import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '../..')
const work = join(repo, '.sandbox/screenshots')
const media = join(repo, 'docs/media')
const brand = process.argv.includes('--brand')

const claude = process.env.CLAUDE_BIN ?? 'claude'
const browser =
  process.env.BROWSER ??
  [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].find(existsSync)
if (!browser) throw new Error('No Chrome, Brave or Chromium found: set BROWSER to one.')

const run = (command, args, options = {}) => {
  const ran = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'pipe'], ...options })
  if (ran.error) throw ran.error
  return ran
}

// 1. The demo, and what detection finds in it.
rmSync(work, { recursive: true, force: true })
mkdirSync(work, { recursive: true })
const demo = join(work, 'acme-notes')
execFileSync('node', [join(repo, 'docs/demo/make-demo.mjs'), demo], { stdio: 'ignore' })
const evidencePath = join(work, 'evidence.json')
console.log(run('bun', [join(here, 'evidence.ts'), demo, evidencePath]).stdout.trim())
const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))

// 2. The sidebar's drawings, from a throwaway copy of the plugin whose clock reads "a minute after the check".
const kit = join(work, 'kit')
for (const part of ['hooks', 'prompts', 'types', '.claude-plugin']) cpSync(join(repo, part), join(kit, part), { recursive: true })
mkdirSync(join(kit, 'tests'), { recursive: true })
const now = Date.parse(evidence.checked_at) + 60_000
const patch = (text, from, to) => {
  if (!text.includes(from)) throw new Error(`tests/world.ts changed: update render.mjs where it patches "${from}"`)
  return text.replace(from, to)
}
let world = readFileSync(join(repo, 'tests/world.ts'), 'utf8')
world = patch(world, "mock.clock(on, { now: Date.parse('2026-10-12T20:00:00Z') })", `mock.clock(on, { now: ${now} })`)
world = patch(world, 'mock.store(on)', `mock.store(on, { 'visit:/work/sample-app': { at: '${new Date(now - 3 * 86_400_000).toISOString()}', head: null } })`)
writeFileSync(join(kit, 'tests/world.ts'), world)

const dated = value => {
  if (Array.isArray(value)) return value.map(dated)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, dated(inner)]))
  const match = typeof value === 'string' ? /^@-(\d+)([mhd])$/.exec(value) : null
  return match ? new Date(now - Number(match[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]]).toISOString() : value
}
const data = {
  demo: JSON.parse(readFileSync(join(demo, '.claude/nowhat.json'), 'utf8')),
  evidence,
  companions: dated(JSON.parse(readFileSync(join(here, 'companions.json'), 'utf8'))),
}
writeFileSync(join(kit, 'tests/screenshots.test.ts'), readFileSync(join(here, 'render-test.template.ts'), 'utf8').replace('__DATA__', () => JSON.stringify(data)))
const tested = run(claude, ['plugin', 'test', kit])
// The kit prints a test's console output on either stream: look in both.
const printed = `${tested.stdout}\n${tested.stderr}`
const marker = printed.indexOf('@@SHOTS')
if (marker === -1) throw new Error(`The test kit drew nothing:\n${printed}`)
const shots = JSON.parse(printed.slice(marker + 7).split('\n')[0])

// 3. Drawings to PNGs.
const THEMES = {
  dark: { pane: '#262624', border: 'rgba(255,255,255,.09)', text: '#ECEAE6', faint: 'rgba(255,255,255,.12)', field: 'rgba(255,255,255,.14)', placeholder: '#6E6C68' },
  light: { pane: '#FFFFFF', border: 'rgba(0,0,0,.10)', text: '#1F1F1E', faint: 'rgba(0,0,0,.10)', field: 'rgba(0,0,0,.14)', placeholder: '#8A8986' },
}
const NAMED = { error: '#E5534B', warning: '#D9822B', success: '#2E9D6B', suggestion: '#4A8FE7', remember: '#7F77DD', subtle: '#8E8E93' }
const color = name => NAMED[name] ?? name
const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const U = 8

/** One element of the drawing as HTML, approximating how the desktop app lays it out. */
function html(node, theme) {
  if (typeof node === 'string') return escape(node).replace(/\n/g, '<br>')
  if (Array.isArray(node)) return node.map(child => html(child, theme)).join('')
  if (!node) return ''
  const props = node.props ?? {}
  const inner = (node.children ?? []).map(child => html(child, theme)).join('')
  switch (node.type) {
    case 'Box': {
      const style = ['display:flex', `flex-direction:${props.flexDirection ?? 'row'}`, 'min-width:0']
      if (props.gap !== undefined) style.push(`row-gap:${props.gap * U * 1.25}px`)
      if (props.columnGap !== undefined) style.push(`column-gap:${props.columnGap * U * 0.75}px`)
      if (props.justifyContent) style.push(`justify-content:${props.justifyContent}`)
      if (props.alignItems) style.push(`align-items:${props.alignItems}`)
      if (props.paddingX !== undefined) style.push(`padding:${U * 0.9}px ${props.paddingX * U * 1.4}px`)
      if (props.paddingLeft !== undefined) style.push(`padding-left:${props.paddingLeft * U * 1.2}px`)
      if (props.marginTop !== undefined) style.push(`margin-top:${props.marginTop * U}px`)
      if (props.marginBottom !== undefined) style.push(`margin-bottom:${props.marginBottom * U}px`)
      if (props.flexShrink !== undefined) style.push(`flex-shrink:${props.flexShrink}`)
      if (typeof props.width === 'number') style.push(`width:${props.width * 7.5}px`)
      if (props.borderStyle) style.push(`border:1px solid ${props.borderColor ? color(props.borderColor) : props.borderDimColor ? theme.faint : theme.border};border-radius:10px`)
      return `<div style="${style.join(';')}">${inner}</div>`
    }
    case 'Text': {
      const style = []
      if (props.bold) style.push('font-weight:600')
      if (props.color) style.push(`color:${color(props.color)}`)
      if (props.dimColor) style.push('opacity:.55')
      if (props.underline) style.push('text-decoration:underline;text-underline-offset:6px;text-decoration-thickness:2px')
      if (String(props.wrap ?? '').startsWith('truncate')) style.push('white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0')
      return `<span style="${style.join(';')}">${inner}</span>`
    }
    case 'Button':
      return props.variant === 'primary' ? `<button class="primary">${escape(props.label ?? '')}</button>` : `<span class="btn">${inner || escape(props.label ?? '')}</span>`
    case 'Input':
      return `<div class="input">${escape(props.placeholder ?? '')}<span class="kbd">↵</span></div>`
    case 'Markdown': {
      const text = props.text ?? ''
      return text.startsWith('### ') ? `<h3>${escape(text.slice(4))}</h3>` : `<span>${escape(text)}</span>`
    }
    case 'Svg':
      return `<span class="svg">${props.source ?? ''}</span>`
    default:
      return inner
  }
}

/** A page holding the drawing, or only some of its top-level parts, in a pane-like frame. */
function page(tree, keep, theme) {
  const parts = keep ? keep.map(index => html((tree.children ?? [])[index], theme)).join('') : html(tree, theme)
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;background:transparent}
body{font:13px/1.45 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;color:${theme.text};-webkit-font-smoothing:antialiased;padding:14px}
.frame{width:380px;background:${theme.pane};border:1px solid ${theme.border};border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;${keep ? 'row-gap:10px' : ''}}
h3{margin:0;font-size:15px;font-weight:650}
.btn{display:inline-flex;align-items:center;gap:4px;min-width:0}
.svg{display:inline-flex;line-height:0;flex-shrink:0}.svg svg{max-width:100%}
button.primary{background:#4A8FE7;color:#fff;border:0;border-radius:7px;padding:5px 11px;font:600 12px -apple-system,system-ui;align-self:flex-start}
.input{display:flex;justify-content:space-between;align-items:center;height:30px;border:1px solid ${theme.field};border-radius:8px;padding:0 10px;color:${theme.placeholder};font-size:12.5px}
.kbd{font-size:11px;border:1px solid ${theme.field};border-radius:4px;padding:0 5px}
</style></head><body><div class="frame">${parts}</div>
<script>const r=document.querySelector('.frame').getBoundingClientRect();document.body.dataset.w=Math.ceil(r.right+14);document.body.dataset.h=Math.ceil(r.bottom+14)</script></body></html>`
}

/** Renders an HTML file to a PNG cropped to its content, at 2x, on a transparent background. */
function shoot(htmlPath, pngPath, background = '00000000') {
  const flags = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2', `--default-background-color=${background}`]
  const dom = run(browser, [...flags, '--window-size=1000,3000', '--dump-dom', pathToFileURL(htmlPath).href]).stdout
  const width = Number(/data-w="(\d+)"/.exec(dom)?.[1])
  const height = Number(/data-h="(\d+)"/.exec(dom)?.[1])
  if (!width || !height) throw new Error(`Couldn't measure ${htmlPath}`)
  run(browser, [...flags, `--window-size=${width},${height}`, `--screenshot=${pngPath}`, pathToFileURL(htmlPath).href])
  return `${width * 2}x${height * 2}`
}

// Which state each image shows, and which top-level parts of the sidebar it keeps
// (0 header, 1 alert strip, 2 Next up, 3 capture, 4 tabs, 5 closed sections, 6 all projects).
const PLAN = {
  overview: ['overview', null],
  'next-up': ['overview', [0, 2]],
  regression: ['overview', [1, 2]],
  'needs-you': ['needs', [4]],
  decisions: ['decisions', [4]],
  launch: ['launch', [4]],
  'all-projects': ['projects', null],
}
mkdirSync(media, { recursive: true })
for (const [name, [state, keep]] of Object.entries(PLAN)) {
  for (const [themeName, theme] of Object.entries(THEMES)) {
    const htmlPath = join(work, `${name}-${themeName}.html`)
    writeFileSync(htmlPath, page(shots[state], keep, theme))
    console.log(`docs/media/${name}-${themeName}.png ${shoot(htmlPath, join(media, `${name}-${themeName}.png`))}`)
  }
}

// The wordmark (dark and light, transparent) and the plugin's square icon.
if (brand) {
  const mark = (no, what, size) =>
    `<div class="mark" style="font-size:${size}px;letter-spacing:-0.035em;line-height:1"><span style="font-weight:400;color:${no}">no</span><span style="font-weight:800;color:${what}">What</span><span style="font-weight:800;color:#4A8FE7">.</span></div>`
  const doc = body => `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;background:transparent}body{display:inline-block;padding:16px 20px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",system-ui,sans-serif;-webkit-font-smoothing:antialiased}</style></head><body>${body}<script>const r=document.querySelector('.mark').getBoundingClientRect();document.body.dataset.w=Math.ceil(r.right+20);document.body.dataset.h=Math.ceil(r.bottom+16)</script></body></html>`
  for (const [themeName, no, what] of [['dark', '#8E8C88', '#ECEAE6'], ['light', '#8A8986', '#1F1F1E']]) {
    const htmlPath = join(work, `wordmark-${themeName}.html`)
    writeFileSync(htmlPath, doc(mark(no, what, 72)))
    console.log(`docs/media/wordmark-${themeName}.png ${shoot(htmlPath, join(media, `wordmark-${themeName}.png`))}`)
  }
  const iconPath = join(work, 'icon.html')
  writeFileSync(
    iconPath,
    `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:256px;height:256px;background:#1F1E1D}body{display:flex;align-items:center;justify-content:center;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",system-ui,sans-serif;-webkit-font-smoothing:antialiased}</style></head><body><div style="font-size:118px;letter-spacing:-0.05em;line-height:1;margin-top:-6px"><span style="font-weight:400;color:#8E8C88">n</span><span style="font-weight:800;color:#ECEAE6">W</span><span style="font-weight:800;color:#4A8FE7">.</span></div></body></html>`,
  )
  run(browser, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2', '--window-size=256,256', `--screenshot=${join(repo, '.claude-plugin/icon.png')}`, pathToFileURL(iconPath).href])
  console.log('.claude-plugin/icon.png 512x512')
}
