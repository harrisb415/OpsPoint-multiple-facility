import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { usePermission } from '../hooks/usePermission.js'

// ── Constants ───────────────────────────────────────────────────────
const ST_LABELS = {
  building: 'In Building', work: 'At Work', pass: 'Weekend Pass',
  bhc: 'BHC', efc: 'EFC', hospital: 'Hospital', out: 'Out/Other', vacant: 'Vacant',
}
const ST_CLS = {
  building: 's-building', work: 's-work', pass: 's-pass',
  bhc: 's-bhc', efc: 's-efc', hospital: 's-hospital', out: 's-out', vacant: 's-vacant',
}
const DEFAULT_AREAS = [
  'Supply Room', 'Basement / Offices', 'Kitchen', 'Meeting Room', 'Dining Room',
  'Laundry Area', 'Clothing Closet', 'Stairs to Roof', 'Floors 2, 3 & 4',
  'Stairs Down to Main', 'Perimeter Check',
]

// ── Helpers ─────────────────────────────────────────────────────────
function nowHHMM() {
  const n = new Date()
  return String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0')
}
function fmtTime(val) {
  if (!val) return ''
  const [h, m] = val.split(':')
  const hr = parseInt(h)
  return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`
}
function nowTS() {
  return fmtTime(nowHHMM())
}
function toMins(t) {
  if (!t) return 0
  const m = t.match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!m) return 0
  let h = parseInt(m[1]), mn = parseInt(m[2])
  const ap = m[3].toUpperCase()
  if (ap === 'AM' && h === 12) h = 0
  if (ap === 'PM' && h !== 12) h += 12
  return h * 60 + mn
}

// ── Mobile page ─────────────────────────────────────────────────────
export default function Mobile() {
  const { session, logout } = useAuth()
  const { hasPerm } = usePermission()

  const [activeTab, setActiveTab]       = useState('wellness') // wellness | walk | log | census
  const [clients, setClients]           = useState([])
  const [currentRpt, setCurrentRpt]     = useState(null) // local mirror of the active report
  const [facilityName, setFacilityName] = useState('OpsPoint')
  const [areas, setAreas]               = useState(DEFAULT_AREAS)
  const [wsConnected, setWsConnected]   = useState(false)
  const [toast, setToast]               = useState('')

  // Local wellness check state (cleared on log submit)
  const [checked, setChecked] = useState(() => new Set())
  const [missing, setMissing] = useState(() => new Set())
  // Local walk state — keyed by area name → '' | 'ok' | 'flag'
  const [walkState, setWalkState] = useState({})

  // Form inputs
  const [wcTime,  setWcTime]   = useState(nowHHMM())
  const [wcName,  setWcName]   = useState('')
  const [wcNotes, setWcNotes]  = useState('')
  const [wkTime,  setWkTime]   = useState(nowHHMM())
  const [wkBy,    setWkBy]     = useState('')
  const [wkNotes, setWkNotes]  = useState('')
  const [lgTime,  setLgTime]   = useState(nowHHMM())
  const [lgText,  setLgText]   = useState('')

  const wsRef        = useRef(null)
  const reconnectRef = useRef(null)
  const toastTimer   = useRef(null)
  const ownPatchRef  = useRef(null) // dedupe our own log entries when WS echoes back
  const activeIdRef  = useRef(null) // tracks reports.active_report_id from server

  // ── Toast ──────────────────────────────────────────────────────────
  const showToast = useCallback((msg) => {
    setToast(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2500)
  }, [])

  // ── Set active report (handles report change) ─────────────────────
  const setActiveReport = useCallback((rpt) => {
    if (!rpt) return
    setCurrentRpt(rpt)
    setChecked(new Set())
    setMissing(new Set())
  }, [])

  // ── Load settings + data ──────────────────────────────────────────
  const loadAll = useCallback(async () => {
    // Settings
    try {
      const sr = await fetch('/api/facility/settings', { credentials: 'include' })
      if (sr.ok) {
        const cfg = await sr.json()
        if (cfg.facility_name) setFacilityName(cfg.facility_name)
        if (Array.isArray(cfg.walk_areas) && cfg.walk_areas.length) setAreas(cfg.walk_areas)
      }
    } catch { /* empty */ }

    // Data
    try {
      const res = await fetch('/api/data', { credentials: 'include' })
      if (res.status === 401) { window.location.href = '/login'; return }
      if (!res.ok) { showToast('Server error: ' + res.status); return }
      const data = await res.json()
      const cls = data.clients || []
      const rps = data.reports || []
      setClients(cls)
      if (data.active_report_id !== undefined) activeIdRef.current = data.active_report_id

      const cCount = cls.filter(c => c.is_active && !c.is_special).length
      const rCount = rps.length
      if (rCount === 0 && cCount === 0) showToast('No data — is desktop app open?')
      else if (rCount === 0) showToast(`${cCount} clients. No reports yet.`)
      else showToast(`${cCount} clients, ${rCount} report(s) ✓`)

      const activeId = activeIdRef.current
      const rpt = activeId
        ? rps.find(r => r.id == activeId)
        : (rps.length > 0 ? rps.slice().sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))[0] : null)
      if (rpt) setActiveReport(rpt)
    } catch {
      showToast('Network error — check WiFi')
    }
  }, [showToast, setActiveReport])

  // ── WebSocket ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    let ws

    function connect() {
      try { ws = new WebSocket(proto + '//' + window.location.host) }
      catch { return }
      wsRef.current = ws

      ws.onopen = () => setWsConnected(true)
      ws.onclose = () => {
        setWsConnected(false)
        if (wsRef.current === ws) {
          reconnectRef.current = setTimeout(connect, 4000)
        }
      }
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg.type === 'settings_updated' && msg.settings) {
            const d = msg.settings
            if (d.facility_name) setFacilityName(d.facility_name)
            if (Array.isArray(d.walk_areas) && d.walk_areas.length) setAreas(d.walk_areas)
          } else if (msg.type === 'data_saved') {
            if (msg.active_report_id !== undefined) activeIdRef.current = msg.active_report_id
            loadAll()
          } else if (msg.type === 'patched' && msg.patch) {
            if (msg.active_report_id !== undefined) activeIdRef.current = msg.active_report_id
            setCurrentRpt(prev => {
              if (!prev || msg.patch.reportId != prev.id) return prev
              // Dedupe our own log entries
              if (ownPatchRef.current && msg.patch.log_entry && ownPatchRef.current === msg.patch.log_entry.text) {
                ownPatchRef.current = null
                return prev
              }
              ownPatchRef.current = null
              const updated = { ...prev }
              if (msg.patch.statuses) updated.statuses = { ...(prev.statuses || {}), ...msg.patch.statuses }
              if (msg.patch.log_entry) {
                const entries = [...(prev.log_entries || []), msg.patch.log_entry]
                entries.sort((a, b) => toMins(a.time) - toMins(b.time))
                updated.log_entries = entries
              }
              showToast('Updated from desktop')
              return updated
            })
          }
        } catch { /* empty */ }
      }
    }

    connect()
    return () => {
      clearTimeout(reconnectRef.current)
      wsRef.current = null
      try { ws?.close() } catch { /* empty */ }
    }
  }, [session, loadAll, showToast])

  // ── Initial load ──────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    loadAll()
  }, [session, loadAll])

  // ── Refresh time inputs every minute (so defaults stay current) ──
  useEffect(() => {
    const id = setInterval(() => {
      const t = nowHHMM()
      setWcTime(t); setWkTime(t); setLgTime(t)
    }, 60000)
    return () => clearInterval(id)
  }, [])

  // ── Active clients (filter once) ─────────────────────────────────
  const activeClients = useMemo(() =>
    clients.filter(c => c.is_active && !c.is_special && c.name !== 'VACANT'),
    [clients]
  )

  const statuses = currentRpt?.statuses || {}

  // ── Patch helper ─────────────────────────────────────────────────
  async function patchReport(patch) {
    if (!currentRpt) return
    patch.reportId = currentRpt.id
    // Optimistic update
    setCurrentRpt(prev => {
      if (!prev) return prev
      const next = { ...prev }
      if (patch.statuses) next.statuses = { ...(prev.statuses || {}), ...patch.statuses }
      if (patch.log_entry) {
        const entries = [...(prev.log_entries || []), patch.log_entry]
        entries.sort((a, b) => toMins(a.time) - toMins(b.time))
        next.log_entries = entries
      }
      return next
    })
    if (patch.log_entry) ownPatchRef.current = patch.log_entry.text
    try {
      const pr = await fetch('/api/data', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch),
      })
      if (pr.status === 401) { showToast('Session expired'); window.location.href = '/login' }
    } catch { showToast('Save error — check server') }
  }

  // ── Wellness: toggle ✓/✗ ─────────────────────────────────────────
  function toggleCheck(id) {
    if (checked.has(id)) {
      const c = new Set(checked); c.delete(id); setChecked(c)
      const m = new Set(missing); m.add(id); setMissing(m)
    } else if (missing.has(id)) {
      const m = new Set(missing); m.delete(id); setMissing(m)
    } else {
      const c = new Set(checked); c.add(id); setChecked(c)
    }
  }

  // ── UA request ───────────────────────────────────────────────────
  async function requestUA(client) {
    try {
      const r = await fetch('/api/ua-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ client_id: client.id, client_name: client.name, room: String(client.room) }),
      })
      if (r.ok) showToast(`UA request sent for Rm ${client.room} — ${client.name}`)
      else showToast('Failed to send UA request')
    } catch { showToast('Failed to send UA request') }
  }

  // ── Log Wellness Check ───────────────────────────────────────────
  async function logWellness() {
    if (!currentRpt) { showToast('No active report'); return }
    const name = wcName.trim() || 'PA'
    const ts = wcTime ? fmtTime(wcTime) : nowTS()
    const all = activeClients
    const missingList = [...missing].map(id => {
      const c = clients.find(x => x.id === id)
      return c ? `Rm ${c.room} ${c.name}` : ''
    }).filter(Boolean)
    let msg = `Wellness check conducted by ${name}. `
    msg += missingList.length
      ? `${all.length - missingList.length} of ${all.length} accounted for. Not located: ${missingList.join(', ')}.`
      : `All ${all.length} clients accounted for.`
    if (wcNotes.trim()) msg += ` Notes: ${wcNotes.trim()}`
    await patchReport({ log_entry: { time: ts, text: msg } })
    setChecked(new Set())
    setMissing(new Set())
    setWcNotes('')
    setWcTime(nowHHMM())
    showToast('Wellness check logged ✓')
  }

  // ── Walk toggle ──────────────────────────────────────────────────
  function tapWalk(area, state) {
    setWalkState(prev => ({
      ...prev,
      [area]: prev[area] === state ? '' : state,
    }))
  }

  // ── Log Walkthrough ──────────────────────────────────────────────
  async function logWalk() {
    if (!currentRpt) { showToast('No active report'); return }
    const by = wkBy.trim() || 'PA on duty'
    const ts = wkTime ? fmtTime(wkTime) : nowTS()
    const okAreas   = areas.filter(a => walkState[a] === 'ok')
    const flagAreas = areas.filter(a => walkState[a] === 'flag')
    if (!okAreas.length && !flagAreas.length) { showToast('Mark at least one location first'); return }
    let msg = `Building walkthrough conducted by ${by}. `
    if (!flagAreas.length) {
      msg += `All areas clear: ${okAreas.join(', ')}.`
    } else {
      if (okAreas.length) msg += `Clear: ${okAreas.join(', ')}. `
      msg += `Issues noted: ${flagAreas.join(', ')}.`
    }
    if (wkNotes.trim()) msg += ` Notes: ${wkNotes.trim()}`
    await patchReport({ log_entry: { time: ts, text: msg } })
    setWalkState({})
    setWkNotes('')
    setWkTime(nowHHMM())
    showToast('Walkthrough logged ✓')
  }

  // ── Add log entry ────────────────────────────────────────────────
  async function addLogEntry() {
    if (!currentRpt) { showToast('No active report'); return }
    if (!lgText.trim()) return
    const ts = lgTime ? fmtTime(lgTime) : nowTS()
    await patchReport({ log_entry: { time: ts, text: lgText.trim() } })
    setLgText('')
    setLgTime(nowHHMM())
    showToast('Entry added ✓')
  }

  // ── Census ───────────────────────────────────────────────────────
  const census = useMemo(() => {
    const cnt = { building: 0, work: 0, pass: 0, bhc: 0, efc: 0, hospital: 0, out: 0 }
    activeClients.forEach(c => {
      const st = statuses[c.id] || 'building'
      if (Object.hasOwn(cnt, st)) cnt[st]++
    })
    const tot = Object.values(cnt).reduce((a, b) => a + b, 0)
    return { cnt, tot }
  }, [activeClients, statuses])

  // ── Active report label ──────────────────────────────────────────
  const activeRptLabel = useMemo(() => {
    if (!currentRpt) return 'No active report — open desktop app'
    const dstr = currentRpt.report_date
      ? new Date(currentRpt.report_date + 'T12:00:00')
          .toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      : 'No date'
    return `${dstr} — ${currentRpt.shift || '?'} (MOD: ${currentRpt.mod_name || '?'})`
  }, [currentRpt])

  if (!session) return null

  return (
    <div className="mob">
      <style>{MOBILE_CSS}</style>

      {/* Toast */}
      <div className={`mob-toast${toast ? ' show' : ''}`}>{toast}</div>

      {/* Header — flex-shrink: 0, always visible */}
      <div className="mob-hdr">
        <div className="mob-hdr-top">
          <div className="mob-hdr-left">
            <img src="/static/icons/icon-192.png" alt="" className="mob-hdr-logo" />
            <div className="mob-hdr-info">
              <div className="mob-hdr-title">{facilityName}</div>
              <div className="mob-hdr-user">{session?.displayName || session?.username}</div>
            </div>
          </div>
          <div className="mob-hdr-right">
            <a href="/?desktop=1" className="mob-btn-tiny">Desktop</a>
            <button onClick={loadAll} className="mob-btn-tiny" title="Reload">↻</button>
            <button
              onClick={async () => { await logout(); window.location.href = '/login' }}
              className="mob-btn-tiny"
            >Out</button>
            <div
              className={`mob-dot${wsConnected ? '' : ' off'}`}
              title={wsConnected ? 'Live — connected' : 'Disconnected'}
            />
          </div>
        </div>
        <div className="mob-tabs">
          <button className={`mob-tab${activeTab === 'wellness' ? ' active' : ''}`} onClick={() => setActiveTab('wellness')}>✓ Wellness</button>
          <button className={`mob-tab${activeTab === 'walk' ? ' active' : ''}`}     onClick={() => setActiveTab('walk')}>🕐 Walk</button>
          <button className={`mob-tab${activeTab === 'log' ? ' active' : ''}`}      onClick={() => setActiveTab('log')}>📋 Log</button>
          <button className={`mob-tab${activeTab === 'census' ? ' active' : ''}`}   onClick={() => setActiveTab('census')}>📊 Census</button>
        </div>
      </div>

      {/* ── WELLNESS ───────────────────────────────────────── */}
      {activeTab === 'wellness' && (
        <div className="mob-panel">
          <div className="mob-rsel">
            <span className="mob-rsel-lbl">Active Report:</span>
            <span className="mob-rsel-val">{activeRptLabel}</span>
          </div>
          <div className="mob-scroll">
            {activeClients.length === 0
              ? <div className="mob-empty">No data — open desktop app first</div>
              : activeClients.map(c => {
                const st  = statuses[c.id] || 'building'
                const chk = checked.has(c.id)
                const mis = missing.has(c.id)
                return (
                  <div key={c.id} className="mob-card">
                    <span className="mob-rm">{c.room}</span>
                    <span className="mob-name">{c.name}</span>
                    <span className={`mob-status ${ST_CLS[st] || 's-building'}`}>{ST_LABELS[st] || st}</span>
                    {hasPerm('ua.request') && (
                      <button className="mob-ua-btn" onClick={() => requestUA(c)} title="Request UA">🧪</button>
                    )}
                    <button
                      className={`mob-chk${chk ? ' present' : mis ? ' missing' : ''}`}
                      onClick={() => toggleCheck(c.id)}
                    >{chk ? '✓' : mis ? '✗' : '○'}</button>
                  </div>
                )
              })
            }
          </div>
          <div className="mob-submit-bar">
            <div className="mob-row">
              <input type="time" value={wcTime} onChange={e => setWcTime(e.target.value)} />
              <input type="text" placeholder="Your name / initials" value={wcName} onChange={e => setWcName(e.target.value)} style={{ flex: 1 }} />
            </div>
            <textarea
              placeholder="Notes (optional) — anything unusual to report…"
              value={wcNotes}
              onChange={e => setWcNotes(e.target.value)}
            />
            <div className="mob-row">
              <button className="mob-btn-primary" onClick={logWellness} style={{ flex: 1 }}>✓ Log Wellness Check</button>
            </div>
          </div>
        </div>
      )}

      {/* ── WALK ───────────────────────────────────────────── */}
      {activeTab === 'walk' && (
        <div className="mob-panel">
          <div className="mob-scroll">
            {areas.map(a => {
              const state = walkState[a] || ''
              return (
                <div key={a} className={`mob-loc${state === 'ok' ? ' ok' : state === 'flag' ? ' flagged' : ''}`}>
                  <div className="mob-loc-name">{a}</div>
                  <div className="mob-loc-btns">
                    <button className={`mob-loc-btn${state === 'ok' ? ' ok' : ''}`}   onClick={() => tapWalk(a, 'ok')}   title="All clear">✓</button>
                    <button className={`mob-loc-btn${state === 'flag' ? ' flag' : ''}`} onClick={() => tapWalk(a, 'flag')} title="Issue noted">⚠</button>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mob-submit-bar">
            <div className="mob-row">
              <input type="time" value={wkTime} onChange={e => setWkTime(e.target.value)} />
              <input type="text" placeholder="Your name / initials" value={wkBy} onChange={e => setWkBy(e.target.value)} style={{ flex: 1 }} />
            </div>
            <textarea
              placeholder="Issues / notes (optional) — leave blank if all clear…"
              value={wkNotes}
              onChange={e => setWkNotes(e.target.value)}
            />
            <div className="mob-row">
              <button className="mob-btn-navy" onClick={logWalk} style={{ flex: 1 }}>🕐 Log Walkthrough</button>
            </div>
          </div>
        </div>
      )}

      {/* ── LOG ────────────────────────────────────────────── */}
      {activeTab === 'log' && (
        <div className="mob-panel">
          <div className="mob-scroll">
            {!currentRpt || !currentRpt.log_entries || currentRpt.log_entries.length === 0
              ? <div className="mob-empty">No log entries yet</div>
              : currentRpt.log_entries.map((e, i) => (
                <div key={i} className="mob-log-entry">
                  <span className="mob-log-ts">{e.time}</span>
                  <span className="mob-log-tx">{e.text}</span>
                </div>
              ))
            }
          </div>
          <div className="mob-submit-bar">
            <div className="mob-row">
              <input type="time" value={lgTime} onChange={e => setLgTime(e.target.value)} />
              <input
                type="text"
                placeholder="Add log entry…"
                value={lgText}
                onChange={e => setLgText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addLogEntry() }}
                style={{ flex: 1 }}
              />
            </div>
            <div className="mob-row">
              <button className="mob-btn-primary" onClick={addLogEntry} style={{ flex: 1 }}>+ Add Log Entry</button>
            </div>
          </div>
        </div>
      )}

      {/* ── CENSUS ─────────────────────────────────────────── */}
      {activeTab === 'census' && (
        <div className="mob-panel">
          <div className="mob-census mob-scroll">
            {!currentRpt
              ? <div className="mob-empty" style={{ gridColumn: 'span 2' }}>Select a report on the Wellness tab</div>
              : <>
                {Object.entries({ building: 'In Building', work: 'At Work', pass: 'Weekend Pass', bhc: 'BHC', efc: 'EFC', hospital: 'Hospital', out: 'Out/Other' })
                  .filter(([k]) => census.cnt[k] > 0)
                  .map(([k, lbl]) => (
                    <div key={k} className="mob-ccard">
                      <div className="mob-cnum">{census.cnt[k]}</div>
                      <div className="mob-clbl">{lbl}</div>
                    </div>
                  ))
                }
                <div className="mob-ccard total">
                  <div className="mob-cnum">{census.tot}</div>
                  <div className="mob-clbl">Total Clients</div>
                </div>
              </>
            }
          </div>
        </div>
      )}
    </div>
  )
}

// ── CSS (inlined — keeps mobile self-contained, won't bleed to desktop) ──
const MOBILE_CSS = `
/* Root: fill the #root flex column completely */
.mob{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f7f9;color:#1e293b;
  display:flex;flex-direction:column;height:100%;overflow:hidden;
  -webkit-tap-highlight-color:transparent;}
.mob *{box-sizing:border-box;}

.mob-toast{position:fixed;top:max(16px,env(safe-area-inset-top));left:50%;transform:translateX(-50%) translateY(-80px);background:#0f4c5c;color:#fff;padding:10px 20px;border-radius:8px;font-size:.88rem;font-weight:700;z-index:9999;transition:transform .3s;pointer-events:none;border-left:3px solid #f97316;}
.mob-toast.show{transform:translateX(-50%) translateY(0);}

/* Header: never shrinks */
.mob-hdr{background:#0f4c5c;color:#fff;flex-shrink:0;z-index:100;box-shadow:0 2px 10px rgba(0,0,0,.4);border-bottom:3px solid #f97316;}
.mob-hdr-top{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;}
.mob-hdr-left{min-width:0;flex:1;overflow:hidden;margin-right:10px;display:flex;align-items:center;gap:8px;}
.mob-hdr-logo{height:34px;width:34px;border-radius:8px;flex-shrink:0;box-shadow:0 2px 8px rgba(0,0,0,.4);}
.mob-hdr-info{min-width:0;flex:1;overflow:hidden;}
.mob-hdr-title{font-size:1.08rem;font-weight:800;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.mob-hdr-sub{font-size:.66rem;color:#cce8ef;letter-spacing:.08em;text-transform:uppercase;margin-top:1px;}
.mob-hdr-user{font-size:.62rem;color:#cce8ef;letter-spacing:.04em;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.mob-hdr-right{display:flex;align-items:center;gap:8px;flex-shrink:0;}
.mob-btn-tiny{background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:5px 10px;font-size:.72rem;font-weight:700;cursor:pointer;text-decoration:none;white-space:nowrap;font-family:inherit;}
.mob-btn-tiny:active{background:rgba(255,255,255,.15);}
.mob-dot{width:9px;height:9px;border-radius:50%;background:#4ade80;box-shadow:0 0 6px #4ade80;animation:mobpulse 2s infinite;flex-shrink:0;}
.mob-dot.off{background:#ef4444;box-shadow:0 0 6px #ef4444;animation:none;}
@keyframes mobpulse{0%,100%{opacity:1}50%{opacity:.35}}

.mob-tabs{display:flex;background:#0f4c5c;}
.mob-tab{flex:1;padding:10px 0;font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:rgba(255,255,255,.5);border:none;background:transparent;cursor:pointer;border-bottom:3px solid transparent;font-family:inherit;}
.mob-tab.active{color:#fff;border-bottom-color:#f97316;}

/* Panel: fills remaining height, flex-column, clips overflow */
.mob-panel{flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0;}

/* Scrollable content area within a panel */
.mob-scroll{flex:1;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;padding:8px 12px;}

.mob-rsel{padding:10px 14px;background:#fff;border-bottom:1px solid #E2E8F0;display:flex;gap:8px;align-items:center;flex-shrink:0;}
.mob-rsel-lbl{font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#4B5563;white-space:nowrap;}
.mob-rsel-val{font-size:.84rem;font-weight:700;color:#1a6b80;}

/* Client cards */
.mob-card{background:#fff;border-radius:10px;padding:12px 14px;margin-bottom:7px;box-shadow:0 1px 4px rgba(0,0,0,.08);display:flex;align-items:center;gap:10px;border:1px solid #E2E8F0;}
.mob-card:active{transform:scale(.98);transition:transform .1s;}
.mob-rm{font-size:.76rem;font-weight:700;color:#4B5563;font-family:SFMono-Regular,Consolas,monospace;min-width:32px;}
.mob-name{flex:1;font-size:.97rem;font-weight:700;color:#0F172A;}
.mob-status{font-size:.7rem;font-weight:700;padding:3px 9px;border-radius:20px;white-space:nowrap;}
.s-building{background:#d8f3dc;color:#14532d;}.s-work{background:#dbeafe;color:#1d4ed8;}
.s-pass{background:#fef9c3;color:#854d0e;}.s-bhc{background:#ede9fe;color:#6d28d9;}
.s-efc{background:#fce7f3;color:#be185d;}.s-hospital{background:#fee2e2;color:#991b1b;}
.s-out{background:#fff7ed;color:#9a3412;}.s-vacant{background:#f1f5f9;color:#94a3b8;}
.mob-chk{width:44px;height:44px;border-radius:50%;border:2.5px solid #E2E8F0;background:#fff;font-size:1.2rem;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s;}
.mob-chk.present{background:#1A5C42;border-color:#1A5C42;color:#fff;}
.mob-chk.missing{background:#C0392B;border-color:#C0392B;color:#fff;}
.mob-ua-btn{width:38px;height:38px;border-radius:50%;border:2px solid #C8500A;background:#fff3eb;font-size:1.1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.mob-ua-btn:active{background:#C8500A;}

/* Walk locations */
.mob-loc{background:#fff;border-radius:10px;padding:13px 14px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 1px 4px rgba(0,0,0,.07);border:1.5px solid #E2E8F0;}
.mob-loc.ok{background:#f0fdf4;border-color:#86efac;}
.mob-loc.flagged{background:#fee2e2;border-color:#fca5a5;}
.mob-loc-name{font-size:.97rem;font-weight:700;color:#0F172A;}
.mob-loc-btns{display:flex;gap:8px;}
.mob-loc-btn{width:44px;height:44px;border-radius:10px;border:1.5px solid #E2E8F0;background:#f8fafc;font-size:1.3rem;cursor:pointer;display:flex;align-items:center;justify-content:center;}
.mob-loc-btn.ok{background:#D8F3DC;border-color:#86efac;}
.mob-loc-btn.flag{background:#fee2e2;border-color:#fca5a5;}

/* Log entries */
.mob-log-entry{background:#fff;border-radius:8px;padding:10px 12px;margin-bottom:6px;display:flex;gap:10px;align-items:flex-start;box-shadow:0 1px 3px rgba(0,0,0,.06);border:1px solid #E2E8F0;}
.mob-log-ts{font-size:.74rem;font-weight:700;color:#1a6b80;min-width:62px;font-family:SFMono-Regular,Consolas,monospace;padding-top:1px;}
.mob-log-tx{font-size:.87rem;color:#0F172A;flex:1;line-height:1.4;}

.mob-empty{text-align:center;padding:40px;color:#4B5563;}

/* Census grid — inside mob-scroll so it also scrolls if needed */
.mob-census{display:grid;grid-template-columns:1fr 1fr;gap:10px;align-content:start;}
.mob-ccard{background:#fff;border-radius:12px;padding:16px;text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.08);border:1px solid #E2E8F0;}
.mob-cnum{font-size:2.3rem;font-weight:800;color:#0f4c5c;font-family:SFMono-Regular,Consolas,monospace;}
.mob-clbl{font-size:.7rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#4B5563;margin-top:4px;}
.mob-ccard.total{background:#0f4c5c;grid-column:span 2;border-color:#0f4c5c;}
.mob-ccard.total .mob-cnum,.mob-ccard.total .mob-clbl{color:#fff;}

/* Submit bar: normal flow at bottom of mob-panel, never fixed */
.mob-submit-bar{flex-shrink:0;background:#fff;border-top:2px solid #E2E8F0;
  padding:10px 14px;padding-bottom:max(10px,env(safe-area-inset-bottom));
  display:flex;flex-direction:column;gap:7px;box-shadow:0 -4px 16px rgba(28,10,16,.12);}
.mob-row{display:flex;gap:8px;align-items:center;}
.mob-submit-bar input[type=text]{flex:1;padding:10px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:.92rem;font-family:inherit;}
.mob-submit-bar input[type=time]{padding:10px 8px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:.88rem;font-family:SFMono-Regular,Consolas,monospace;width:105px;flex-shrink:0;}
.mob-submit-bar textarea{width:100%;padding:8px 12px;border:1.5px solid #E2E8F0;border-radius:8px;font-size:.88rem;font-family:inherit;resize:none;height:56px;line-height:1.4;}
.mob-submit-bar input:focus,.mob-submit-bar textarea:focus{border-color:#1a6b80;outline:none;}
.mob-btn-primary{padding:10px 16px;border-radius:8px;border:none;font-size:.86rem;font-weight:800;font-family:inherit;cursor:pointer;background:#0f4c5c;color:#fff;}
.mob-btn-primary:active{background:#1a6b80;}
.mob-btn-navy{padding:10px 16px;border-radius:8px;border:none;font-size:.86rem;font-weight:800;font-family:inherit;cursor:pointer;background:#163825;color:#fff;}
.mob-btn-navy:active{background:#0d2218;}
`
