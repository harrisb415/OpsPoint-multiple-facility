// Generates the facility theme blocks for index.css and contrast-checks them.
// Rail stops are derived from each theme's 950 using the SAME rgb delta the
// approved indigo rail already uses, so the default reproduces byte-exactly
// and every other theme gets an analogous drift.

const RAMPS = {
  indigo:  ['#eef2ff','#e0e7ff','#c7d2fe','#a5b4fc','#818cf8','#6366f1','#4f46e5','#4338ca','#3730a3','#312e81','#1e1b4b'],
  blue:    ['#eff6ff','#dbeafe','#bfdbfe','#93c5fd','#60a5fa','#3b82f6','#2563eb','#1d4ed8','#1e40af','#1e3a8a','#172554'],
  teal:    ['#f0fdfa','#ccfbf1','#99f6e4','#5eead4','#2dd4bf','#14b8a6','#0d9488','#0f766e','#115e59','#134e4a','#042f2e'],
  emerald: ['#ecfdf5','#d1fae5','#a7f3d0','#6ee7b7','#34d399','#10b981','#059669','#047857','#065f46','#064e3b','#022c22'],
  rose:    ['#fff1f2','#ffe4e6','#fecdd3','#fda4af','#fb7185','#f43f5e','#e11d48','#be123c','#9f1239','#881337','#4c0519'],
}
const STEPS = [50,100,200,300,400,500,600,700,800,900,950]

// accent 400/500/600 per theme
const ACCENTS = {
  indigo:  ['#c084fc','#a855f7','#9333ea'],  // purple  (current)
  blue:    ['#22d3ee','#06b6d4','#0891b2'],  // cyan
  teal:    ['#34d399','#10b981','#059669'],  // emerald
  emerald: ['#2dd4bf','#14b8a6','#0d9488'],  // teal
  rose:    ['#e879f9','#d946ef','#c026d3'],  // fuchsia
}

// Green-family ramps are too light at 600 for white button text (teal-600 is
// 3.1:1, emerald-600 3.3:1 — both under the 4.5 AA floor). Shift those two
// themes' 500/600/700 one step darker so buttons stay legible.
const SHIFT = { teal: true, emerald: true }

const hex2rgb = h => [1,3,5].map(i => parseInt(h.slice(i,i+2),16))
const rgb2hex = c => '#' + c.map(v => Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('')
const lum = h => { const s = hex2rgb(h).map(v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4) })
  return 0.2126*s[0] + 0.7152*s[1] + 0.0722*s[2] }
const ratio = (a,b) => { const [x,y]=[lum(a),lum(b)].sort((m,n)=>n-m); return (x+0.05)/(y+0.05) }

// indigo rail deltas, measured off the approved values
const TOP = hex2rgb('#1e1b4b')
const D_MID = hex2rgb('#241f52').map((v,i) => v - TOP[i])   // (+6,+4,+7)
const D_BOT = hex2rgb('#2d1b4e').map((v,i) => v - TOP[i])   // (+15,0,+3)

function build(name) {
  let ramp = RAMPS[name].slice()
  if (SHIFT[name]) {
    // Shift 500-800 one step darker so the 600 slot clears AA behind white,
    // then interpolate a new 900 between the old 900 and 950 rather than
    // duplicating 950 — otherwise 900 and 950 collide and shadow-primary-900
    // becomes the rail colour.
    const o = ramp.slice()
    const mix = (a,b,t) => rgb2hex(hex2rgb(a).map((v,i) => v + (hex2rgb(b)[i]-v)*t))
    ramp = o.slice(0,5).concat([o[6], o[7], o[8], o[9], mix(o[9], o[10], 0.5), o[10]])
  }
  const top = ramp[10]
  const rgb = hex2rgb(top)
  return {
    ramp,
    accent: ACCENTS[name],
    rail: { top, mid: rgb2hex(rgb.map((v,i)=>v+D_MID[i])), bot: rgb2hex(rgb.map((v,i)=>v+D_BOT[i])) },
    fg: ramp[2], fgDim: ramp[3],
  }
}

const CHECKS = [
  ['primary-600 + white text (buttons)', t => ratio(t.ramp[6], '#ffffff'), 4.5],
  ['primary-700 on white (brand text)',  t => ratio(t.ramp[7], '#ffffff'), 4.5],
  ['rail-fg on rail-top',                t => ratio(t.fg, t.rail.top),     4.5],
  ['rail-fg-dim on rail-top (icons)',    t => ratio(t.fgDim, t.rail.top),  3.0],
  ['gray-900 on primary-50 (CARD_HEAD)', t => ratio('#111827', t.ramp[0]), 4.5],
]

let css = '', fails = 0
for (const name of Object.keys(RAMPS)) {
  const t = build(name)
  console.log('\n' + name.toUpperCase() + (SHIFT[name] ? '  (ramp shifted one step darker)' : ''))
  for (const [label, fn, min] of CHECKS) {
    const r = fn(t), ok = r >= min
    if (!ok) fails++
    console.log('   %s %-38s %s:1  (min %s)', ok ? 'PASS' : 'FAIL', label, r.toFixed(2), min)
  }
  if (name === 'indigo') continue   // default lives in @theme, no override block
  const lines = STEPS.map((s,i) => '  --color-primary-' + String(s).padEnd(3) + ': ' + t.ramp[i] + ';')
  css += '\n:root[data-theme="' + name + '"] {\n' + lines.join('\n') + '\n' +
         '  --color-accent-400: ' + t.accent[0] + ';\n' +
         '  --color-accent-500: ' + t.accent[1] + ';\n' +
         '  --color-accent-600: ' + t.accent[2] + ';\n' +
         '  --color-rail-top: ' + t.rail.top + ';\n' +
         '  --color-rail-mid: ' + t.rail.mid + ';\n' +
         '  --color-rail-bot: ' + t.rail.bot + ';\n' +
         '  --color-rail-fg:     ' + t.fg + ';\n' +
         '  --color-rail-fg-dim: ' + t.fgDim + ';\n}\n'
}

// sanity: indigo must reproduce the shipped values exactly
const ind = build('indigo')
const exact = ind.rail.top==='#1e1b4b' && ind.rail.mid==='#241f52' && ind.rail.bot==='#2d1b4e'
           && ind.fg==='#c7d2fe' && ind.fgDim==='#a5b4fc'
console.log('\nindigo reproduces shipped rail exactly:', exact)
console.log('contrast failures:', fails)
require('fs').writeFileSync(process.argv[2], css)
console.log('css written ->', process.argv[2])
