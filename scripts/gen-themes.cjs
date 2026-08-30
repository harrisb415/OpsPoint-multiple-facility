// Generates the facility theme blocks for index.css and contrast-checks them.
// Rail stops are derived from each theme's 950 using the SAME rgb delta the
// approved indigo rail already uses, so the default reproduces byte-exactly
// and every other theme gets an analogous drift.

const RAMPS = {
  indigo:  ['#eef2ff','#e0e7ff','#c7d2fe','#a5b4fc','#818cf8','#6366f1','#4f46e5','#4338ca','#3730a3','#312e81','#1e1b4b'],
  blue:    ['#eff6ff','#dbeafe','#bfdbfe','#93c5fd','#60a5fa','#3b82f6','#2563eb','#1d4ed8','#1e40af','#1e3a8a','#172554'],
  teal:    ['#f0fdfa','#ccfbf1','#99f6e4','#5eead4','#2dd4bf','#14b8a6','#0d9488','#0f766e','#115e59','#134e4a','#042f2e'],
  emerald: ['#ecfdf5','#d1fae5','#a7f3d0','#6ee7b7','#34d399','#10b981','#059669','#047857','#065f46','#064e3b','#022c22'],
  // Labelled "Rose" but built on Tailwind's pink ramp, not rose. rose-600
  // (#e11d48) sits ~10 degrees of CIELab hue from the red the app uses for
  // danger, so a rose primary button read as destructive. pink-600 clears it.
  rose:    ['#fdf2f8','#fce7f3','#fbcfe8','#f9a8d4','#f472b6','#ec4899','#db2777','#be185d','#9d174d','#831843','#500724'],
  // The Salvation Army. Their palette is SA Red #ef3e42 (dominant), SA Blue
  // #002056, SA Navy #132230 and SA Gold #af8c46.
  //
  // SA Red cannot be the primary: it sits 4.4 degrees of hue from the red this
  // app uses for destructive actions, and manages only 3.86:1 behind white
  // text. A Save button in it would be indistinguishable from Delete and would
  // fail AA. So red goes to the accent — decorative only, always paired with
  // primary in a gradient, never a standalone action — which is also how their
  // own materials read: navy and blue chrome, red as the mark.
  //
  // The ramp is Tailwind blue with 950 anchored to SA Blue. Not a substitution
  // of convenience: SA Blue's hue is 291.0 and the blue ramp runs 291-296, so
  // this is their blue at lightness steps already validated for contrast.
  salvation: ['#eff6ff','#dbeafe','#bfdbfe','#93c5fd','#60a5fa','#3b82f6','#2563eb','#1d4ed8','#1e40af','#1e3a8a','#002056'],
}
const STEPS = [50,100,200,300,400,500,600,700,800,900,950]

// accent 400/500/600 per theme
const ACCENTS = {
  indigo:  ['#c084fc','#a855f7','#9333ea'],  // purple  (current)
  blue:    ['#22d3ee','#06b6d4','#0891b2'],  // cyan
  teal:    ['#34d399','#10b981','#059669'],  // emerald
  emerald: ['#2dd4bf','#14b8a6','#0d9488'],  // teal
  rose:    ['#e879f9','#d946ef','#c026d3'],  // fuchsia
  // SA Red #ef3e42 exact at 500, with a lighter and a darker step around it.
  salvation: ['#f4787b','#ef3e42','#cb2d31'],
}

// Green-family ramps are too light at 600 for white button text (teal-600 is
// 3.1:1, emerald-600 3.3:1 — both under the 4.5 AA floor). Shift those two
// themes' 500/600/700 one step darker so buttons stay legible.
const SHIFT = { teal: true, emerald: true }

// Themes whose rail is its own brand colour rather than the ramp's darkest
// step. SA Navy is a distinct entry in their palette, so the rail uses it and
// the mid/bot stops are derived from it by the usual delta.
const RAIL_TOP = { salvation: '#132230' }

const hex2rgb = h => [1,3,5].map(i => parseInt(h.slice(i,i+2),16))
const rgb2hex = c => '#' + c.map(v => Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('')
const lum = h => { const s = hex2rgb(h).map(v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4) })
  return 0.2126*s[0] + 0.7152*s[1] + 0.0722*s[2] }
const ratio = (a,b) => { const [x,y]=[lum(a),lum(b)].sort((m,n)=>n-m); return (x+0.05)/(y+0.05) }

// sRGB -> CIELab -> hue angle, so a theme's brand hue can be compared against
// the reds the app reserves for danger. RGB distance is not a usable proxy.
function lab(h) {
  const f = v => { v/=255; return v<=0.04045 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4) }
  const [r,g,b] = hex2rgb(h).map(f)
  const X = (0.4124*r + 0.3576*g + 0.1805*b) / 0.95047
  const Y = (0.2126*r + 0.7152*g + 0.0722*b)
  const Z = (0.0193*r + 0.1192*g + 0.9505*b) / 1.08883
  const k = t => t > 0.008856 ? Math.cbrt(t) : (7.787*t + 16/116)
  const [fx,fy,fz] = [k(X), k(Y), k(Z)]
  return [116*fy - 16, 500*(fx-fy), 200*(fy-fz)]
}
const hueDeg = h => { const [,A,B] = lab(h); return (Math.atan2(B,A) * 180/Math.PI + 360) % 360 }
const hueGap = (a,b) => { const d = Math.abs(hueDeg(a) - hueDeg(b)); return d > 180 ? 360-d : d }

// The app's destructive colours: Button color="failure" renders bg-red-700,
// and text-red-600 is the other danger tone.
const DANGER = { 'red-600': '#dc2626', 'red-700': '#b91c1c' }
const MIN_HUE_GAP = 25

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
  const top = RAIL_TOP[name] || ramp[10]
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

// A brand whose 600 sits too close in hue to the danger reds makes a primary
// button read as destructive — the reason Rose is built on pink, not rose.
const HUE_CHECKS = Object.entries(DANGER).map(([name, hex]) =>
  ['hue gap from ' + name + ' (danger)', t => hueGap(t.ramp[6], hex), MIN_HUE_GAP])

let css = '', fails = 0
for (const name of Object.keys(RAMPS)) {
  const t = build(name)
  console.log('\n' + name.toUpperCase() + (SHIFT[name] ? '  (ramp shifted one step darker)' : ''))
  for (const [label, fn, min] of CHECKS.concat(HUE_CHECKS)) {
    const r = fn(t), ok = r >= min
    if (!ok) fails++
    const unit = label.startsWith('hue gap') ? ' deg' : ':1'
    console.log('   ' + (ok ? 'PASS' : 'FAIL') + '  ' + label.padEnd(36) +
                (r.toFixed(2) + unit).padStart(11) + '   min ' + min)
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
