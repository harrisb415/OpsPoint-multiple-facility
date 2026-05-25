import { useState, useEffect, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useData } from '../contexts/DataContext.jsx'
import { usePermission } from '../hooks/usePermission.js'
import ReportTab from './ReportTab.jsx'
import ArchiveTab from './tabs/ArchiveTab.jsx'
import ClientsTab from './tabs/ClientsTab.jsx'
import StaffTab from './tabs/StaffTab.jsx'
import ChoresTab from './tabs/ChoresTab.jsx'
import PassesTab from './tabs/PassesTab.jsx'
import CaseloadsTab from './tabs/CaseloadsTab.jsx'
import MailTab from './tabs/MailTab.jsx'
import UARequestsTab from './tabs/UARequestsTab.jsx'
import ViolationsTab from './tabs/ViolationsTab.jsx'

const ALL_TABS = [
  { id: 'report',     label: 'Report',      icon: '📋' },
  { id: 'archive',    label: 'Archive',     icon: '🗂️' },
  { id: 'clients',    label: 'Clients',     icon: '👥' },
  { id: 'staff',      label: 'Staff',       icon: '👤' },
  { id: 'chores',     label: 'Chores',      icon: '🧹' },
  { id: 'passes',     label: 'Passes',      icon: '🚪' },
  { id: 'caseloads',  label: 'Caseloads',   icon: '📂' },
  { id: 'mail',       label: 'Mail',        icon: '📬' },
  { id: 'ua',         label: 'UA Log',      icon: '🧪' },
  { id: 'violations', label: 'Infractions', icon: '⚠️' },
]

