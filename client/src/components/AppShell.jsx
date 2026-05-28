import { useState, useCallback, useMemo } from 'react'
import { Outlet, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'
import { usePermission } from '../hooks/usePermission.js'
import { DataProvider, useData } from '../contexts/DataContext.jsx'
import ClientProfile from './ClientProfile.jsx'
import JSZip from 'jszip'

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
          <span>🔔 Notifications</span>
          <button className="xbtn" style={{ color: '#fff' }} onClick={onClose}>✕</button>
        </div>
        <div className="notif-panel-body">

          {/* UA Requests — visible only to staff who can acknowledge them */}
          {notif.uaRequests.length > 0 && perm.includes('ua.acknowledge') && (
            <div className="notif-section">
              <div className="notif-section-head">
                🧪 UA Requests
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

          {/* UA Draws — visible to staff who can run / see UA work */}
          {draws24h.length > 0 && (perm.includes('ua.draw') || perm.includes('ua.acknowledge')) && (
            <div className="notif-section">
              <div className="notif-section-head">
                🎲 UA Draws (24h)
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
                      <div style={{ fontSize: '.72rem', color: '#475569', paddingLeft: 32 }}>
                        {d.residents.slice(0, 5).map(r => `Rm.${r.room} ${r.name}`).join(', ')}
                        {d.residents.length > 5 ? '…' : ''}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Violations — pending review */}
          {notif.violReview > 0 && notif.violReview > (dismissedViolReview || 0) && perm.includes('violations.notify_review') && (
            <div className="notif-section">
              <div className="notif-section-head">
                🔴 Violations: Pending Review
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

          {/* Violations — consequence assigned */}
          {notif.violConsequence > 0 && notif.violConsequence > (dismissedViolConsequence || 0) && perm.includes('violations.notify_consequence') && (
            <div className="notif-section">
              <div className="notif-section-head">
                🟠 Consequence Assigned
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

          {/* Incident alerts — visible to staff who review incidents */}
          {(notif.incidents || []).length > 0 && perm.includes('incidents.review') && (
            <div className="notif-section">
              <div className="notif-section-head">
                🚨 New Incidents
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
                      <span style={{ fontWeight:700, fontSize:'.68rem', padding:'1px 7px', borderRadius:8,
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

          {/* Broadcasts */}
          {notif.broadcasts.length > 0 && perm.includes('broadcast.receive') && (
            <div className="notif-section">
              <div className="notif-section-head">
                📢 Announcements
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
                        : <span style={{ fontSize: '.63rem', color: '#94a3b8', flexShrink: 0, textAlign: 'center', lineHeight: 1.3 }}>dismissable<br/>after 12h</span>
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
          <h2>📢 Send Announcement</h2>
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
            <div style={{ textAlign: 'right', fontSize: '.72rem', color: '#94a3b8' }}>{text.length} / 500</div>
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

// ── Header ─────────────────────────────────────────────────────────────
function Header({ onGoTab }) {
  const { session, logout }                 = useAuth()
  const { hasPerm }                         = usePermission()
  const { data, saveStatus, notif, serverRestarting, wsConnected, dismissBroadcast, dismissIncident } = useData()
  const navigate                            = useNavigate()

  const [panelOpen, setPanelOpen]           = useState(false)
  const [broadcastOpen, setBroadcastOpen]   = useState(false)

  // Dismissed UA draw IDs — stored in localStorage so they survive page refresh
  const [dismissedDrawIds, setDismissedDrawIds] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('spDismissedDraws') || '[]')) }
    catch { return new Set() }
  })

  function dismissDraw(id) {
    setDismissedDrawIds(prev => {
      const next = new Set(prev)
      next.add(id)
      try { localStorage.setItem('spDismissedDraws', JSON.stringify([...next])) } catch {}
      return next
    })
  }

  // Dismissed violation counts (stored as the count that was dismissed — re-shows if count increases)
  const [dismissedViolReview, setDismissedViolReview] = useState(() => {
    try { return parseInt(localStorage.getItem('spDismissedViolReview') || '0') } catch { return 0 }
  })
  const [dismissedViolConsequence, setDismissedViolConsequence] = useState(() => {
    try { return parseInt(localStorage.getItem('spDismissedViolConsequence') || '0') } catch { return 0 }
  })
  function dismissViolReview(count) {
    setDismissedViolReview(count)
    try { localStorage.setItem('spDismissedViolReview', String(count)) } catch {}
  }
  function dismissViolConsequence(count) {
    setDismissedViolConsequence(count)
    try { localStorage.setItem('spDismissedViolConsequence', String(count)) } catch {}
  }

  const facilityName = data?.facility_name || 'OpsPoint'

  // UI visibility — controls which header buttons are shown
  const uiVis = useMemo(() => {
    const def = { tabs: {}, buttons: {} }
    if (!data?.ui_visibility) return def
    try { return typeof data.ui_visibility === 'string' ? JSON.parse(data.ui_visibility) : data.ui_visibility }
    catch { return def }
  }, [data?.ui_visibility])

  // Current active report (for print functions)
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
  function _secHdr(text){return _para(_run(' '+text,{sz:11,bold:true,col:'FFFFFF'}),{shade:'1A3327',sb:280,sa:0})}
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
      const st=statuses[c.id]||'building'; if(cnt.hasOwnProperty(st))cnt[st]++
    })
    const tot=Object.values(cnt).reduce((a,b)=>a+b,0)
    const CW=9360
    let body=''
    // Letterhead
    body+=_para(_run('',{sz:4}),{shade:'D4A017',sb:0,sa:0})
    body+=_para([_run(fn,{sz:8,col:'A8D5B5',bold:true})],{shade:'163825',sb:0,sa:0,align:'center'})
    body+=_para(_run(fn,{sz:24,bold:true,col:'FFFFFF'}),{shade:'1A3327',sb:0,sa:0,align:'center'})
    body+=_para(_run(shiftFull,{sz:13,col:'D4E6DA'}),{shade:'2D6A4F',sb:0,sa:0,align:'center'})
    body+=_para(_run('',{sz:4}),{shade:'D4A017',sb:0,sa:200})
    // Info table
    const iCols=[2800,CW-2800]
    const infoRows=[['Date',dateStr],['Shift',shiftFull],['Program Assistant on Duty (PA)',mv||'—']].map(([l,v])=>
      _tr(_tc(l,iCols[0],{bold:true,sz:9,col:'5C6B5E',shade:'F4FAF6'})+_tc(v,iCols[1],{sz:10,col:'1A3327'}))
    )
    body+=_tbl(iCols,infoRows)+_ep(140)
    // Census
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
    // Activity log
    body+=_secHdr('SHIFT ACTIVITY LOG')
    if(!logEntrs.length){body+=_para(_run('No entries recorded.',{sz:10,col:'94A3B8',italic:true}),{sa:40,il:160})}
    else{const lC=[1000,CW-1000];body+=_tbl(lC,logEntrs.map((e,i)=>_tr(_tc(e.time,lC[0],{bold:true,sz:10,col:'2D6A4F',shade:i%2===0?'FFFFFF':'F4FAF6'})+_tc(e.text,lC[1],{sz:10,col:'111111',shade:i%2===0?'FFFFFF':'F4FAF6'}))))+_ep(140)}
    // Issues
    body+=_secHdr('ISSUES & CONCERNS')
    if(!issues.length){body+=_para(_run('None.',{sz:10,col:'94A3B8',italic:true}),{sa:40,il:160})}
    else{issues.forEach((v,i)=>{body+=_para([_run('●  ',{sz:10,col:'D4A017',bold:true}),_run(v,{sz:10,col:'111111'})],{sa:60,il:200,shade:i%2===0?'FFFFFF':'FFFBF0'})})}
    body+=_ep(140)
    // Medical notes
    if(medNotes.length){body+=_secHdr('MEDICAL NOTES');medNotes.forEach((n,i)=>{body+=_para([_run('●  ',{sz:10,col:'D4A017',bold:true}),_run(n,{sz:10,col:'111111'})],{sa:60,il:200,shade:i%2===0?'FFFBF0':'FFFFFF'})});body+=_ep(140)}
    // Roster
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
    // Assemble XML
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

  // ── File Walkthroughs — filled filing copy ──────────────────────────
  function fileWalkthroughs() {
    const shift   = activeReport?.shift || ''
    const dateVal = activeReport?.report_date || ''
    const mod     = activeReport?.mod_name || ''
    const fn      = data?.facility_name || 'OpsPoint'
    const dateStr = dateVal
      ? new Date(dateVal + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    const shiftLabels = {
      'Day Shift':       'Day Shift (7:00 a.m. – 3:30 p.m.)',
      'Swing Shift':     'Swing Shift (3:00 p.m. – 11:30 p.m.)',
      'Graveyard Shift': 'Graveyard Shift (11:00 p.m. – 7:30 a.m.)',
    }
    const logEntries = activeReport?.log_entries || []
    const walks = logEntries.filter(e => e.text && e.text.toLowerCase().includes('walkthrough'))
    if (walks.length === 0) {
      alert('No building walkthroughs found in the activity log for this shift.')
      return
    }
    const rows = walks.map((e, i) => {
      const byMatch = e.text.match(/conducted(?:\s+by\s+(.+?))?[.,]/i)
      const monitor = (byMatch && byMatch[1]) ? byMatch[1].trim() : (mod || '—')
      let area = 'Full Building'
      if (/All areas checked:/i.test(e.text)) area = 'All Areas'
      else if (/Areas checked:/i.test(e.text)) {
        const m2 = e.text.match(/Areas checked:\s*([^.]+)/i)
        if (m2) {
          const aList = m2[1].split(',')
          area = aList.length > 2 ? `${aList.length} Areas` : aList.map(s => s.trim()).join(', ')
        }
      }
      const notes = e.text
        .replace(/Building walkthrough conducted(\s+by\s+[^.]+)?\.?\s*/i, '')
        .replace(/(All )?[Aa]reas checked:[^.]+\.\s*/g, '')
        .replace(/Not checked:[^.]+\.\s*/g, '')
        .trim()
      const hasIssue = !e.text.toLowerCase().includes('all is well') && !e.text.toLowerCase().includes('nothing to report')
      const rowBg = hasIssue ? 'background:#fef9c3;' : (i % 2 === 1 ? 'background:#F4F6F8;' : '')
      return `<tr style="${rowBg}border-bottom:1px solid #D0DAEF;">
        <td style="padding:6px 8px;font-weight:700;font-family:monospace;color:#1B2F6E;white-space:nowrap;">${esc(e.time)}</td>
        <td style="padding:6px 8px;font-weight:600;color:#3A5499;">${esc(monitor)}</td>
        <td style="padding:6px 8px;color:#555;">${esc(area)}</td>
        <td style="padding:6px 8px;">${esc(notes)}</td>
      </tr>`
    }).join('')
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Building Walkthrough Filing</title>
<style>* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:Arial,sans-serif; font-size:11px; color:#111; background:#fff; }
.page-hdr { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2.5px solid #1B2F6E; padding:16px 20px 10px; }
.org { font-size:7px; font-weight:700; letter-spacing:.8px; color:#3A5499; text-transform:uppercase; margin-bottom:3px; }
.title { font-size:16px; font-weight:700; color:#1B2F6E; }
.sub-title { font-size:9.5px; color:#444; margin-top:3px; }
.hdr-right { text-align:right; font-size:9.5px; color:#444; line-height:2; }
.hdr-right b { color:#1B2F6E; }
.badge { display:inline-block; background:#dbeafe; color:#1e40af; font-weight:700; font-size:9px; padding:2px 8px; border-radius:10px; border:1px solid #93c5fd; }
.wrap { padding:12px 20px; }
table { width:100%; border-collapse:collapse; }
thead th { background:#1B2F6E; color:#fff; padding:7px 8px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.4px; text-align:left; }
td { border-bottom:1px solid #D0DAEF; vertical-align:middle; font-size:11px; padding:0; }
.summary { margin:14px 20px 0; padding:10px 14px; background:#F4F6F8; border:1px solid #D0DAEF; border-radius:6px; font-size:10px; color:#333; }
.sig { display:flex; gap:24px; padding:16px 20px 18px; border-top:1.5px solid #999; margin-top:10px; }
.sig-b { flex:1; font-size:9.5px; font-weight:700; color:#333; }
.sig-l { display:inline-block; border-bottom:1px solid #333; width:55%; margin-left:4px; }
@media print { @page { size:letter portrait; margin:0.4in; } .wrap { padding:0; } .sig { padding:12px 0 0; } .summary { margin:12px 0 0; } }
</style></head><body>
<div class="page-hdr">
  <div>
    <div class="org">${esc(fn)}</div>
    <div class="title">${esc(fn)} — Building Walkthrough Filing Record</div>
    <div class="sub-title">${esc(shiftLabels[shift] || shift)} &nbsp;|&nbsp; ${dateStr}</div>
  </div>
  <div class="hdr-right">
    <b>Program Assistant on Duty:</b> ${esc(mod) || '_______________'}<br>
    <b>Total Walkthroughs:</b> ${walks.length}<br>
    <span class="badge">FILING COPY</span>
  </div>
</div>
<div class="wrap">
  <table>
    <thead><tr>
      <th style="width:80px;">Time</th>
      <th style="width:150px;">Conducted By</th>
      <th style="width:130px;">Area</th>
      <th>Notes / Findings</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>
<div class="summary"><strong>Summary:</strong> &nbsp; ${walks.length} walkthrough(s) conducted this shift.</div>
<div class="sig">
  <div class="sig-b">Filed By: <span class="sig-l"></span></div>
  <div class="sig-b">Supervisor Review: <span class="sig-l"></span></div>
  <div class="sig-b">Date Filed: <span class="sig-l"></span></div>
</div>
</body></html>`
    const w = window.open('', '_blank')
    if (!w) { alert('Popup blocked — allow popups for this site.'); return }
    w.document.write(html); w.document.close()
    // Trigger print from parent context (CSP: no inline scripts allowed)
    setTimeout(() => { try { w.focus(); w.print() } catch {} }, 250)
  }

  // ── File Wellness Checks — filled filing copy ────────────────────────
  function fileWellnessChecks() {
    const shift   = activeReport?.shift || ''
    const dateVal = activeReport?.report_date || ''
    const mod     = activeReport?.mod_name || ''
    const fn      = data?.facility_name || 'OpsPoint'
    const dateStr = dateVal
      ? new Date(dateVal + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    const shiftLabels = {
      'Day Shift':       'Day Shift (7:00 a.m. – 3:30 p.m.)',
      'Swing Shift':     'Swing Shift (3:00 p.m. – 11:30 p.m.)',
      'Graveyard Shift': 'Graveyard Shift (11:00 p.m. – 7:30 a.m.)',
    }
    const logEntries = activeReport?.log_entries || []
    const checks = logEntries.filter(e => e.text && e.text.toLowerCase().startsWith('wellness check'))
    if (checks.length === 0) {
      alert('No wellness checks found in the activity log for this shift.')
      return
    }
    // Build one column per check
    const checkCols = checks.map(e => {
      const byMatch = e.text.match(/conducted(?:\s+by\s+(.+?))?\./)
      const monitor = (byMatch && byMatch[1]) ? byMatch[1].trim() : (mod || '—')
      const notLocated = []
      const nlMatch = e.text.match(/Not located:\s*(.+?)\.?\s*$/i)
      if (nlMatch) {
        nlMatch[1].split(',').forEach(s => {
          const rm = s.trim().match(/Rm\.?\s*(\d+)/i)
          if (rm) notLocated.push(parseInt(rm[1]))
        })
      }
      return { time: e.time, monitor, notLocated }
    })
    const activeClients = (data?.clients || [])
      .filter(c => c.is_active && !c.is_special && c.name !== 'VACANT')
      .slice().sort((a, b) => (parseInt(a.room) || 0) - (parseInt(b.room) || 0))
    const statuses = activeReport?.statuses || {}
    const statusLabel = { bhc: 'BHC', efc: 'EFC', hospital: 'HOSP', work: 'WORK', pass: 'PASS', out: 'OUT', building: '', vacant: '' }
    const statusBg    = { bhc: '#ede9fe', efc: '#fce7f3', hospital: '#fee2e2', work: '#dbeafe', pass: '#fef9c3', out: '#fff7ed', building: '', vacant: '' }
    const colWidth = Math.max(55, Math.min(80, Math.floor(400 / checkCols.length)))
    const thCols = checkCols.map(col =>
      `<th class="chk-th">${esc(col.time)}<div style="font-size:8px;font-weight:400;color:#A8C0E8;margin-top:2px;">${esc(col.monitor)}</div></th>`
    ).join('')
    const clientRows = activeClients.map((c, i) => {
      const st = statuses[c.id] || 'building'
      const isOut = ['work','pass','bhc','efc','hospital','out'].includes(st)
      const cells = checkCols.map(col => {
        const wasNotLocated = col.notLocated.includes(parseInt(c.room))
        if (isOut && !wasNotLocated) {
          const lbl = statusLabel[st] || st.toUpperCase()
          const bg  = statusBg[st] || ''
          return `<td class="chk-td" style="background:${bg};font-size:9px;font-weight:700;text-align:center;">${lbl}</td>`
        }
        if (wasNotLocated) return `<td class="chk-td" style="background:#fee2e2;color:#991b1b;font-weight:700;text-align:center;font-size:13px;">✗</td>`
        return `<td class="chk-td" style="text-align:center;font-size:13px;color:#15803d;">✓</td>`
      }).join('')
      const rowBg = i % 2 === 1 ? '#F4F6F8' : '#fff'
      return `<tr style="background:${rowBg};border-bottom:1px solid #D0DAEF;">
        <td class="rm-td">${esc(c.room)}</td>
        <td class="name-td">${esc(c.name)}</td>
        ${cells}
        <td class="notes-td"></td>
      </tr>`
    }).join('')
    const totalCells = checkCols.map(col => {
      const accounted = activeClients.length - col.notLocated.length
      return `<td class="chk-td" style="text-align:center;font-weight:700;font-size:10px;">${accounted} / ${activeClients.length}</td>`
    }).join('')
    const initCells = checkCols.map(col =>
      `<td class="chk-td" style="border-bottom:2px solid #1B2F6E;text-align:center;height:26px;font-size:9px;font-weight:700;color:#3A5499;">${esc(col.monitor.split(' ')[0])}</td>`
    ).join('')
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Wellness Check Filing</title>
<style>* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:Arial,sans-serif; font-size:11px; color:#111; background:#fff; }
.page-hdr { display:flex; justify-content:space-between; align-items:flex-end; border-bottom:2.5px solid #1B2F6E; padding:16px 20px 8px; }
.org { font-size:7px; font-weight:700; letter-spacing:.8px; color:#3A5499; text-transform:uppercase; margin-bottom:2px; }
.title { font-size:15px; font-weight:700; color:#1B2F6E; }
.sub-title { font-size:9.5px; color:#444; margin-top:2px; }
.hdr-right { text-align:right; font-size:9.5px; color:#444; line-height:1.85; }
.hdr-right b { color:#1B2F6E; }
.badge { display:inline-block; background:#d1fae5; color:#065f46; font-weight:700; font-size:9px; padding:2px 8px; border-radius:10px; border:1px solid #6ee7b7; }
.hint { font-size:8px; color:#888; font-style:italic; padding:4px 20px 2px; }
.wrap { padding:0 20px 10px; }
table { width:100%; border-collapse:collapse; }
thead { display:table-header-group; } tfoot { display:table-footer-group; }
thead tr th { background:#1B2F6E; color:#fff; padding:6px 7px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.4px; border:1px solid #163825; text-align:left; }
.rm-td { font-family:monospace; font-weight:700; color:#555; text-align:center; width:42px; padding:4px 6px; }
.name-td { width:155px; padding:4px 6px; font-weight:500; }
.chk-th { width:${colWidth}px; text-align:center; border-left:1px solid #245c3a; padding:5px 4px; }
.chk-td { width:${colWidth}px; border-left:1.5px solid #8dbda0; padding:4px; vertical-align:middle; }
.notes-td { padding:4px 6px; }
td { vertical-align:middle; border-right:1px solid #D0DAEF; font-size:11px; }
td:last-child { border-right:none; }
tfoot tr.sum td { background:#dff0e6; border-top:2px solid #1B2F6E; font-weight:700; font-size:10px; padding:5px 6px; }
tfoot tr.init-row td { background:#f0f7f2; border-top:1px solid #8dbda0; padding:4px; }
.sig { display:flex; gap:20px; padding:10px 20px 14px; border-top:1.5px solid #999; margin-top:4px; }
.sig-b { flex:1; font-size:9px; font-weight:700; color:#333; }
.sig-l { display:inline-block; border-bottom:1px solid #333; width:55%; margin-left:4px; }
@media print { @page { size:letter portrait; margin:0.35in; } body { font-size:10px; } .wrap { padding:0; } .hint { padding:3px 0 1px; } .sig { padding:8px 0 0; } }
</style></head><body>
<div class="page-hdr">
  <div>
    <div class="org">${esc(fn)}</div>
    <div class="title">${esc(fn)} — Wellness Check Filing Record</div>
    <div class="sub-title">${esc(shiftLabels[shift] || shift)} | ${dateStr}</div>
  </div>
  <div class="hdr-right">
    <b>Program Assistant on Duty:</b> ${esc(mod) || '_______________'}<br>
    <b>Checks Conducted:</b> ${checks.length}<br>
    <b>Active Clients:</b> ${activeClients.length} &nbsp; <span class="badge">FILING COPY</span>
  </div>
</div>
<div class="hint">✓ = present &nbsp; ✗ = not located &nbsp; WORK / PASS / OUT / BHC / EFC / HOSP = off-site status</div>
<div class="wrap"><table>
  <thead><tr>
    <th class="rm-td" style="width:42px;">Rm</th>
    <th style="width:155px;">Client Name</th>
    ${thCols}
    <th class="notes-td">Notes</th>
  </tr></thead>
  <tfoot>
    <tr class="sum"><td colspan="2" style="text-align:left;padding-left:6px;">Total Accounted For:</td>${totalCells}<td></td></tr>
    <tr class="init-row"><td colspan="2" style="text-align:right;padding-right:8px;font-size:10px;font-weight:700;">PA:</td>${initCells}<td></td></tr>
  </tfoot>
  <tbody>${clientRows}</tbody>
</table></div>
<div class="sig">
  <div class="sig-b">Filed By: <span class="sig-l"></span></div>
  <div class="sig-b">Supervisor Review: <span class="sig-l"></span></div>
  <div class="sig-b">Date Filed: <span class="sig-l"></span></div>
</div>
</body></html>`
    const w = window.open('', '_blank')
    if (!w) { alert('Popup blocked — allow popups for this site.'); return }
    w.document.write(html); w.document.close()
    // Trigger print from parent context (CSP: no inline scripts allowed)
    setTimeout(() => { try { w.focus(); w.print() } catch {} }, 250)
  }

  // ── Email shift report — generate DOCX then open mailto ──────────────
  async function sendOutlook() {
    if (!activeReport) { alert('No active shift report to email.'); return }
    const shift   = activeReport?.shift || ''
    const dateVal = activeReport?.report_date || ''
    const mod     = activeReport?.mod_name || ''
    const fn      = data?.facility_name || 'OpsPoint'
    const dateStr = dateVal
      ? new Date(dateVal + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : ''
    // 1. Generate and download the DOCX
    try {
      const u8  = await generateDocx()
      const fname = _docxFilename()
      const blob  = new Blob([u8], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
      const url   = URL.createObjectURL(blob)
      const a     = document.createElement('a')
      a.href = url; a.download = fname; document.body.appendChild(a); a.click()
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url) }, 1000)
    } catch(e) {
      console.error('DOCX generation failed:', e)
    }
    // 2. Open mailto (small delay so download starts first)
    setTimeout(() => {
      const subj = encodeURIComponent([fn, shift ? shift + ' Report' : 'Shift Report', dateStr].filter(Boolean).join(' — '))
      const body = encodeURIComponent(
        (shift ? shift + ' Report' : 'Shift Report') +
        (dateStr ? '\nDate: ' + dateStr : '') +
        (mod     ? '\nMOD: '  + mod     : '') +
        '\n\nShift report attached.' +
        `\n\n(Attach "${_docxFilename()}" before sending.)`
      )
      window.location.href = 'mailto:?subject=' + subj + '&body=' + body
    }, 400)
  }

  // Acknowledge UA from notification panel
  async function ackUA(id) {
    await fetch(`/api/ua-requests/${id}/acknowledge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: '{}'
    })
  }

  // Badge count (excluding dismissed draws)
  const draws24h    = (notif.uaDraws || []).filter(d => {
    const ts = d.created_at ? new Date(d.created_at.replace(' ','T')+'Z').getTime() : 0
    return ts >= Date.now() - 24*3600000 && !dismissedDrawIds.has(d.id)
  })
  // Badge count — gate each contribution by the relevant permission so users only see
  // counts for events they can act on / are supposed to be notified about
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
        <div style={{
          background: '#DC2626', color: '#fff', textAlign: 'center',
          padding: '6px 12px', fontSize: '.82rem', fontWeight: 700, flexShrink: 0,
        }}>
          ⚠ Server is restarting — page will reload in a moment…
        </div>
      )}
      <header className="site-header">
        <div className="site-header-left">
          <img src="/static/icons/icon-192.png" alt="" className="header-logo" />
          <div>
            <h1>{facilityName}</h1>
            <div className="sub">OpsPoint</div>
          </div>
        </div>
        <div className="header-actions">
          {saveStatus === 'saving' && <div className="save-status saving"><span className="sindot" />Saving…</div>}
          {saveStatus === 'saved'  && <div className="save-status saved" ><span className="sindot" />Saved</div>}
          {saveStatus === 'err'    && <div className="save-status err"   ><span className="sindot" />Save failed</div>}

          {/* Connection status */}
          <div title={wsConnected ? 'Server connected' : 'Reconnecting…'} style={{
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: '.68rem', color: wsConnected ? '#86efac' : '#fca5a5', fontWeight: 600,
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: wsConnected ? '#22c55e' : '#ef4444',
              flexShrink: 0, display: 'inline-block',
            }} />
            {wsConnected ? 'Live' : 'Offline'}
          </div>

          {/* Filing / Email buttons */}
          {hasPerm('reports.create') && (
            <>
              {uiVis.buttons?.walkthrough !== false && (
                <button onClick={fileWalkthroughs} title="File Walkthrough — filled filing record"
                  className="btn btn-outline btn-sm" style={{ fontSize: '.68rem', padding: '5px 9px', background: 'rgba(219,234,254,.15)', borderColor: 'rgba(147,197,253,.4)', color: 'rgba(255,255,255,.8)' }}>
                  📋 File Walkthrough
                </button>
              )}
              {uiVis.buttons?.wellness !== false && (
                <button onClick={fileWellnessChecks} title="File Wellness Check — filled filing record"
                  className="btn btn-outline btn-sm" style={{ fontSize: '.68rem', padding: '5px 9px', background: 'rgba(220,252,231,.15)', borderColor: 'rgba(110,231,183,.4)', color: 'rgba(255,255,255,.8)' }}>
                  💚 File Wellness
                </button>
              )}
              <button onClick={sendOutlook} title="Email shift report"
                className="btn btn-outline btn-sm" style={{ fontSize: '.68rem', padding: '5px 9px', background: 'rgba(254,243,199,.15)', borderColor: 'rgba(253,224,132,.4)', color: 'rgba(255,255,255,.8)' }}>
                ✉ Email
              </button>
            </>
          )}

          <span className="header-user">{session?.displayName || session?.username}</span>

          {/* Notification Bell */}
          <button
            className="notif-bell-btn"
            onClick={() => setPanelOpen(o => !o)}
            title="Notifications"
          >
            🔔
            {badgeCount > 0 && (
              <span className="notif-bell-badge">{badgeCount > 99 ? '99+' : badgeCount}</span>
            )}
          </button>

          {/* Broadcast button */}
          {hasPerm('broadcast.send') && (
            <button
              onClick={() => setBroadcastOpen(true)}
              title="Send Announcement"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: '4px 6px', color: '#fff' }}
            >
              📢
            </button>
          )}

          {hasPerm('admin.users') && (
            <Link to="/admin" className="btn btn-outline btn-sm" style={{ textDecoration: 'none' }}>
              Admin
            </Link>
          )}
          <Link to="/about" className="btn btn-outline btn-sm" style={{ textDecoration: 'none', opacity: .7 }}>
            About
          </Link>
          <button className="btn btn-outline btn-sm" onClick={handleLogout}>Sign Out</button>
        </div>
      </header>

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

// ── AppShell ───────────────────────────────────────────────────────────
export default function AppShell() {
  // Allow Dashboard to tell the header to navigate to a tab (e.g. from "View" in notification panel)
  const [requestedTab, setRequestedTab] = useState(null)

  return (
    <DataProvider>
      <div className="app-layout">
        <Header onGoTab={setRequestedTab} />
        <div className="app-content">
          <Outlet context={{ requestedTab, clearRequestedTab: () => setRequestedTab(null) }} />
        </div>
      </div>
      {/* Profile drawer — rendered at root so it overlays all content */}
      <ClientProfile onNavigateTab={setRequestedTab} />
    </DataProvider>
  )
}
