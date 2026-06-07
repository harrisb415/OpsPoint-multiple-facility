import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from './AuthContext.jsx'

const DataContext = createContext(null)

// Default notification state shape
const NOTIF_DEFAULT = {
  uaRequests:      [],   // pending UA requests
  uaDraws:         [],   // recent draws (last 30 days)
  broadcasts:      [],   // active broadcasts (not dismissed)
  violReview:      0,    // # violations pending review
  violConsequence: 0,    // # violations with consequence assigned
  incidents:       [],   // new incident alerts (dismissed per session)
}

export function DataProvider({ children }) {
  const [data, setData]               = useState(null)
  const [loading, setLoading]         = useState(true)
  const [saveStatus, setSaveStatus]   = useState('idle') // idle | saving | saved | err
  const [notif, setNotif]             = useState(NOTIF_DEFAULT)
  const [serverRestarting, setServerRestarting] = useState(false)
  const [wsConnected, setWsConnected] = useState(false)
  const [profileClientId, setProfileClientId] = useState(null)

  const wsRef         = useRef(null)
  const seenUAIds     = useRef(new Set())
  const dismissedBCIds = useRef(new Set())
  const { session }   = useAuth()

  // ── Broadcast dismiss localStorage helpers ────────────────────────
  const bcKey = useCallback(() =>
    'sp_dis_bc_' + (session?.username || ''), [session])

  const loadDismissed = useCallback(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(bcKey()) || '[]')
      dismissedBCIds.current = new Set(saved.map(Number))
    } catch { dismissedBCIds.current = new Set() }
  }, [bcKey])

  const saveDismissed = useCallback(() => {
    try { localStorage.setItem(bcKey(), JSON.stringify(Array.from(dismissedBCIds.current))) }
    catch { /* localStorage unavailable — ignore */ }
  }, [bcKey])

  const dismissBroadcast = useCallback((id) => {
    dismissedBCIds.current.add(parseInt(id))
    saveDismissed()
    setNotif(prev => ({ ...prev, broadcasts: prev.broadcasts.filter(b => b.id !== parseInt(id)) }))
  }, [saveDismissed])

  const dismissIncident = useCallback((id) => {
    setNotif(prev => ({ ...prev, incidents: prev.incidents.filter(i => i.id !== parseInt(id)) }))
  }, [])

  // ── Client profile drawer ─────────────────────────────────────────
  const openProfile = useCallback((clientId) => {
    setProfileClientId(clientId)
    // Fire-and-forget HIPAA audit log — profile drawer open is a PHI access event
    fetch(`/api/clients/${clientId}/profile`, { credentials: 'include' }).catch(() => {})
  }, [])

  const closeProfile = useCallback(() => {
    setProfileClientId(null)
  }, [])

  // ── Structured Clinical Lite fetch ─────────────────────────────────
  // Parallel-fetches the 5 clinical endpoints. Endpoints the user lacks
  // permission for return 403 → treated as []. Returns a slice object that
  // merges into `data` (single source of truth, consistent with the rest of
  // the app's load-and-refresh model).
  const fetchClinical = useCallback(async () => {
    const eps = [
      ['clinical_notes',      '/api/clinical/notes'],
      ['treatment_plans',     '/api/clinical/treatment-plans'],
      ['assessments',         '/api/clinical/assessments'],
      ['group_notes',         '/api/clinical/group-notes'],
      ['discharge_summaries', '/api/clinical/discharge-summaries'],
    ]
    const results = await Promise.all(eps.map(async ([key, url]) => {
      try {
        const r = await fetch(url, { credentials: 'include' })
        return [key, r.ok ? await r.json() : []]
      } catch { return [key, []] }
    }))
    return Object.fromEntries(results)
  }, [])

  // ── Data load ─────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    try {
      const [dataRes, mailRes, uaRes, uaRecRes, medRes, mileRes, incRes, disRes] = await Promise.all([
        fetch('/api/data',              { credentials: 'include' }),
        fetch('/api/mail',              { credentials: 'include' }),
        fetch('/api/ua-requests',       { credentials: 'include' }),
        fetch('/api/ua-records',        { credentials: 'include' }),
        fetch('/api/med-log',           { credentials: 'include' }),
        fetch('/api/milestones',        { credentials: 'include' }),
        fetch('/api/incidents',         { credentials: 'include' }),
        fetch('/api/discharge-records', { credentials: 'include' }),
      ])
      if (!dataRes.ok) throw new Error('Failed to load data')
      const [base, mail, ua_requests, ua_records, med_log, milestones, incidents, discharge_records] = await Promise.all([
        dataRes.json(),
        mailRes.ok   ? mailRes.json()   : [],
        uaRes.ok     ? uaRes.json()     : [],
        uaRecRes.ok  ? uaRecRes.json()  : [],
        medRes.ok    ? medRes.json()    : [],
        mileRes.ok   ? mileRes.json()   : [],
        incRes.ok    ? incRes.json()    : [],
        disRes.ok    ? disRes.json()    : [],
      ])
      const clinical = await fetchClinical()
      setData({ ...base, mail, ua_requests, ua_records, med_log, milestones, incidents, discharge_records, ...clinical })

      // Seed seen UA IDs so we don't re-fire sounds for already-known requests
      seenUAIds.current = new Set((ua_requests || []).map(r => r.id))
      setNotif(prev => ({ ...prev, uaRequests: ua_requests || [] }))
    } catch {
      // keep stale data on reload failure
    } finally {
      setLoading(false)
    }
  }, [fetchClinical])

  // Refresh only the clinical slices (used after a clinical mutation) without
  // re-pulling the entire dataset.
  const refreshClinical = useCallback(async () => {
    const clinical = await fetchClinical()
    setData(prev => prev ? { ...prev, ...clinical } : prev)
  }, [fetchClinical])

  // Load notification-only data (draws + broadcasts) once on session start
  const loadNotifData = useCallback(async () => {
    loadDismissed()
    const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
    const [drawsRes, bcRes] = await Promise.all([
      fetch(`/api/ua-draws?since=${since}`, { credentials: 'include' }),
      fetch('/api/broadcasts',              { credentials: 'include' }),
    ])
    const draws     = drawsRes.ok  ? await drawsRes.json() : []
    const bcsRaw    = bcRes.ok     ? await bcRes.json()    : []
    const broadcasts = bcsRaw.filter(b => !dismissedBCIds.current.has(b.id))
    setNotif(prev => ({ ...prev, uaDraws: draws, broadcasts }))
  }, [loadDismissed])

  useEffect(() => {
    if (!session) return
    loadData()
    loadNotifData()
  }, [session, loadData, loadNotifData])

  // ── WebSocket ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return
    const backendSecure = import.meta.env.VITE_BACKEND_HTTPS !== 'false'
    const proto = import.meta.env.DEV
      ? (backendSecure ? 'wss' : 'ws')
      : (window.location.protocol === 'https:' ? 'wss' : 'ws')
    const host = import.meta.env.DEV ? 'localhost:3000' : window.location.host
    let ws
    let reconnectTimer

    function connect() {
      ws = new WebSocket(`${proto}://${host}`)
      wsRef.current = ws

      ws.onopen = () => {
        setWsConnected(true)
      }
      ws.onmessage = (evt) => {
        try { handleMessage(JSON.parse(evt.data)) } catch { /* ignore malformed message */ }
      }
      ws.onclose = () => {
        setWsConnected(false)
        if (wsRef.current === ws) {
          reconnectTimer = setTimeout(connect, 4000)
        }
      }
    }

    // Helper: check a session permission. Sound + banner notifications are gated by these
    // so users without the relevant permission don't hear sounds or see toasts for events
    // they aren't supposed to track.
    function _hasSessionPerm(perm) {
      return Array.isArray(session?.permissions) && session.permissions.includes(perm)
    }

    function handleMessage(msg) {
      switch (msg.type) {
        case 'data_saved':
        case 'staff_updated':
        case 'passes_updated':
        case 'chore_log_updated':
        case 'mail_updated':
        case 'pass_notice_updated':
        case 'permissions_updated':
        case 'settings_updated':
        case 'ua_records_updated':
        case 'med_log_updated':
        case 'milestones_updated':
        case 'incidents_updated':
        case 'discharge_records_updated':
        // ── Structured Clinical Lite (create/update/sign/delete × 5 entities); all fall through to loadData() ──
        case 'clinical_note_created':     case 'clinical_note_updated':
        case 'clinical_note_signed':      case 'clinical_note_deleted':
        case 'treatment_plan_created':    case 'treatment_plan_updated':
        case 'treatment_plan_signed':     case 'treatment_plan_deleted':
        case 'assessment_created':        case 'assessment_updated':
        case 'assessment_signed':         case 'assessment_deleted':
        case 'group_note_created':        case 'group_note_updated':
        case 'group_note_signed':         case 'group_note_deleted':
        case 'discharge_summary_created': case 'discharge_summary_updated':
        case 'discharge_summary_signed':  case 'discharge_summary_deleted':
          loadData()
          break

        case 'patched':
          applyPatch(msg.patch)
          break

        case 'ua_request': {
          const requests = msg.requests || []
          const hasNew   = requests.some(r => !seenUAIds.current.has(r.id))
          seenUAIds.current = new Set(requests.map(r => r.id))
          setNotif(prev => ({ ...prev, uaRequests: requests }))
          setData(prev => prev ? { ...prev, ua_requests: requests } : prev)
          // Only the people who can act on UA requests should hear the sound
          if (hasNew && _hasSessionPerm('ua.acknowledge')) playSound('ua')
          break
        }

        case 'ua_draw_created': {
          if (msg.draw) {
            setNotif(prev => {
              const draws = prev.uaDraws.filter(d => d.id !== msg.draw.id)
              draws.push(msg.draw)
              return { ...prev, uaDraws: draws }
            })
          }
          if (msg.requests) {
            // Mark newly drawn requests as seen so ua_request WS doesn't double-fire
            ;(msg.requests || []).forEach(r => seenUAIds.current.add(r.id))
            setNotif(prev => ({ ...prev, uaRequests: msg.requests }))
          }
          if (_hasSessionPerm('ua.acknowledge')) playSound('ua')
          break
        }

        case 'broadcast_message': {
          if (msg.message && !dismissedBCIds.current.has(msg.message.id) && _hasSessionPerm('broadcast.receive')) {
            setNotif(prev => ({
              ...prev,
              broadcasts: [msg.message, ...prev.broadcasts.filter(b => b.id !== msg.message.id)],
            }))
            playSound('broadcast')
          }
          break
        }

        case 'violations_updated': {
          const review      = msg.pendingReview      || 0
          const consequence = msg.pendingConsequences || 0
          setNotif(prev => {
            const wasReview = prev.violReview
            const wasConsq  = prev.violConsequence
            if (review > wasReview && wasReview >= 0      && _hasSessionPerm('violations.notify_review'))      playSound('violation-review')
            if (consequence > wasConsq && wasConsq >= 0   && _hasSessionPerm('violations.notify_consequence')) playSound('violation-consequence')
            return { ...prev, violReview: review, violConsequence: consequence }
          })
          break
        }

        case 'incident_notification': {
          if (msg.incident && _hasSessionPerm('incidents.review')) {
            setNotif(prev => ({
              ...prev,
              incidents: [msg.incident, ...prev.incidents.filter(i => i.id !== msg.incident.id)],
            }))
            playSound('violation-review')
          }
          break
        }

        case 'server_restarting':
          setServerRestarting(true)
          setTimeout(() => window.location.reload(), 5000)
          break
      }
    }

    function applyPatch(patch) {
      if (!patch) return
      setData(prev => {
        if (!prev) return prev
        const reports = prev.reports.map(r => {
          if (r.id !== patch.reportId) return r
          let updated = { ...r }
          if (patch.statuses)
            updated.statuses = { ...r.statuses, ...patch.statuses }
          if (patch.log_entry)
            updated.log_entries = [...(r.log_entries || []), patch.log_entry]
          if (patch.shiftData) {
            if (patch.shiftData.report_date) updated.report_date = patch.shiftData.report_date
            if (patch.shiftData.shift)       updated.shift       = patch.shiftData.shift
            if (patch.shiftData.mod_name != null) updated.mod_name = patch.shiftData.mod_name
          }
          if (patch.issues    !== undefined) updated.issues    = patch.issues
          if (patch.med_notes !== undefined) updated.med_notes = patch.med_notes
          if (patch.last_ua   !== undefined) updated.last_ua   = { ...(r.last_ua || {}), ...patch.last_ua }
          if (patch.last_room_search !== undefined) updated.last_room_search = { ...(r.last_room_search || {}), ...patch.last_room_search }
          return updated
        })
        return { ...prev, reports }
      })
    }

    connect()
    return () => {
      clearTimeout(reconnectTimer)
      wsRef.current = null
      ws?.close()
    }
  }, [session, loadData])

  // ── HIPAA idle session timeout: poll heartbeat ────────────────────
  // Server enforces idle expiry; client polls to detect it quickly and
  // surface a "session expired" prompt instead of a silent 401 loop.
  const [sessionExpired, setSessionExpired] = useState(false)
  useEffect(() => {
    if (!session) return
    let cancelled = false
    async function check() {
      if (cancelled) return
      try {
        const r = await fetch('/api/heartbeat', { credentials:'include' })
        if (r.status === 401 && !cancelled) setSessionExpired(true)
      } catch { /* heartbeat network error — retry next tick */ }
    }
    const id = setInterval(check, 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [session])

  // ── Save / Patch ───────────────────────────────────────────────────
  const saveData = useCallback(async (payload) => {
    setSaveStatus('saving')
    try {
      const r = await fetch('/api/data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      if (!r.ok) throw new Error()
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
      return true
    } catch {
      setSaveStatus('err')
      return false
    }
  }, [])

  const patchData = useCallback(async (patch) => {
    setSaveStatus('saving')
    try {
      const r = await fetch('/api/data', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch),
      })
      if (!r.ok) throw new Error()
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
      return true
    } catch {
      setSaveStatus('err')
      return false
    }
  }, [])

  return (
    <DataContext.Provider value={{
      data, loading, saveStatus, notif, serverRestarting, wsConnected,
      loadData, saveData, patchData, setData,
      dismissBroadcast, dismissIncident,
      profileClientId, openProfile, closeProfile,
      sessionExpired,
      // ── Structured Clinical Lite ──
      clinicalNotes:      data?.clinical_notes      || [],
      treatmentPlans:     data?.treatment_plans     || [],
      assessments:        data?.assessments         || [],
      groupNotes:         data?.group_notes         || [],
      dischargeSummaries: data?.discharge_summaries || [],
      refresh: loadData,
      refreshClinical,
    }}>
      {children}
      {sessionExpired && (
        <div style={{
          position:'fixed', inset:0, background:'rgba(15,23,42,.65)',
          display:'flex', alignItems:'center', justifyContent:'center', zIndex:5000,
        }}>
          <div style={{
            background:'#fff', borderRadius:12, padding:'24px 28px', maxWidth:420,
            boxShadow:'0 20px 60px rgba(0,0,0,.4)',
          }}>
            <h2 style={{ marginTop:0, color:'#7c2d12' }}>Session expired</h2>
            <p style={{ fontSize:'.92em', color:'#475569' }}>
              You were signed out automatically after a period of inactivity (HIPAA technical safeguard).
              Please sign in again to continue.
            </p>
            <div style={{ marginTop:14, textAlign:'right' }}>
              <button className="btn btn-primary"
                onClick={() => { window.location.href = '/login' }}>
                Sign in again
              </button>
            </div>
          </div>
        </div>
      )}
    </DataContext.Provider>
  )
}

