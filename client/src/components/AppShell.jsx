import { useState, useMemo, useRef, useEffect } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'
import { usePermission } from '../hooks/usePermission.js'
import { DataProvider, useData } from '../contexts/DataContext.jsx'
import { CLINICAL_SECTION_PERMS } from '../pages/clinical/clinicalShared.jsx'
import ClientProfile from './ClientProfile.jsx'
import JSZip from 'jszip'
import {
  Users, UserCheck, ClipboardList,
  FileText, CheckSquare, Ticket, Mail, CalendarCheck,
  FlaskConical, Pill,
  Ban, PenLine, Archive,
  Dice5, Bell, Megaphone, Settings, Info, Shield, LogOut, Footprints, HeartPulse, Stethoscope,
  Moon, Sun, MoreHorizontal, LayoutDashboard, Search,
} from 'lucide-react'

// ── Sidebar group config ──────────────────────────────────────────────
const SIDEBAR_GROUPS = [
  {
    label: 'PEOPLE',
    items: [
      { id: 'clients',    label: 'Clients',    Icon: Users },
      { id: 'staff',      label: 'Staff',      Icon: UserCheck },
      { id: 'caseloads',  label: 'Caseloads',  Icon: ClipboardList },
    ]
  },
  {
    label: 'DAILY OPS',
    items: [
      { id: 'report',     label: 'Report',     Icon: FileText },
      { id: 'chores',     label: 'Chores',     Icon: CheckSquare },
      { id: 'groups',     label: 'Groups',     Icon: CalendarCheck, perm: 'groups.view' },
      { id: 'passes',     label: 'Passes',     Icon: Ticket },
      { id: 'mail',       label: 'Mail',       Icon: Mail },
    ]
  },
  {
    label: 'HEALTH & COMPLIANCE',
    items: [
      { id: 'ua',         label: 'UA',         Icon: FlaskConical },
      { id: 'med_log',    label: 'Med Log',    Icon: Pill,   perm: 'med.witness' },
    ]
  },
  {
    label: 'RECORDS',
    items: [
      { id: 'violations', label: 'Infractions',      Icon: Ban },
      { id: 'consent',    label: 'Consents',   Icon: PenLine, perm: 'consent.manage' },
      { id: 'archive',    label: 'Archive',    Icon: Archive },
    ]
  },
]

// ── Notification time-ago helper ──────────────────────────────────────
function timeAgo(ts) {
  if (!ts) return ''
  const t   = new Date(ts.replace ? ts.replace(' ', 'T') + 'Z' : ts)
  const sec = Math.floor((Date.now() - t.getTime()) / 1000)
  if (sec < 60)    return 'just now'
  if (sec < 3600)  return Math.floor(sec / 60) + 'm ago'
  if (sec < 86400) return Math.floor(sec / 3600) + 'h ago'
  return Math.floor(sec / 86400) + 'd ago'
}

function esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