// ── UA Draw Modal ─────────────────────────────────────────────────────
function UADrawModal({ open, onClose, clients, statuses }) {
  const [method, setMethod]     = useState('smart') // 'random' | 'smart'
  const [lookback, setLookback] = useState(30)
  const [drawCount, setDrawCount] = useState(5)
  const [preview, setPreview]   = useState(null) // null | []
  const [poolInfo, setPoolInfo] = useState('')
  const [saving, setSaving]     = useState(false)
  const [err, setErr]           = useState('')

  const ABSENT = ['pass', 'work', 'hospital', 'out', 'bhc', 'efc']

  function buildPool(excludeIds) {
    return (clients || []).filter(c => {
      if (!c.is_active || c.is_special || c.name === 'VACANT') return false
      if (excludeIds && excludeIds.has(c.id)) return false
      const st = statuses?.[c.id] || 'building'
      return !ABSENT.includes(st)
    })
  }

  function shuffle(arr) {
    const a = arr.slice()
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  async function runPreview() {
    setErr('')
    let excludeIds = new Set()
    if (method === 'smart') {
      try {
        const r = await fetch(`/api/ua-draws/recent-clients?days=${lookback}`, { credentials: 'include' })
        const d = await r.json()
        excludeIds = new Set((d.ids || []).map(Number))
      } catch {}
    }
    const pool = buildPool(excludeIds)
    const totalPool = buildPool(new Set())
    const excluded = totalPool.length - pool.length
    let info = `📋 ${pool.length} of ${totalPool.length} residents eligible`
    if (method === 'smart' && excluded > 0) info += ` (${excluded} excluded — drawn within ${lookback} days)`
    if (pool.length < drawCount) info += ` — ⚠ only ${pool.length} available`
    setPoolInfo(info)
    if (pool.length === 0) { setPreview([]); return }
    const drawn = shuffle(pool).slice(0, Math.min(drawCount, pool.length)).map(c => ({ id: c.id, name: c.name, room: c.room }))
    setPreview(drawn)
  }

  async function confirmDraw() {
    if (!preview || preview.length === 0) return
    setSaving(true); setErr('')
    try {
      const r = await fetch('/api/ua-draws', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ residents: preview, method }),
      })
      if (!r.ok) { setErr('Draw failed'); return }
      onClose(); setPreview(null); setPoolInfo('')
    } catch { setErr('Network error') }
    finally { setSaving(false) }
  }

  function handleClose() { setPreview(null); setPoolInfo(''); setErr(''); onClose() }

  if (!open) return null
  return (
    <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && handleClose()}>
      <div className="modal" style={{ maxWidth: 500 }}>
        <div className="modal-head">
          <h2>🎲 Random UA Draw</h2>
          <button className="xbtn" onClick={handleClose}>&times;</button>
        </div>
        <div className="modal-body">
          {err && <div className="auth-error">{err}</div>}

          {/* Method selector */}
          <div className="field">
            <label>Method</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button type="button" onClick={() => setMethod('random')} style={{
                flex: 1, padding: '9px 0', borderRadius: 8, cursor: 'pointer', fontSize: '.85rem', fontWeight: 700,
                border: `2px solid ${method === 'random' ? 'var(--crimson)' : 'var(--line)'}`,
                background: method === 'random' ? 'var(--crimson)' : 'transparent',
                color: method === 'random' ? '#fff' : 'var(--steel)',
                transition: 'all .12s',
              }}>🎲 True Random</button>
              <button type="button" onClick={() => setMethod('smart')} style={{
                flex: 1, padding: '9px 0', borderRadius: 8, cursor: 'pointer', fontSize: '.85rem', fontWeight: 700,
                border: `2px solid ${method === 'smart' ? 'var(--crimson)' : 'var(--line)'}`,
                background: method === 'smart' ? 'var(--crimson)' : 'transparent',
                color: method === 'smart' ? '#fff' : 'var(--steel)',
                transition: 'all .12s',
              }}>🧠 Smart (exclude recent)</button>
            </div>
          </div>

          {method === 'smart' && (
            <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ whiteSpace: 'nowrap', marginBottom: 0 }}>Exclude if drawn within</label>
              <input type="number" value={lookback} min={1} max={365}
                onChange={e => setLookback(Math.min(365, Math.max(1, parseInt(e.target.value)||30)))}
                style={{ width: 60, padding: '4px 8px', border: '1.5px solid var(--line)', borderRadius: 5 }}
              />
              <span style={{ whiteSpace: 'nowrap', color: 'var(--steel)', fontSize: '.88rem' }}>days</span>
            </div>
          )}

          <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ marginBottom: 0 }}>Draw</label>
            <input type="number" value={drawCount} min={1} max={50}
              onChange={e => setDrawCount(Math.min(50, Math.max(1, parseInt(e.target.value)||5)))}
              style={{ width: 60, padding: '4px 8px', border: '1.5px solid var(--line)', borderRadius: 5 }}
            />
            <label style={{ marginBottom: 0 }}>residents</label>
          </div>

          {poolInfo && (
            <div style={{ fontSize: '.8rem', color: '#475569', background: '#f8fafc', border: '1px solid var(--line)', borderRadius: 6, padding: '7px 12px', marginBottom: 8 }}>
              {poolInfo}
            </div>
          )}

          {preview !== null && (
            preview.length === 0
              ? <div style={{ color: '#EF4444', fontSize: '.84rem' }}>No eligible residents in the pool.</div>
              : (
                <div style={{ border: '1.5px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ fontSize: '.74rem', fontWeight: 700, color: '#475569', padding: '8px 12px', background: '#f8fafc', borderBottom: '1px solid var(--line)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
                    {preview.length} residents selected
                  </div>
                  {preview.map((c, i) => (
                    <div key={c.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                      borderBottom: i < preview.length - 1 ? '1px solid var(--line)' : 'none',
                      background: '#fff',
                    }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '.75rem', fontWeight: 700, background: 'var(--sky)', color: 'var(--dark)', padding: '2px 8px', borderRadius: 10, minWidth: 50, textAlign: 'center' }}>
                        Rm {c.room}
                      </span>
                      <span style={{ fontWeight: 600, fontSize: '.88rem' }}>{c.name}</span>
                    </div>
                  ))}
                </div>
              )
          )}
        </div>
        <div className="modal-foot">
          <button className="btn-cancel" onClick={handleClose}>Cancel</button>
          {preview === null || preview.length === 0
            ? <button className="btn btn-primary" onClick={runPreview}>Preview Draw</button>
            : (
              <>
                <button className="btn btn-sm" style={{ background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--steel)' }} onClick={() => { setPreview(null); setPoolInfo('') }}>Re-draw</button>
                <button className="btn btn-primary" onClick={confirmDraw} disabled={saving}>{saving ? 'Sending…' : 'Confirm & Send'}</button>
              </>
            )
          }
        </div>
      </div>
    </div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────
export default function Dashboard() {
  const [activeTab, setActiveTab]     = useState('report')
  const [drawOpen, setDrawOpen]       = useState(false)
  const { hasPerm }                   = usePermission()
  const { loading, data }             = useData()
  const outletCtx                     = useOutletContext() || {}
  const { requestedTab, clearRequestedTab } = outletCtx

  // UI visibility settings from server
  const uiVis = useMemo(() => {
    const def = { tabs: {}, buttons: {} }
    if (!data?.ui_visibility) return def
    try { return typeof data.ui_visibility === 'string' ? JSON.parse(data.ui_visibility) : data.ui_visibility }
    catch { return def }
  }, [data?.ui_visibility])

  // Handle cross-component tab navigation (e.g. from notification panel "View violations")
  useEffect(() => {
    if (requestedTab) { setActiveTab(requestedTab); clearRequestedTab() }
  }, [requestedTab, clearRequestedTab])

  // Current statuses for UA draw pool
  const activeReport  = data?.reports?.find(r => r.id === data?.active_report_id)
  const statuses      = activeReport?.statuses || {}
  const clients       = data?.clients || []

  function isTabVisible(id) {
    const key = id === 'violations' ? 'infractions' : id
    if (uiVis.tabs && Object.keys(uiVis.tabs).length > 0) {
      if (uiVis.tabs[key] === false) return false
    }
    return true
  }

  const visibleTabs = ALL_TABS.filter(t => {
    if (t.perm  && !hasPerm(t.perm)) return false
    if (t.perms && !t.perms.some(p => hasPerm(p))) return false
    if (!isTabVisible(t.id)) return false
    return true
  })

  if (loading) {
    return (
      <div style={{ display: 'flex', flex: 1 }}>
        <nav className="tabs">
          {ALL_TABS.map(t => (
            <button key={t.id} className="tab">
              <span className="tab-icon">{t.icon}</span>
              <span className="tab-label">{t.label}</span>
            </button>
          ))}
        </nav>
        <main className="container">
          <div className="section">
            <div className="section-head"><div className="sh-left"><span className="sh-dot" />Loading…</div></div>
            <div className="section-body">
              <div className="skeleton-block" style={{ height: 24, marginBottom: 10 }} />
              <div className="skeleton-block" style={{ height: 24, width: '60%', marginBottom: 10 }} />
              <div className="skeleton-block" style={{ height: 24, width: '80%' }} />
            </div>
          </div>
        </main>
      </div>
    )
  }

  const active = visibleTabs.find(t => t.id === activeTab) || visibleTabs[0]

  return (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <nav className="tabs" aria-label="Main navigation">
        {visibleTabs.map(t => (
          <button
            key={t.id}
            className={`tab${active?.id === t.id ? ' active' : ''}`}
            onClick={() => setActiveTab(t.id)}
            aria-current={active?.id === t.id ? 'page' : undefined}
          >
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
          </button>
        ))}
        {/* UA Draw button in sidebar */}
        {hasPerm('ua.draw') && (
          <button
            className="tab"
            onClick={() => setDrawOpen(true)}
            title="Random UA Draw"
            style={{ marginTop: 'auto', borderTop: '1px solid rgba(255,255,255,.1)' }}
          >
            <span className="tab-icon">🎲</span>
            <span className="tab-label">UA Draw</span>
          </button>
        )}
      </nav>
      <main className="container" role="main">
        {active?.id === 'report'     && <ReportTab onNavigate={setActiveTab} />}
        {active?.id === 'archive'    && <ArchiveTab />}
        {active?.id === 'clients'    && <ClientsTab />}
        {active?.id === 'staff'      && <StaffTab />}
        {active?.id === 'chores'     && <ChoresTab />}
        {active?.id === 'passes'     && <PassesTab />}
        {active?.id === 'caseloads'  && <CaseloadsTab />}
        {active?.id === 'mail'       && <MailTab />}
        {active?.id === 'ua'         && <UARequestsTab />}
        {active?.id === 'violations' && <ViolationsTab />}
      </main>

      <UADrawModal
        open={drawOpen}
        onClose={() => setDrawOpen(false)}
        clients={clients}
        statuses={statuses}
      />
    </div>
  )
}