export function useData() {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData must be used within DataProvider')
  return ctx
}

// ── Web Audio sounds (no external files) ──────────────────────────────
let _audioCtx = null
function _getAudioCtx() {
  if (_audioCtx) return _audioCtx
  try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)() } catch { /* Web Audio unsupported */ }
  return _audioCtx
}
// Warm up on first interaction
if (typeof window !== 'undefined') {
  window.addEventListener('click',   () => _getAudioCtx(), { once: true })
  window.addEventListener('keydown', () => _getAudioCtx(), { once: true })
}

function _beep(ctx, freq, delay, dur, wave, vol) {
  try {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.connect(g); g.connect(ctx.destination)
    o.type = wave || 'sine'
    o.frequency.value = freq
    g.gain.setValueAtTime(vol || 0.3, ctx.currentTime + delay)
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + dur)
    o.start(ctx.currentTime + delay)
    o.stop(ctx.currentTime + delay + dur + 0.05)
  } catch { /* audio node failure — ignore */ }
}

export function playSound(type) {
  const ctx = _getAudioCtx(); if (!ctx) return
  try {
    if (type === 'ua') {
      _beep(ctx, 900, 0,   .08, 'square', .25)
      _beep(ctx, 900, .12, .08, 'square', .25)
      _beep(ctx, 900, .24, .08, 'square', .25)
    } else if (type === 'violation-review') {
      _beep(ctx, 660, 0,  .18, 'sine', .3)
      _beep(ctx, 440, .2, .28, 'sine', .3)
    } else if (type === 'violation-consequence') {
      _beep(ctx, 440, 0,  .18, 'sine', .3)
      _beep(ctx, 554, .2, .28, 'sine', .3)
    } else if (type === 'broadcast') {
      _beep(ctx, 523, 0,  .15, 'sine', .22)
      _beep(ctx, 659, .2, .25, 'sine', .22)
    }
  } catch { /* audio playback failure — ignore */ }
}