// ── Notification Panel ────────────────────────────────────────────────
function NotifPanel({ open, onClose, notif, session, dismissBroadcast, dismissIncident, onAckUA, onGoTab, dismissedDrawIds, dismissDraw, dismissedViolReview, dismissedViolConsequence, dismissViolReview, dismissViolConsequence }) {
  const perm = session?.permissions || []

  const draws24h = (notif.uaDraws || []).filter(d => {
    const ts = d.created_at ? new Date(d.created_at.replace(' ', 'T') + 'Z').getTime() : 0
    return ts >= Date.now() - 24 * 3600000 && !dismissedDrawIds?.has(d.id)
  })

  const SEV_COLOR = { low:'#1e40af', medium:'#92400e', high:'#9a3412', critical:'#7c2d12' }
  const SEV_BG    = { low:'#dbeafe', medium:'#fef3c7', high:'#fee2e2', critical:'#fce7f3' }

  const hasAny =
    (notif.uaRequests.length > 0 && perm.includes('ua.acknowledge'))
    || (draws24h.length > 0 && (perm.includes('ua.draw') || perm.includes('ua.acknowledge')))
    || (notif.violReview > 0 && perm.includes('violations.notify_review'))
    || (notif.violConsequence > 0 && perm.includes('violations.notify_consequence'))
    || (notif.broadcasts.length > 0 && perm.includes('broadcast.receive'))
    || ((notif.incidents || []).length > 0 && perm.includes('incidents.review'))

  return (
    <>
      <div className={`notif-overlay${open ? ' open' : ''}`} onClick={onClose} />
      <div className={`notif-panel${open ? ' open' : ''}`}>
        <div className="notif-panel-head">
          <span>Notifications</span>
          <button className="xbtn" style={{ color: '#fff' }} onClick={onClose}>✕</button>
        </div>
        <div className="notif-panel-body">

          {notif.uaRequests.length > 0 && perm.includes('ua.acknowledge') && (
            <div className="notif-section">
              <div className="notif-section-head">
                UA Requests
                <span className="notif-badge-sm">{notif.uaRequests.length}</span>
              </div>
              {notif.uaRequests.map(r => (
                <div key={r.id} className="notif-item">
                  <span className="notif-item-icon">🧪</span>
                  <div className="notif-item-body">
                    <div className="notif-item-name">{r.interview_name || r.client_name || 'Interview'}</div>
                    <div className="notif-item-meta">{r.room ? `Rm. ${r.room} · ` : ''}{timeAgo(r.requested_at)}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <button className="notif-item-action" onClick={() => onAckUA(r.id)}>✔ Ack</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {draws24h.length > 0 && (perm.includes('ua.draw') || perm.includes('ua.acknowledge')) && (
            <div className="notif-section">
              <div className="notif-section-head">
                UA Draws (24h)
                <span className="notif-badge-sm">{draws24h.length}</span>
              </div>
              {draws24h.map(d => {
                const cnt = Array.isArray(d.residents) ? d.residents.length : 0
                return (
                  <div key={d.id} className="notif-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}>
                    <div style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8 }}>
                      <span className="notif-item-icon">📋</span>
                      <div className="notif-item-body">
                        <div className="notif-item-name">{cnt} resident{cnt !== 1 ? 's' : ''} drawn</div>
                        <div className="notif-item-meta">By {d.drawn_by_name || 'Staff'} · {timeAgo(d.created_at)}</div>
                      </div>
                      {dismissDraw && (
                        <button className="notif-item-action" onClick={() => dismissDraw(d.id)} title="Dismiss">✕</button>
                      )}
                    </div>
                    {Array.isArray(d.residents) && d.residents.length > 0 && (
                      <div style={{ fontSize: '11px', color: '#475569', paddingLeft: 32 }}>
                        {d.residents.slice(0, 5).map(r => `Rm.${r.room} ${r.name}`).join(', ')}
                        {d.residents.length > 5 ? '…' : ''}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {notif.violReview > 0 && notif.violReview > (dismissedViolReview || 0) && perm.includes('violations.notify_review') && (
            <div className="notif-section">
              <div className="notif-section-head">
                Infractions: Pending Review
                <span className="notif-badge-sm">{notif.violReview}</span>
              </div>
              <div className="notif-item">
                <span className="notif-item-icon">⚠️</span>
                <div className="notif-item-body">
                  <div className="notif-item-name">{notif.violReview} violation{notif.violReview !== 1 ? 's' : ''} awaiting review</div>
                  <div className="notif-item-meta">Case conference needed</div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button className="notif-item-action" onClick={() => { onGoTab('violations'); onClose() }}>View</button>
                  <button className="notif-item-action" onClick={() => dismissViolReview(notif.violReview)} title="Dismiss">✕</button>
                </div>
              </div>
            </div>
          )}

          {notif.violConsequence > 0 && notif.violConsequence > (dismissedViolConsequence || 0) && perm.includes('violations.notify_consequence') && (
            <div className="notif-section">
              <div className="notif-section-head">
                Consequence Assigned
                <span className="notif-badge-sm">{notif.violConsequence}</span>
              </div>
              <div className="notif-item">
                <span className="notif-item-icon">📌</span>
                <div className="notif-item-body">
                  <div className="notif-item-name">{notif.violConsequence} consequence{notif.violConsequence !== 1 ? 's' : ''} need completion</div>
                  <div className="notif-item-meta">Action required</div>
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <button className="notif-item-action" onClick={() => { onGoTab('violations'); onClose() }}>View</button>
                  <button className="notif-item-action" onClick={() => dismissViolConsequence(notif.violConsequence)} title="Dismiss">✕</button>
                </div>
              </div>
            </div>
          )}

          {(notif.incidents || []).length > 0 && perm.includes('incidents.review') && (
            <div className="notif-section">
              <div className="notif-section-head">
                New Incident Reports
                <span className="notif-badge-sm">{notif.incidents.length}</span>
              </div>
              {notif.incidents.map(inc => (
                <div key={inc.id} className="notif-item">
                  <span className="notif-item-icon">🚨</span>
                  <div className="notif-item-body">
                    <div className="notif-item-name">
                      {inc.client_name}{inc.room ? ` · Rm. ${inc.room}` : ''}
                    </div>
                    <div className="notif-item-meta" style={{ display:'flex', gap:6, alignItems:'center', flexWrap:'wrap' }}>
                      <span style={{ fontWeight:700, fontSize:'11px', padding:'1px 7px', borderRadius:8,
                        background: SEV_BG[inc.severity]||'#f1f5f9', color: SEV_COLOR[inc.severity]||'#475569',
                        textTransform:'capitalize' }}>{inc.severity}</span>
                      {inc.incident_type && <span>{inc.incident_type}</span>}
                      <span>by {inc.logged_by}</span>
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:4, flexShrink:0 }}>
                    <button className="notif-item-action" onClick={() => { onGoTab('incidents'); onClose() }}>View</button>
                    <button className="notif-item-action" onClick={() => dismissIncident(inc.id)} title="Dismiss">✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {notif.broadcasts.length > 0 && perm.includes('broadcast.receive') && (
            <div className="notif-section">
              <div className="notif-section-head">
                Announcements
                <span className="notif-badge-sm">{notif.broadcasts.length}</span>
              </div>
              {notif.broadcasts.map(b => {
                const bcTs       = b.created_at ? new Date(b.created_at.replace(' ','T')+'Z').getTime() : 0
                const canDismiss = bcTs > 0 && (Date.now() - bcTs) > 12 * 3600000
                return (
                  <div key={b.id} className="notif-item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}>
                    <div style={{ display: 'flex', width: '100%', alignItems: 'flex-start', gap: 8 }}>
                      <span className="notif-item-icon">📢</span>
                      <div className="notif-item-body" style={{ flex: 1 }}>
                        <div className="notif-item-name" style={{ whiteSpace: 'normal', fontWeight: 500 }}>{b.message}</div>
                        <div className="notif-item-meta">From {b.sender_name} · {timeAgo(b.created_at)}</div>
                      </div>
                      {canDismiss
                        ? <button className="notif-item-action" onClick={() => dismissBroadcast(b.id)} title="Dismiss">✕</button>
                        : <span style={{ fontSize: '10px', color: '#94a3b8', flexShrink: 0, textAlign: 'center', lineHeight: 1.3 }}>dismissable<br/>after 12h</span>
                      }
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {!hasAny && (
            <div className="notif-all-clear">
              <span style={{ fontSize: '2rem' }}>✅</span>
              <span>All clear — no pending notifications</span>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ── Broadcast Compose Modal ───────────────────────────────────────────
function BroadcastModal({ open, onClose }) {
  const [text, setText]     = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')

  async function send() {
    if (!text.trim()) { setErr('Message required'); return }
    setSaving(true); setErr('')
    try {
      const r = await fetch('/api/broadcasts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: text.trim() }),
      })
      if (!r.ok) { setErr('Send failed'); return }
      setText(''); onClose()
    } catch { setErr('Network error') }
    finally { setSaving(false) }
  }

  if (!open) return null
  return (
    <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-head">
          <h2>Send Announcement</h2>
          <button className="xbtn" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          {err && <div className="auth-error">{err}</div>}
          <div className="field">
            <label>Message</label>
            <textarea rows={4} maxLength={500} value={text}
              onChange={e => setText(e.target.value)}
              placeholder="Type your announcement…"
              style={{ resize: 'vertical', width: '100%' }} />
            <div style={{ textAlign: 'right', fontSize: '11px', color: '#94a3b8' }}>{text.length} / 500</div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={send} disabled={saving}>{saving ? 'Sending…' : 'Send'}</button>
        </div>
      </div>
    </div>
  )
}

// ── UA Draw Modal ─────────────────────────────────────────────────────
function UADrawModal({ open, onClose, clients, statuses }) {
  const [method, setMethod]     = useState('smart')
  const [lookback, setLookback] = useState(30)
  const [drawCount, setDrawCount] = useState(5)
  const [preview, setPreview]   = useState(null)
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
      } catch { /* empty */ }
    }
    const pool = buildPool(excludeIds)
    const totalPool = buildPool(new Set())
    const excluded = totalPool.length - pool.length
    let info = `${pool.length} of ${totalPool.length} residents eligible`
    if (method === 'smart' && excluded > 0) info += ` (${excluded} excluded — drawn within ${lookback} days)`
    if (pool.length < drawCount) info += ` — only ${pool.length} available`
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
          <h2>Random UA Draw</h2>
          <button className="xbtn" onClick={handleClose}>&times;</button>
        </div>
        <div className="modal-body">
          {err && <div className="auth-error">{err}</div>}

          <div className="field">
            <label>Method</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button type="button" onClick={() => setMethod('random')} style={{
                flex: 1, padding: '9px 0', borderRadius: 6, cursor: 'pointer', fontSize: '13px', fontWeight: 700,
                border: `2px solid ${method === 'random' ? 'var(--accent)' : 'var(--border-light)'}`,
                background: method === 'random' ? 'var(--accent)' : 'transparent',
                color: method === 'random' ? '#fff' : 'var(--text-muted)',
                transition: 'all .12s',
              }}>True Random</button>
              <button type="button" onClick={() => setMethod('smart')} style={{
                flex: 1, padding: '9px 0', borderRadius: 6, cursor: 'pointer', fontSize: '13px', fontWeight: 700,
                border: `2px solid ${method === 'smart' ? 'var(--accent)' : 'var(--border-light)'}`,
                background: method === 'smart' ? 'var(--accent)' : 'transparent',
                color: method === 'smart' ? '#fff' : 'var(--text-muted)',
                transition: 'all .12s',
              }}>Smart (exclude recent)</button>
            </div>
          </div>

          {method === 'smart' && (
            <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ whiteSpace: 'nowrap', marginBottom: 0 }}>Exclude if drawn within</label>
              <input type="number" value={lookback} min={1} max={365}
                onChange={e => setLookback(Math.min(365, Math.max(1, parseInt(e.target.value)||30)))}
                style={{ width: 60, padding: '4px 8px', border: '1px solid var(--border-light)', borderRadius: 5 }}
              />
              <span style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: '13px' }}>days</span>
            </div>
          )}

          <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ marginBottom: 0 }}>Draw</label>
            <input type="number" value={drawCount} min={1} max={50}
              onChange={e => setDrawCount(Math.min(50, Math.max(1, parseInt(e.target.value)||5)))}
              style={{ width: 60, padding: '4px 8px', border: '1px solid var(--border-light)', borderRadius: 5 }}
            />
            <label style={{ marginBottom: 0 }}>residents</label>
          </div>

          {poolInfo && (
            <div style={{ fontSize: '12px', color: '#475569', background: '#f8fafc', border: '1px solid var(--border-light)', borderRadius: 6, padding: '7px 12px', marginBottom: 8 }}>
              {poolInfo}
            </div>
          )}

          {preview !== null && (
            preview.length === 0
              ? <div style={{ color: 'var(--danger)', fontSize: '13px' }}>No eligible residents in the pool.</div>
              : (
                <div style={{ border: '1px solid var(--border-light)', borderRadius: 8, overflow: 'hidden' }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', padding: '8px 12px', background: '#f8fafc', borderBottom: '1px solid var(--border-light)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
                    {preview.length} residents selected
                  </div>
                  {preview.map((c, i) => (
                    <div key={c.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                      borderBottom: i < preview.length - 1 ? '1px solid var(--border-light)' : 'none',
                      background: '#fff',
                    }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: '12px', fontWeight: 700, background: 'var(--sky)', color: 'var(--dark)', padding: '2px 8px', borderRadius: 10, minWidth: 50, textAlign: 'center' }}>
                        Rm {c.room}
                      </span>
                      <span style={{ fontWeight: 600, fontSize: '13px' }}>{c.name}</span>
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
                <button className="btn btn-secondary" onClick={() => { setPreview(null); setPoolInfo('') }}>Re-draw</button>
                <button className="btn btn-primary" onClick={confirmDraw} disabled={saving}>{saving ? 'Sending…' : 'Confirm & Send'}</button>
              </>
            )
          }
        </div>
      </div>
    </div>
  )
}

// ── Operational sidebar (Console) ─────────────────────────────────────
const navRowBase = 'flex items-center gap-3 w-full px-3 py-2 text-sm font-medium rounded-lg transition-colors text-left group'
const navRowOn   = 'bg-primary-50 text-primary-700 dark:bg-gray-700 dark:text-white'
const navRowOff  = 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'

function Sidebar({ activeTab, onTabChange, session, facilityName, hasPerm, uiVis, onDrawOpen, onClinical, onHome, onSignOut }) {
  function isTabVisible(id) {
    if (uiVis.tabs && Object.keys(uiVis.tabs).length > 0) {
      if (uiVis.tabs[id] === false) return false
    }
    return true
  }
  const initials = (session?.displayName || session?.username || '?')
    .split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()

  return (
    <aside className="fixed top-0 left-0 z-40 flex flex-col w-64 h-full bg-white border-r border-gray-200 dark:bg-gray-800 dark:border-gray-700">
      {/* Brand → Dashboard (brand-click landing, not a nav item) */}
      <button onClick={onHome} className="flex items-center w-full gap-2.5 h-16 px-4 text-left border-b shrink-0 border-gray-200 dark:border-gray-700">
        <img src="/static/icons/icon-192.png" alt="" className="w-8 h-8 rounded-lg shadow-sm" />
        <div className="leading-tight min-w-0">
          <p className="text-base font-bold text-gray-900 dark:text-white">OpsPoint</p>
          <p className="text-[11px] text-gray-400 truncate">{facilityName}</p>
        </div>
      </button>

      <nav className="flex-1 px-3 py-3 overflow-y-auto">
        <div className="space-y-1">
          <button onClick={() => onTabChange('dashboard')} className={`${navRowBase} ${activeTab === 'dashboard' ? navRowOn : navRowOff}`}>
            <LayoutDashboard className={`w-5 h-5 shrink-0 ${activeTab === 'dashboard' ? 'text-primary-600 dark:text-primary-400' : 'text-gray-400 group-hover:text-gray-700 dark:group-hover:text-white'}`} />
            <span className="flex-1">Dashboard</span>
          </button>
        </div>
        {SIDEBAR_GROUPS.map(group => {
          const visItems = group.items.filter(item => {
            if (item.perm  && !hasPerm(item.perm)) return false
            if (item.perms && !item.perms.some(p => hasPerm(p))) return false
            if (!isTabVisible(item.id)) return false
            return true
          })
          const showDraw     = group.label === 'HEALTH & COMPLIANCE' && hasPerm('ua.draw')
          const showClinical = group.label === 'HEALTH & COMPLIANCE' && CLINICAL_SECTION_PERMS.some(p => hasPerm(p))
          if (visItems.length === 0 && !showDraw && !showClinical) return null
          return (
            <div key={group.label}>
              <p className="px-3 pt-5 pb-1 text-[11px] font-semibold tracking-wider uppercase text-gray-400 dark:text-gray-500">{group.label}</p>
              <div className="space-y-1">
                {visItems.map(({ id, label, Icon }) => {
                  const on = activeTab === id
                  return (
                    <button key={id} onClick={() => onTabChange(id)} className={`${navRowBase} ${on ? navRowOn : navRowOff}`}>
                      <Icon className={`w-5 h-5 shrink-0 ${on ? 'text-primary-600 dark:text-primary-400' : 'text-gray-400 group-hover:text-gray-700 dark:group-hover:text-white'}`} />
                      <span className="flex-1">{label}</span>
                    </button>
                  )
                })}
                {showDraw && (
                  <button onClick={onDrawOpen} className={`${navRowBase} ${navRowOff}`}>
                    <Dice5 className="w-5 h-5 shrink-0 text-gray-400 group-hover:text-gray-700 dark:group-hover:text-white" />
                    <span className="flex-1">UA Draw</span>
                  </button>
                )}
                {showClinical && (
                  <button onClick={onClinical} className={`${navRowBase} ${navRowOff}`}>
                    <Stethoscope className="w-5 h-5 shrink-0 text-gray-400 group-hover:text-gray-700 dark:group-hover:text-white" />
                    <span className="flex-1">Clinical</span>
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </nav>

      <div className="flex items-center gap-3 p-3 border-t shrink-0 border-gray-200 dark:border-gray-700">
        <span className="flex items-center justify-center text-sm font-semibold rounded-full w-9 h-9 bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300">{initials}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate text-gray-900 dark:text-white">{session?.displayName || session?.username}</p>
          <p className="text-xs truncate text-gray-400">{session?.role || 'Staff'}</p>
        </div>
        <button onClick={onSignOut} title="Sign out" className="p-1 text-gray-400 rounded hover:text-gray-700 hover:bg-gray-100 dark:hover:text-white dark:hover:bg-gray-700">
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </aside>
  )
}

// ── Settings gear dropdown (Console) — Admin / About / Sign out only ──
function SettingsMenu({ showAdmin, onAbout, onAdmin, onSignOut }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    const onDoc = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} title="Settings" className="p-2 text-gray-500 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-400">
        <Settings className="w-5 h-5" />
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 p-1.5 bg-white border border-gray-200 shadow-lg w-52 rounded-xl dark:bg-gray-800 dark:border-gray-700">
          {showAdmin && (
            <button onClick={() => { setOpen(false); onAdmin?.() }} className="flex items-center w-full gap-2.5 px-3 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700">
              <Shield className="w-4 h-4 text-gray-400" /><span className="flex-1 text-left">Admin</span>
            </button>
          )}
          <button onClick={() => { setOpen(false); onAbout?.() }} className="flex items-center w-full gap-2.5 px-3 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700">
            <Info className="w-4 h-4 text-gray-400" /><span className="flex-1 text-left">About OpsPoint</span>
          </button>
          <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
          <button onClick={() => { setOpen(false); onSignOut?.() }} className="flex items-center w-full gap-2.5 px-3 py-2 text-sm font-medium text-gray-500 rounded-md hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700">
            <LogOut className="w-4 h-4 text-gray-400" /><span className="flex-1 text-left">Sign out</span>
          </button>
        </div>
      )}
    </div>
  )
}

// ── Header / top bar (Console) ────────────────────────────────────────
function Header({ onGoTab, offset = true, search = '', onSearch }) {
  const { session, logout }                 = useAuth()
  const { hasPerm }                         = usePermission()
  const { data, saveStatus, notif, serverRestarting, wsConnected, dismissBroadcast, dismissIncident } = useData()
  const navigate                            = useNavigate()

  const [panelOpen, setPanelOpen]           = useState(false)
  const [broadcastOpen, setBroadcastOpen]   = useState(false)
  const [dark, setDark]                     = useDarkMode()
  const [moreOpen, setMoreOpen]             = useState(false)
  const moreRef = useRef(null)
  useEffect(() => {
    const onDoc = e => { if (moreRef.current && !moreRef.current.contains(e.target)) setMoreOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const [dismissedDrawIds, setDismissedDrawIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('spDismissedDraws') || '[]')) }
    catch { return new Set() }
  })

  function dismissDraw(id) {
    setDismissedDrawIds(prev => {
      const next = new Set(prev)
      next.add(id)
      try { localStorage.setItem('spDismissedDraws', JSON.stringify([...next])) } catch { /* empty */ }
      return next
    })
  }

  const [dismissedViolReview, setDismissedViolReview] = useState(() => {
    try { return parseInt(localStorage.getItem('spDismissedViolReview') || '0') } catch { return 0 }
  })
  const [dismissedViolConsequence, setDismissedViolConsequence] = useState(() => {
    try { return parseInt(localStorage.getItem('spDismissedViolConsequence') || '0') } catch { return 0 }
  })
  function dismissViolReview(count) {
    setDismissedViolReview(count)
    try { localStorage.setItem('spDismissedViolReview', String(count)) } catch { /* empty */ }
  }
  function dismissViolConsequence(count) {
    setDismissedViolConsequence(count)
    try { localStorage.setItem('spDismissedViolConsequence', String(count)) } catch { /* empty */ }
  }

  const facilityName = data?.facility_name || 'OpsPoint'

  const uiVis = useMemo(() => {
    const def = { tabs: {}, buttons: {} }
    if (!data?.ui_visibility) return def
    try { return typeof data.ui_visibility === 'string' ? JSON.parse(data.ui_visibility) : data.ui_visibility }
    catch { return def }
  }, [data])

  const activeReport = data?.reports?.find(r => r.id === data?.active_report_id)

  const handleLogout = async () => { await logout(); navigate('/login') }

  // ── DOCX generation helpers ──────────────────────────────────────────
  function _xe(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') }
  function _rpr({font='Calibri',sz=20,bold,col,italic}={}) {
    let r=`<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>`
    r+=`<w:sz w:val="${sz*2}"/><w:szCs w:val="${sz*2}"/>`
    if(bold)   r+='<w:b/><w:bCs/>'
    if(italic) r+='<w:i/><w:iCs/>'
    if(col)    r+=`<w:color w:val="${col}"/>`
    return `<w:rPr>${r}</w:rPr>`
  }
  function _run(text,opts={}) { return `<w:r>${_rpr(opts)}<w:t xml:space="preserve">${_xe(text)}</w:t></w:r>` }
  function _para(runs,{align,shade,sb=0,sa=80,il=0,border_bottom}={}) {
    let pp=''
    if(shade)pp+=`<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>`
    if(align)pp+=`<w:jc w:val="${align}"/>`
    if(sb||sa)pp+=`<w:spacing w:before="${sb}" w:after="${sa}"/>`
    if(il)pp+=`<w:ind w:left="${il}"/>`
    if(border_bottom)pp+=`<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="${border_bottom}"/></w:pBdr>`
    const r=Array.isArray(runs)?runs.join(''):runs
    return `<w:p>${pp?`<w:pPr>${pp}</w:pPr>`:''}${r}</w:p>`
  }
  function _ep(sa=120){return _para('',{sa})}
  function _secHdr(text){return _para(_run(' '+text,{sz:11,bold:true,col:'FFFFFF'}),{shade:'1A3327',sb:280,sa:0})}
  function _borders(c='D4E6DA'){return `<w:top w:val="single" w:sz="4" w:color="${c}"/><w:left w:val="single" w:sz="4" w:color="${c}"/><w:bottom w:val="single" w:sz="4" w:color="${c}"/><w:right w:val="single" w:sz="4" w:color="${c}"/><w:insideH w:val="single" w:sz="4" w:color="${c}"/><w:insideV w:val="single" w:sz="4" w:color="${c}"/>`}
  function _tc(text,w,{bold=false,sz=10,col='111111',shade=null,align='left',italic=false}={}) {
    let tp=`<w:tcW w:w="${w}" w:type="dxa"/><w:tcMar><w:top w:w="80" w:type="dxa"/><w:left w:w="110" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="110" w:type="dxa"/></w:tcMar>`
    if(shade)tp+=`<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>`
    const pa=align==='center'?'center':align==='right'?'right':'left'
    return `<w:tc><w:tcPr>${tp}</w:tcPr>${_para(_run(text,{sz,bold,col,italic}),{align:pa,sa:0,sb:0})}</w:tc>`
  }
  function _th(text,w,opts={}) { return _tc(text,w,{bold:true,sz:9,col:'FFFFFF',shade:'1A3327',align:'center',...opts}) }
  function _tr(cells,{header=false}={}) { return `<w:tr>${header?'<w:trPr><w:tblHeader/></w:trPr>':''}${cells}</w:tr>` }
  function _tbl(cols,rows,{c='D4E6DA'}={}) {
    const tot=cols.reduce((a,b)=>a+b,0)
    return `<w:tbl><w:tblPr><w:tblW w:w="${tot}" w:type="dxa"/><w:tblBorders>${_borders(c)}</w:tblBorders><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${cols.map(w=>`<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>${rows.join('')}</w:tbl>`
  }

  async function generateDocx() {
    const report    = activeReport
    const clients   = data?.clients || []
    const fn        = data?.facility_name || 'OpsPoint'
    const sv        = report?.shift || ''
    const dv        = report?.report_date || ''
    const mv        = report?.mod_name || ''
    const logEntrs  = report?.log_entries || []
    const issues    = report?.issues || []
    const medNotes  = report?.med_notes || []
    const statuses  = report?.statuses || {}
    const comments  = report?.comments || {}
    const shiftFull = {'Day Shift':'Day Shift (7:00 a.m. – 3:30 p.m.)','Swing Shift':'Swing Shift (3:00 p.m. – 11:30 p.m.)','Graveyard Shift':'Graveyard Shift (11:00 p.m. – 7:30 a.m.)'}[sv]||sv
    const dateStr   = dv ? new Date(dv+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'}) : '—'
    const stShd={building:'D8F3DC',work:'DBEAFE',pass:'FEF9C3',bhc:'EDE9FE',efc:'FCE7F3',hospital:'FEE2E2',out:'FFF7ED',vacant:'F1F5F9'}
    const stLbl={building:'In Building',work:'Work',pass:'Weekend Pass',bhc:'BHC',efc:'EFC',hospital:'Hospital',out:'Out / Other',vacant:'Vacant'}
    const cnt={building:0,work:0,pass:0,bhc:0,efc:0,hospital:0,out:0}
    clients.filter(c=>c.is_active&&!c.is_special&&c.name!=='VACANT').forEach(c=>{
      const st=statuses[c.id]||'building'; if(Object.hasOwn(cnt, st))cnt[st]++
    })
    const tot=Object.values(cnt).reduce((a,b)=>a+b,0)
    const CW=9360
    let body=''
    body+=_para(_run('',{sz:4}),{shade:'D4A017',sb:0,sa:0})
    body+=_para([_run(fn,{sz:8,col:'A8D5B5',bold:true})],{shade:'163825',sb:0,sa:0,align:'center'})
    body+=_para(_run(fn,{sz:24,bold:true,col:'FFFFFF'}),{shade:'1A3327',sb:0,sa:0,align:'center'})
    body+=_para(_run(shiftFull,{sz:13,col:'D4E6DA'}),{shade:'2D6A4F',sb:0,sa:0,align:'center'})
    body+=_para(_run('',{sz:4}),{shade:'D4A017',sb:0,sa:200})
    const iCols=[2800,CW-2800]
    const infoRows=[['Date',dateStr],['Shift',shiftFull],['Program Assistant on Duty (PA)',mv||'—']].map(([l,v])=>
      _tr(_tc(l,iCols[0],{bold:true,sz:9,col:'5C6B5E',shade:'F4FAF6'})+_tc(v,iCols[1],{sz:10,col:'1A3327'}))
    )
    body+=_tbl(iCols,infoRows)+_ep(140)
    body+=_secHdr('CENSUS')
    const cKeys=['building','work','pass','bhc','efc','hospital','out','TOTAL']
    const cLabels={building:'In Building',work:'At Work',pass:'Weekend Pass',bhc:'BHC',efc:'EFC',hospital:'Hospital',out:'Out/Other',TOTAL:'TOTAL'}
    const cBg={building:'D8F3DC',work:'DBEAFE',pass:'FEF9C3',bhc:'EDE9FE',efc:'FCE7F3',hospital:'FEE2E2',out:'FFF7ED',TOTAL:'D4A017'}
    const cFg={building:'14532D',work:'1D4ED8',pass:'854D0E',bhc:'5B21B6',efc:'9D174D',hospital:'991B1B',out:'7C2D12',TOTAL:'FFFFFF'}
    const cW2=Math.floor(CW/8)
    body+=_tbl(Array(8).fill(cW2),[
      _tr(cKeys.map(k=>_th(cLabels[k],cW2)).join(''),{header:true}),
      _tr(cKeys.map(k=>_tc(k==='TOTAL'?String(tot):String(cnt[k]),cW2,{bold:true,sz:16,col:cFg[k]||'1A3327',shade:cBg[k]||'F8FAFC',align:'center'})).join(''))
    ])+_ep(140)
    body+=_secHdr('SHIFT ACTIVITY LOG')
    if(!logEntrs.length){body+=_para(_run('No entries recorded.',{sz:10,col:'94A3B8',italic:true}),{sa:40,il:160})}
    else{const lC=[1000,CW-1000];body+=_tbl(lC,logEntrs.map((e,i)=>_tr(_tc(e.time,lC[0],{bold:true,sz:10,col:'2D6A4F',shade:i%2===0?'FFFFFF':'F4FAF6'})+_tc(e.text,lC[1],{sz:10,col:'111111',shade:i%2===0?'FFFFFF':'F4FAF6'}))))+_ep(140)}
    body+=_secHdr('ISSUES & CONCERNS')
    if(!issues.length){body+=_para(_run('None.',{sz:10,col:'94A3B8',italic:true}),{sa:40,il:160})}
    else{issues.forEach((v,i)=>{body+=_para([_run('●  ',{sz:10,col:'D4A017',bold:true}),_run(v,{sz:10,col:'111111'})],{sa:60,il:200,shade:i%2===0?'FFFFFF':'FFFBF0'})})}
    body+=_ep(140)
    if(medNotes.length){body+=_secHdr('MEDICAL NOTES');medNotes.forEach((n,i)=>{body+=_para([_run('●  ',{sz:10,col:'D4A017',bold:true}),_run(n,{sz:10,col:'111111'})],{sa:60,il:200,shade:i%2===0?'FFFBF0':'FFFFFF'})});body+=_ep(140)}
    body+=_secHdr('RESIDENT ROSTER')
    const rC=[640,2000,1500,1600,3620]
    const rHdr=_tr([_th('Rm #',rC[0]),_th('Name',rC[1]),_th('Case Manager',rC[2]),_th('Status',rC[3]),_th('Comments',rC[4])].join(''),{header:true})
    const rRows=clients.filter(c=>c.is_active).map((c,i)=>{
      const rs=i%2===0?'FFFFFF':'F4FAF6'
      if(c.is_special)return _tr([_tc(c.room,rC[0],{sz:8,col:'94A3B8',shade:'F1F5F9',align:'center'}),_tc(c.name,rC[1],{sz:9,col:'94A3B8',shade:'F1F5F9',italic:true}),_tc('',rC[2],{shade:'F1F5F9'}),_tc('',rC[3],{shade:'F1F5F9'}),_tc('',rC[4],{shade:'F1F5F9'})].join(''))
      const st=statuses[c.id]||(c.name==='VACANT'?'vacant':'building')
      return _tr([_tc(c.room,rC[0],{sz:9,col:'5C6B5E',shade:rs,align:'center',bold:true}),_tc(c.name,rC[1],{sz:10,col:'1A3327',shade:rs,bold:true}),_tc(c.case_manager||'',rC[2],{sz:9,col:'5C6B5E',shade:rs}),_tc(stLbl[st]||st,rC[3],{sz:9,col:'1A3327',shade:stShd[st]||rs,align:'center',bold:true}),_tc(comments[c.id]||'',rC[4],{sz:9,col:'444444',shade:rs})].join(''))
    })
    body+=_tbl(rC,[rHdr,...rRows])+_ep(80)
    body+=_para(_run(fn,{sz:8,col:'5C6B5E',italic:true}),{align:'center',border_bottom:'D4A017',sb:0,sa:0})
    const docXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900"/></w:sectPr></w:body></w:document>`
    const ctXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`
    const relsXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
    const zip=new JSZip()
    zip.file('[Content_Types].xml',ctXml)
    zip.file('_rels/.rels',relsXml)
    zip.file('word/document.xml',docXml)
    zip.file('word/_rels/document.xml.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`)
    return await zip.generateAsync({type:'uint8array'})
  }

  function _docxFilename() {
    const fn=(data?.facility_name||'OpsPoint').replace(/[^a-zA-Z0-9 _-]/g,'').trim()
    const sv=activeReport?.shift||'Shift'
    const dv=activeReport?.report_date||''
    let dp=''; if(dv){const[y,m,d]=dv.split('-');dp=' '+parseInt(m)+'.'+parseInt(d)+'.'+y.slice(2)}
    return `${fn} — ${sv} Report${dp}.docx`
  }

  function fileWalkthroughs() {
    const shift   = activeReport?.shift || ''
    const dateVal = activeReport?.report_date || ''
    const mod     = activeReport?.mod_name || ''
    const fn      = data?.facility_name || 'OpsPoint'
    const dateStr = dateVal
      ? new Date(dateVal + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    const shiftLabels = { 'Day Shift':'Day Shift (7:00 a.m. – 3:30 p.m.)','Swing Shift':'Swing Shift (3:00 p.m. – 11:30 p.m.)','Graveyard Shift':'Graveyard Shift (11:00 p.m. – 7:30 a.m.)' }
    const logEntries = activeReport?.log_entries || []
    const walks = logEntries.filter(e => e.text && e.text.toLowerCase().includes('walkthrough'))
    if (walks.length === 0) { alert('No building walkthroughs found in the activity log for this shift.'); return }
    const rows = walks.map((e, i) => {
      const byMatch = e.text.match(/conducted(?:\s+by\s+(.+?))?[.,]/i)
      const monitor = (byMatch && byMatch[1]) ? byMatch[1].trim() : (mod || '—')
      let area = 'Full Building'
      if (/All areas checked:/i.test(e.text)) area = 'All Areas'
      else if (/Areas checked:/i.test(e.text)) {
        const m2 = e.text.match(/Areas checked:\s*([^.]+)/i)
        if (m2) { const aList = m2[1].split(','); area = aList.length > 2 ? `${aList.length} Areas` : aList.map(s => s.trim()).join(', ') }
      }
      const notes = e.text.replace(/Building walkthrough conducted(\s+by\s+[^.]+)?\.?\s*/i, '').replace(/(All )?[Aa]reas checked:[^.]+\.\s*/g, '').replace(/Not checked:[^.]+\.\s*/g, '').trim()
      const hasIssue = !e.text.toLowerCase().includes('all is well') && !e.text.toLowerCase().includes('nothing to report')
      const rowBg = hasIssue ? 'background:#fef9c3;' : (i % 2 === 1 ? 'background:#F4F6F8;' : '')
      return `<tr style="${rowBg}border-bottom:1px solid #D0DAEF;"><td style="padding:6px 8px;font-weight:700;font-family:monospace;color:#0f4c5c;white-space:nowrap;">${esc(e.time)}</td><td style="padding:6px 8px;font-weight:600;color:#1a6b80;">${esc(monitor)}</td><td style="padding:6px 8px;color:#555;">${esc(area)}</td><td style="padding:6px 8px;">${esc(notes)}</td></tr>`
    }).join('')
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Building Walkthrough Filing</title><style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;font-size:11px;color:#111;background:#fff;}.page-hdr{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2.5px solid #0f4c5c;padding:16px 20px 10px;}.org{font-size:7px;font-weight:700;letter-spacing:.8px;color:#1a6b80;text-transform:uppercase;margin-bottom:3px;}.title{font-size:16px;font-weight:700;color:#0f4c5c;}.sub-title{font-size:9.5px;color:#444;margin-top:3px;}.hdr-right{text-align:right;font-size:9.5px;color:#444;line-height:2;}.hdr-right b{color:#0f4c5c;}.badge{display:inline-block;background:#dbeafe;color:#1e40af;font-weight:700;font-size:9px;padding:2px 8px;border-radius:10px;border:1px solid #93c5fd;}.wrap{padding:12px 20px;}table{width:100%;border-collapse:collapse;}thead th{background:#0f4c5c;color:#fff;padding:7px 8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;text-align:left;}td{border-bottom:1px solid #D0DAEF;vertical-align:middle;font-size:11px;padding:0;}.summary{margin:14px 20px 0;padding:10px 14px;background:#F4F6F8;border:1px solid #D0DAEF;border-radius:6px;font-size:10px;color:#333;}.sig{display:flex;gap:24px;padding:16px 20px 18px;border-top:1.5px solid #999;margin-top:10px;}.sig-b{flex:1;font-size:9.5px;font-weight:700;color:#333;}.sig-l{display:inline-block;border-bottom:1px solid #333;width:55%;margin-left:4px;}@media print{@page{size:letter portrait;margin:0.4in;}.wrap{padding:0;}.sig{padding:12px 0 0;}.summary{margin:12px 0 0;}}</style></head><body><div class="page-hdr"><div><div class="org">${esc(fn)}</div><div class="title">${esc(fn)} — Building Walkthrough Filing Record</div><div class="sub-title">${esc(shiftLabels[shift]||shift)} &nbsp;|&nbsp; ${dateStr}</div></div><div class="hdr-right"><b>Program Assistant on Duty:</b> ${esc(mod)||'_______________'}<br><b>Total Walkthroughs:</b> ${walks.length}<br><span class="badge">FILING COPY</span></div></div><div class="wrap"><table><thead><tr><th style="width:80px;">Time</th><th style="width:150px;">Conducted By</th><th style="width:130px;">Area</th><th>Notes / Findings</th></tr></thead><tbody>${rows}</tbody></table></div><div class="summary"><strong>Summary:</strong> &nbsp; ${walks.length} walkthrough(s) conducted this shift.</div><div class="sig"><div class="sig-b">Filed By: <span class="sig-l"></span></div><div class="sig-b">Supervisor Review: <span class="sig-l"></span></div><div class="sig-b">Date Filed: <span class="sig-l"></span></div></div></body></html>`
    const w = window.open('', '_blank')
    if (!w) { alert('Popup blocked — allow popups for this site.'); return }
    w.document.write(html); w.document.close()
    setTimeout(() => { try { w.focus(); w.print() } catch { /* empty */ } }, 250)
  }

  function fileWellnessChecks() {
    const shift   = activeReport?.shift || ''
    const dateVal = activeReport?.report_date || ''
    const mod     = activeReport?.mod_name || ''
    const fn      = data?.facility_name || 'OpsPoint'
    const dateStr = dateVal
      ? new Date(dateVal + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    const shiftLabels = { 'Day Shift':'Day Shift (7:00 a.m. – 3:30 p.m.)','Swing Shift':'Swing Shift (3:00 p.m. – 11:30 p.m.)','Graveyard Shift':'Graveyard Shift (11:00 p.m. – 7:30 a.m.)' }
    const logEntries = activeReport?.log_entries || []
    const checks = logEntries.filter(e => e.text && e.text.toLowerCase().startsWith('wellness check'))
    if (checks.length === 0) { alert('No wellness checks found in the activity log for this shift.'); return }
    const checkCols = checks.map(e => {
      const byMatch = e.text.match(/conducted(?:\s+by\s+(.+?))?\./)
      const monitor = (byMatch && byMatch[1]) ? byMatch[1].trim() : (mod || '—')
      const notLocated = []
      const nlMatch = e.text.match(/Not located:\s*(.+?)\.?\s*$/i)
      if (nlMatch) { nlMatch[1].split(',').forEach(s => { const rm = s.trim().match(/Rm\.?\s*(\d+)/i); if (rm) notLocated.push(parseInt(rm[1])) }) }
      return { time: e.time, monitor, notLocated }
    })
    const activeClients = (data?.clients || []).filter(c => c.is_active && !c.is_special && c.name !== 'VACANT').slice().sort((a, b) => (parseInt(a.room)||0) - (parseInt(b.room)||0))
    const statuses = activeReport?.statuses || {}
    const statusLabel = { bhc:'BHC',efc:'EFC',hospital:'HOSP',work:'WORK',pass:'PASS',out:'OUT',building:'',vacant:'' }
    const statusBg    = { bhc:'#ede9fe',efc:'#fce7f3',hospital:'#fee2e2',work:'#dbeafe',pass:'#fef9c3',out:'#fff7ed',building:'',vacant:'' }
    const colWidth = Math.max(55, Math.min(80, Math.floor(400/checkCols.length)))
    const thCols = checkCols.map(col => `<th class="chk-th">${esc(col.time)}<div style="font-size:8px;font-weight:400;color:#cce8ef;margin-top:2px;">${esc(col.monitor)}</div></th>`).join('')
    const clientRows = activeClients.map((c, i) => {
      const st = statuses[c.id] || 'building'
      const isOut = ['work','pass','bhc','efc','hospital','out'].includes(st)
      const cells = checkCols.map(col => {
        const wasNotLocated = col.notLocated.includes(parseInt(c.room))
        if (isOut && !wasNotLocated) { const lbl=statusLabel[st]||st.toUpperCase(); const bg=statusBg[st]||''; return `<td class="chk-td" style="background:${bg};font-size:9px;font-weight:700;text-align:center;">${lbl}</td>` }
        if (wasNotLocated) return `<td class="chk-td" style="background:#fee2e2;color:#991b1b;font-weight:700;text-align:center;font-size:13px;">✗</td>`
        return `<td class="chk-td" style="text-align:center;font-size:13px;color:#15803d;">✓</td>`
      }).join('')
      const rowBg = i%2===1?'#F4F6F8':'#fff'
      return `<tr style="background:${rowBg};border-bottom:1px solid #D0DAEF;"><td class="rm-td">${esc(c.room)}</td><td class="name-td">${esc(c.name)}</td>${cells}<td class="notes-td"></td></tr>`
    }).join('')
    const totalCells = checkCols.map(col => { const accounted=activeClients.length-col.notLocated.length; return `<td class="chk-td" style="text-align:center;font-weight:700;font-size:10px;">${accounted} / ${activeClients.length}</td>` }).join('')
    const initCells = checkCols.map(col => `<td class="chk-td" style="border-bottom:2px solid #0f4c5c;text-align:center;height:26px;font-size:9px;font-weight:700;color:#1a6b80;">${esc(col.monitor.split(' ')[0])}</td>`).join('')
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Wellness Check Filing</title><style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:Arial,sans-serif;font-size:11px;color:#111;background:#fff;}.page-hdr{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2.5px solid #0f4c5c;padding:16px 20px 8px;}.org{font-size:7px;font-weight:700;letter-spacing:.8px;color:#1a6b80;text-transform:uppercase;margin-bottom:2px;}.title{font-size:15px;font-weight:700;color:#0f4c5c;}.sub-title{font-size:9.5px;color:#444;margin-top:2px;}.hdr-right{text-align:right;font-size:9.5px;color:#444;line-height:1.85;}.hdr-right b{color:#0f4c5c;}.badge{display:inline-block;background:#d1fae5;color:#065f46;font-weight:700;font-size:9px;padding:2px 8px;border-radius:10px;border:1px solid #6ee7b7;}.hint{font-size:8px;color:#888;font-style:italic;padding:4px 20px 2px;}.wrap{padding:0 20px 10px;}table{width:100%;border-collapse:collapse;}thead{display:table-header-group;}tfoot{display:table-footer-group;}thead tr th{background:#0f4c5c;color:#fff;padding:6px 7px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;border:1px solid #163825;text-align:left;}.rm-td{font-family:monospace;font-weight:700;color:#555;text-align:center;width:42px;padding:4px 6px;}.name-td{width:155px;padding:4px 6px;font-weight:500;}.chk-th{width:${colWidth}px;text-align:center;border-left:1px solid #245c3a;padding:5px 4px;}.chk-td{width:${colWidth}px;border-left:1.5px solid #8dbda0;padding:4px;vertical-align:middle;}.notes-td{padding:4px 6px;}td{vertical-align:middle;border-right:1px solid #D0DAEF;font-size:11px;}td:last-child{border-right:none;}tfoot tr.sum td{background:#dff0e6;border-top:2px solid #0f4c5c;font-weight:700;font-size:10px;padding:5px 6px;}tfoot tr.init-row td{background:#f0f7f2;border-top:1px solid #8dbda0;padding:4px;}.sig{display:flex;gap:20px;padding:10px 20px 14px;border-top:1.5px solid #999;margin-top:4px;}.sig-b{flex:1;font-size:9px;font-weight:700;color:#333;}.sig-l{display:inline-block;border-bottom:1px solid #333;width:55%;margin-left:4px;}@media print{@page{size:letter portrait;margin:0.35in;}body{font-size:10px;}.wrap{padding:0;}.hint{padding:3px 0 1px;}.sig{padding:8px 0 0;}}</style></head><body><div class="page-hdr"><div><div class="org">${esc(fn)}</div><div class="title">${esc(fn)} — Wellness Check Filing Record</div><div class="sub-title">${esc(shiftLabels[shift]||shift)} | ${dateStr}</div></div><div class="hdr-right"><b>Program Assistant on Duty:</b> ${esc(mod)||'_______________'}<br><b>Checks Conducted:</b> ${checks.length}<br><b>Active Clients:</b> ${activeClients.length} &nbsp; <span class="badge">FILING COPY</span></div></div><div class="hint">✓ = present &nbsp; ✗ = not located &nbsp; WORK / PASS / OUT / BHC / EFC / HOSP = off-site status</div><div class="wrap"><table><thead><tr><th class="rm-td" style="width:42px;">Rm</th><th style="width:155px;">Client Name</th>${thCols}<th class="notes-td">Notes</th></tr></thead><tfoot><tr class="sum"><td colspan="2" style="text-align:left;padding-left:6px;">Total Accounted For:</td>${totalCells}<td></td></tr><tr class="init-row"><td colspan="2" style="text-align:right;padding-right:8px;font-size:10px;font-weight:700;">PA:</td>${initCells}<td></td></tr></tfoot><tbody>${clientRows}</tbody></table></div><div class="sig"><div class="sig-b">Filed By: <span class="sig-l"></span></div><div class="sig-b">Supervisor Review: <span class="sig-l"></span></div><div class="sig-b">Date Filed: <span class="sig-l"></span></div></div></body></html>`
    const w = window.open('', '_blank')
    if (!w) { alert('Popup blocked — allow popups for this site.'); return }
    w.document.write(html); w.document.close()
    setTimeout(() => { try { w.focus(); w.print() } catch { /* empty */ } }, 250)
  }

  async function sendOutlook() {
    if (!activeReport) { alert('No active shift report to email.'); return }
    const shift   = activeReport?.shift || ''
    const dateVal = activeReport?.report_date || ''
    const mod     = activeReport?.mod_name || ''
    const fn      = data?.facility_name || 'OpsPoint'
    const dateStr = dateVal ? new Date(dateVal + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : ''
    try {
      const u8  = await generateDocx()
      const fname = _docxFilename()
      const blob  = new Blob([u8], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
      const url   = URL.createObjectURL(blob)
      const a     = document.createElement('a')
      a.href = url; a.download = fname; document.body.appendChild(a); a.click()
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url) }, 1000)
    } catch(e) { console.error('DOCX generation failed:', e) }
    setTimeout(() => {
      const subj = encodeURIComponent([fn, shift ? shift + ' Report' : 'Shift Report', dateStr].filter(Boolean).join(' — '))
      const body = encodeURIComponent((shift ? shift + ' Report' : 'Shift Report') + (dateStr ? '\nDate: ' + dateStr : '') + (mod ? '\nMOD: ' + mod : '') + '\n\nShift report attached.' + `\n\n(Attach "${_docxFilename()}" before sending.)`)
      window.location.href = 'mailto:?subject=' + subj + '&body=' + body
    }, 400)
  }

  async function ackUA(id) {
    await fetch(`/api/ua-requests/${id}/acknowledge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: '{}'
    })
  }

  const draws24h = (notif.uaDraws || []).filter(d => {
    const ts = d.created_at ? new Date(d.created_at.replace(' ','T')+'Z').getTime() : 0
    return ts >= Date.now() - 24*3600000 && !dismissedDrawIds.has(d.id)
  })
  const badgeCount =
    (hasPerm('ua.acknowledge') ? notif.uaRequests.length : 0) +
    ((hasPerm('ua.draw') || hasPerm('ua.acknowledge')) ? draws24h.length : 0) +
    (hasPerm('violations.notify_review') && notif.violReview > (dismissedViolReview || 0) ? 1 : 0) +
    (hasPerm('violations.notify_consequence') && notif.violConsequence > (dismissedViolConsequence || 0) ? 1 : 0) +
    (hasPerm('broadcast.receive') ? notif.broadcasts.length : 0) +
    (hasPerm('incidents.review') ? (notif.incidents || []).length : 0)

  return (
    <>
      {serverRestarting && (
        <div style={{ background: '#DC2626', color: '#fff', textAlign: 'center', padding: '6px 12px', fontSize: '13px', fontWeight: 700, position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40 }}>
          Server is restarting — page will reload in a moment…
        </div>
      )}
      <nav className={`fixed top-0 ${offset ? 'left-64' : 'left-0'} right-0 z-30 h-16 bg-white border-b border-gray-200 dark:bg-gray-800 dark:border-gray-700`}>
        <div className="flex items-center justify-between h-full px-5">
          {/* Left: global search */}
          <form className="hidden md:block" onSubmit={e => e.preventDefault()}>
            <div className="relative md:w-72 lg:w-96">
              <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none"><Search className="w-4 h-4 text-gray-400" /></div>
              <input type="text" value={search} onChange={e => onSearch?.(e.target.value)} placeholder="Search residents, rooms, logs…"
                className="block w-full py-2.5 pl-10 pr-3 text-sm text-gray-900 border border-gray-200 rounded-lg bg-gray-50 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
            </div>
          </form>

          {/* Right: save · live · actions ⋯ · notifications · gear · theme · avatar */}
          <div className="flex items-center gap-1 sm:gap-2">
            {saveStatus === 'saving' && <span className="hidden mr-1 text-xs font-medium text-gray-400 sm:inline">Saving…</span>}
            {saveStatus === 'saved'  && <span className="hidden mr-1 text-xs font-medium text-green-600 sm:inline dark:text-green-400">Saved</span>}
            {saveStatus === 'err'    && <span className="hidden mr-1 text-xs font-medium text-red-600 sm:inline dark:text-red-400">Save failed</span>}
            <span title={wsConnected ? 'Server connected' : 'Reconnecting…'} className={`items-center hidden gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full sm:inline-flex ${wsConnected ? 'text-green-700 bg-green-100 dark:bg-green-900/40 dark:text-green-300' : 'text-gray-500 bg-gray-100 dark:bg-gray-700 dark:text-gray-300'}`}>
              <span className="relative flex w-2 h-2">
                {wsConnected && <span className="absolute inline-flex w-full h-full bg-green-400 rounded-full opacity-75 animate-ping" />}
                <span className={`relative inline-flex w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500' : 'bg-gray-400'}`} />
              </span>{wsConnected ? 'Live' : 'Offline'}
            </span>
            {(hasPerm('reports.create') || hasPerm('broadcast.send')) && (
              <div className="relative" ref={moreRef}>
                <button onClick={() => setMoreOpen(o => !o)} title="Shift actions" className="p-2 text-gray-500 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-400">
                  <MoreHorizontal className="w-5 h-5" />
                </button>
                {moreOpen && (
                  <div className="absolute right-0 z-50 mt-1 p-1.5 bg-white border border-gray-200 shadow-lg w-56 rounded-xl dark:bg-gray-800 dark:border-gray-700">
                    {hasPerm('reports.create') && uiVis.buttons?.walkthrough !== false && (
                      <button onClick={() => { setMoreOpen(false); fileWalkthroughs() }} className="flex items-center w-full gap-2.5 px-3 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700">
                        <Footprints className="w-4 h-4 text-gray-400" /><span className="flex-1 text-left">File Walkthrough</span>
                      </button>
                    )}
                    {hasPerm('reports.create') && uiVis.buttons?.wellness !== false && (
                      <button onClick={() => { setMoreOpen(false); fileWellnessChecks() }} className="flex items-center w-full gap-2.5 px-3 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700">
                        <HeartPulse className="w-4 h-4 text-gray-400" /><span className="flex-1 text-left">File Wellness</span>
                      </button>
                    )}
                    {hasPerm('reports.create') && (
                      <button onClick={() => { setMoreOpen(false); sendOutlook() }} className="flex items-center w-full gap-2.5 px-3 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700">
                        <Mail className="w-4 h-4 text-gray-400" /><span className="flex-1 text-left">Email Report</span>
                      </button>
                    )}
                    {hasPerm('broadcast.send') && (
                      <button onClick={() => { setMoreOpen(false); setBroadcastOpen(true) }} className="flex items-center w-full gap-2.5 px-3 py-2 text-sm font-medium text-gray-700 rounded-md hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700">
                        <Megaphone className="w-4 h-4 text-gray-400" /><span className="flex-1 text-left">Announce</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            <button onClick={() => setPanelOpen(o => !o)} title="Notifications" className="relative p-2 text-gray-500 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-400">
              <Bell className="w-5 h-5" />
              {badgeCount > 0 && (
                <span className="absolute flex items-center justify-center px-1 min-w-4 h-4 text-[10px] font-bold text-white bg-red-500 rounded-full top-1 right-1">{badgeCount > 99 ? '99+' : badgeCount}</span>
              )}
            </button>

            <SettingsMenu
              showAdmin={hasPerm('admin.users')}
              onAbout={() => navigate('/about')}
              onAdmin={() => navigate('/admin')}
              onSignOut={handleLogout}
            />

            <button onClick={() => setDark(d => !d)} title="Toggle theme" className="p-2 text-gray-500 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 dark:text-gray-400">
              {dark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>

            <div className="hidden w-px h-6 mx-1 bg-gray-200 sm:block dark:bg-gray-700" />
            <span className="flex items-center justify-center text-xs font-semibold rounded-full w-8 h-8 bg-primary-100 text-primary-700 dark:bg-primary-900/50 dark:text-primary-300">
              {(session?.displayName || session?.username || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
            </span>
          </div>
        </div>
      </nav>

      <NotifPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        notif={notif}
        session={session}
        dismissBroadcast={dismissBroadcast}
        dismissIncident={dismissIncident}
        onAckUA={ackUA}
        onGoTab={onGoTab}
        dismissedDrawIds={dismissedDrawIds}
        dismissDraw={dismissDraw}
        dismissedViolReview={dismissedViolReview}
        dismissedViolConsequence={dismissedViolConsequence}
        dismissViolReview={dismissViolReview}
        dismissViolConsequence={dismissViolConsequence}
      />

      <BroadcastModal open={broadcastOpen} onClose={() => setBroadcastOpen(false)} />
    </>
  )
}

// ── Inner shell (has access to DataContext) ───────────────────────────
function InnerShell() {
  const { session, logout } = useAuth()
  const { hasPerm }      = usePermission()
  const { data }         = useData()
  const location         = useLocation()

  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('dashboard')
  const [requestedTab, setRequestedTab] = useState(null)
  const [drawOpen, setDrawOpen]   = useState(false)
  const [globalSearch, setGlobalSearch] = useState('')

  const isAdmin    = location.pathname === '/admin'
  const isClinical = location.pathname.startsWith('/clinical')
  const fullBleed  = isAdmin || isClinical   // routes that supply their own layout

  const uiVis = useMemo(() => {
    const def = { tabs: {}, buttons: {} }
    if (!data?.ui_visibility) return def
    try { return typeof data.ui_visibility === 'string' ? JSON.parse(data.ui_visibility) : data.ui_visibility }
    catch { return def }
  }, [data])

  const activeReport = data?.reports?.find(r => r.id === data?.active_report_id)
  const statuses     = activeReport?.statuses || {}
  const clients      = data?.clients || []
  const facilityName = data?.facility_name || 'OpsPoint'

  const onHome    = () => { setActiveTab('dashboard'); navigate('/') }
  const onSignOut = async () => { await logout(); navigate('/login') }

  return (
    <>
      <Header onGoTab={setRequestedTab} offset={!fullBleed} search={globalSearch} onSearch={setGlobalSearch} />
      {!fullBleed && (
        <Sidebar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          session={session}
          facilityName={facilityName}
          hasPerm={hasPerm}
          uiVis={uiVis}
          onDrawOpen={() => setDrawOpen(true)}
          onClinical={() => navigate('/clinical')}
          onHome={onHome}
          onSignOut={onSignOut}
        />
      )}
      <main className={`${fullBleed ? '' : 'ml-64'} pt-16 h-screen overflow-hidden flex flex-col bg-gray-50 dark:bg-gray-900`}>
        <Outlet context={{ activeTab, setActiveTab, requestedTab, clearRequestedTab: () => setRequestedTab(null), globalSearch }} />
      </main>
      <ClientProfile onNavigateTab={setRequestedTab} />
      <UADrawModal
        open={drawOpen}
        onClose={() => setDrawOpen(false)}
        clients={clients}
        statuses={statuses}
      />
    </>
  )
}

// ── Dark-mode hook (Tailwind class strategy + localStorage) ───────────
function useDarkMode() {
  const [dark, setDark] = useState(() => {
    if (typeof window === 'undefined') return false
    const s = localStorage.getItem('opspoint-theme')
    return s ? s === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('opspoint-theme', dark ? 'dark' : 'light')
  }, [dark])
  return [dark, setDark]
}

// ── AppShell ───────────────────────────────────────────────────────────
export default function AppShell() {
  return (
    <DataProvider>
      <InnerShell />
    </DataProvider>
  )
}
