/**
 * ClientProfile — slide-out drawer showing a resident's full record.
 *
 * HIPAA / 42 CFR Part 2 notes:
 *   - Clinical fields (intake_notes, referral_source, program_track, med_notes)
 *     are already stripped server-side in getAllData() for non-clinical users.
 *     This component renders whatever the API returned — no client-side filtering needed.
 *   - Opening the drawer fires a fire-and-forget audit log to /api/clients/:id/profile.
 *   - No dangerouslySetInnerHTML used anywhere.
 *
 * RBAC-gated tabs:
 *   Overview, Timeline    → always visible (all authenticated users)
 *   Passes, Mail          → always visible (passes/mail are non-clinical)
 *   UA                    → ua.acknowledge or ua.record
 *   Meds                  → med.witness
 *   Milestones            → milestones.edit or milestones.signoff
 *   Incidents             → incidents.log or incidents.review
 *   Consents              → consent.manage or disclosures.view
 *
 * Quick-action buttons (header):
 *   🚪 Passes (passes.edit)     → switches to Passes tab
 *   ✉ Mail   (mail.log)         → switches to Mail tab + shows log form
 *   🧪 UA    (ua.request)       → switches to UA tab (has inline Request button)
 *   ⚠ Violation (violations.log) → navigates dashboard to violations tab
 *   🚨 Incident (incidents.log)  → navigates dashboard to incidents tab
 */

import { useState, useCallback, useMemo, useEffect } from 'react'
import { useData } from '../contexts/DataContext.jsx'
import { usePermission } from '../hooks/usePermission.js'

// ── Shared helpers ────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return '—'
  const s = String(d).slice(0, 10) // accept ISO timestamps too
  try {
    return new Date(s + 'T12:00:00').toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  } catch { return s }
}

function daysSince(dateStr) {
  if (!dateStr) return null
  try {
    const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00')
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000))
  } catch { return null }
}

function formatPhone(raw) {
  if (!raw) return ''
  const d = String(raw).replace(/\D/g, '').replace(/^1(\d{10})$/, '$1')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return raw
}

function parseECs(raw) {
  if (Array.isArray(raw)) return raw
  try { return JSON.parse(raw || '[]') } catch { return [] }
}

// ── Risk chip ─────────────────────────────────────────────────────────────

function computeRisk(clientId, data) {
  if (!data) return 'green'
  // Red: any open (non-closed) incident for this client
  const openInc = (data.incidents || []).find(
    i => i.client_id === clientId && i.status !== 'closed'
  )
  if (openInc) return 'red'
  // Amber: POS UA result in the last 30 days
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const posUA = (data.ua_records || []).find(
    r => r.client_id === clientId && r.result === 'POS' && (r.tested_at || '').slice(0, 10) >= cutoff
  )
  if (posUA) return 'amber'
  // Amber: overdue milestone (due date passed, not yet completed)
  const today = new Date().toISOString().slice(0, 10)
  const overdue = (data.milestones || []).find(
    m => m.client_id === clientId && m.due_date && m.due_date < today && !m.completed_at
  )
  if (overdue) return 'amber'
  return 'green'
}

function RiskChip({ level }) {
  const styles = {
    red:   { background: '#fee2e2', color: '#991b1b', text: '⚠ Open Incident' },
    amber: { background: '#fef3c7', color: '#92400e', text: '⚡ Needs Attention' },
    green: { background: '#dcfce7', color: '#15803d', text: '✓ On Track' },
  }
  const s = styles[level] || styles.green
  return (
    <span style={{
      fontSize: '.66rem', fontWeight: 700, padding: '2px 8px', borderRadius: 10,
      background: s.background, color: s.color, whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      {s.text}
    </span>
  )
}

// ── Tab components ────────────────────────────────────────────────────────

function OverviewTab({ client, data }) {
  const activeReport = data?.reports?.find(r => r.id === data?.active_report_id)
  const status  = activeReport?.statuses?.[client.id] || 'building'
  const STATUS_LABEL = {
    building: '🏠 In Building', work: '💼 At Work', pass: '🗓 On Pass',
    bhc: '🏥 BHC', efc: '🏠 EFC', hospital: '🏥 Hospital', out: '🚶 Out / Other',
  }
  const days = daysSince(client.intake_date)
  const ecs  = parseECs(client.emergency_contacts)

  const Field = ({ label, children, span }) => (
    <div style={{ gridColumn: span ? '1/-1' : undefined }}>
      <div style={{ fontSize: '.63rem', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: '.83rem', color: '#0f172a' }}>{children}</div>
    </div>
  )

  return (
    <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Identity card */}
      <div style={{ background: '#f8fafc', borderRadius: 8, padding: '12px 14px', border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 16px' }}>
          <Field label="Room">
            <span style={{ fontWeight: 700, fontFamily: 'var(--mono)', color: 'var(--sidebar-bg)' }}>Rm. {client.room}</span>
          </Field>
          <Field label="Days in Program">
            <span style={{ fontWeight: 700, color: 'var(--sidebar-bg)' }}>{days != null ? days : '—'}</span>
          </Field>
          <Field label="Case Manager">
            <span style={{ fontWeight: 600 }}>{client.case_manager || '—'}</span>
          </Field>
          <Field label="Phone">
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.8rem' }}>{formatPhone(client.phone) || '—'}</span>
          </Field>
          <Field label="Intake Date">{fmtDate(client.intake_date)}</Field>
          <Field label="Current Status">
            <span style={{ fontWeight: 600 }}>{STATUS_LABEL[status] || status}</span>
          </Field>
          {client.program_track && (
            <Field label="Program Track" span>{client.program_track}</Field>
          )}
          {client.referral_source && (
            <Field label="Referral Source" span>{client.referral_source}</Field>
          )}
        </div>
      </div>

      {/* Emergency contacts */}
      {ecs.length > 0 && (
        <div>
          <div style={{ fontSize: '.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 6 }}>
            Emergency Contacts
          </div>
          {ecs.map((ec, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: i < ecs.length - 1 ? '1px solid #f1f5f9' : undefined }}>
              <span style={{ fontSize: '.9rem', flexShrink: 0 }}>👤</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: '.82rem', color: '#0f172a' }}>
                  {ec.name}
                  {ec.relationship ? <span style={{ fontWeight: 400, color: '#64748b' }}> ({ec.relationship})</span> : null}
                </div>
                {ec.phone && (
                  <div style={{ fontSize: '.75rem', fontFamily: 'var(--mono)', color: '#475569' }}>{formatPhone(ec.phone)}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Intake notes (clinical — already stripped for non-clinical users server-side) */}
      {client.intake_notes && (
        <div>
          <div style={{ fontSize: '.7rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>
            Intake Notes
          </div>
          <div style={{ background: '#fef9c3', borderRadius: 6, padding: '8px 10px', fontSize: '.82rem', color: '#78350f', border: '1px solid #fde68a', lineHeight: 1.5 }}>
            {client.intake_notes}
          </div>
        </div>
      )}
    </div>
  )
}

function TimelineTab({ client, data }) {
  const name = client.name.toLowerCase()
  const rm   = String(client.room)

  const entries = useMemo(() => {
    const all = []
    for (const report of (data?.reports || [])) {
      for (const entry of (report.log_entries || [])) {
        const t = (entry.text || '').toLowerCase()
        // Match by name, "Rm. 101", "Rm.101", or "room 101" patterns
        if (
          t.includes(name) ||
          t.includes(`rm. ${rm}`) ||
          t.includes(`rm.${rm}`) ||
          t.includes(`room ${rm}`)
        ) {
          all.push({ ...entry, report_date: report.report_date, shift: report.shift })
        }
      }
    }
    return all.sort((a, b) => {
      const rd = (b.report_date || '').localeCompare(a.report_date || '')
      if (rd !== 0) return rd
      return (b.created_at || '').localeCompare(a.created_at || '')
    })
  }, [data?.reports, name, rm])

  if (entries.length === 0) return (
    <div style={{ padding: 28, textAlign: 'center', color: '#94a3b8', fontStyle: 'italic', fontSize: '.84rem' }}>
      No activity log entries found for this resident.
    </div>
  )

  return (
    <div>
      {entries.map((e, i) => (
        <div key={e.id || i} style={{ display: 'flex', gap: 12, padding: '10px 16px', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ flexShrink: 0, width: 60, textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--mono)', fontSize: '.7rem', color: 'var(--sidebar-bg)', fontWeight: 700 }}>{e.time}</div>
            <div style={{ fontSize: '.62rem', color: '#94a3b8', marginTop: 1 }}>{fmtDate(e.report_date)}</div>
          </div>
          <div style={{ flex: 1, fontSize: '.81rem', color: '#0f172a', lineHeight: 1.45 }}>{e.text}</div>
        </div>
      ))}
    </div>
  )
}

function PassesTab({ client, data }) {
  const passes = (data?.passes || [])
    .filter(p => p.client_id === client.id)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))

  if (passes.length === 0) return (
    <div style={{ padding: 28, textAlign: 'center', color: '#94a3b8', fontStyle: 'italic', fontSize: '.84rem' }}>
      No pass records for this resident.
    </div>
  )

  const STATUS_STYLE = {
    Out:      { background: '#fef9c3', color: '#92400e' },
    Extended: { background: '#fee2e2', color: '#991b1b' },
    Returned: { background: '#dcfce7', color: '#15803d' },
  }

  return (
    <div>
      {passes.map(p => {
        const s = STATUS_STYLE[p.status] || { background: '#f1f5f9', color: '#475569' }
        return (
          <div key={p.id} style={{ padding: '10px 16px', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '.83rem', color: '#0f172a' }}>
                  Departed {fmtDate(p.departure)}
                  {p.return_date ? ` — Returns ${fmtDate(p.return_date)}` : ' (open)'}
                </div>
                {p.notes && <div style={{ fontSize: '.76rem', color: '#475569', marginTop: 3 }}>{p.notes}</div>}
                {p.ua_notes && <div style={{ fontSize: '.76rem', color: '#6b21a8', marginTop: 2 }}>UA: {p.ua_notes}</div>}
              </div>
              <span style={{ flexShrink: 0, fontSize: '.66rem', fontWeight: 700, padding: '2px 8px', borderRadius: 8, ...s }}>
                {p.status}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MailSubTab({ client, data }) {
  const records = (data?.mail || [])
    .filter(m => m.client_id === client.id)
    .sort((a, b) => (b.logged_at || '').localeCompare(a.logged_at || ''))

  if (records.length === 0) return (
    <div style={{ padding: 28, textAlign: 'center', color: '#94a3b8', fontStyle: 'italic', fontSize: '.84rem' }}>
      No mail records for this resident.
    </div>
  )

  const STATUS_STYLE = {
    pending:   { background: '#fef9c3', color: '#92400e',  label: 'Pending' },
    approved:  { background: '#dcfce7', color: '#15803d',  label: 'Approved' },
    delivered: { background: '#dbeafe', color: '#1e40af',  label: 'Delivered' },
  }

  return (
    <div>
      {records.map(m => {
        const s = STATUS_STYLE[m.status] || { background: '#f1f5f9', color: '#475569', label: m.status }
        return (
          <div key={m.id} style={{ padding: '10px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '.83rem', color: '#0f172a' }}>
                {m.mail_type || 'Mail'}
                {m.notes ? <span style={{ fontWeight: 400, color: '#64748b' }}> — {m.notes}</span> : null}
              </div>
              <div style={{ fontSize: '.71rem', color: '#94a3b8', marginTop: 2 }}>
                Logged {fmtDate(m.logged_at)} · by {m.logged_by}
              </div>
            </div>
            <span style={{ flexShrink: 0, fontSize: '.66rem', fontWeight: 700, padding: '2px 8px', borderRadius: 8, ...s }}>
              {s.label}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function UATab({ client, data, hasPerm }) {
  const [reqState, setReqState] = useState('idle') // idle | busy | done | err
  const [reqErr, setReqErr]     = useState('')

  const records = (data?.ua_records || [])
    .filter(r => r.client_id === client.id)
    .sort((a, b) => (b.tested_at || '').localeCompare(a.tested_at || ''))

  const pending = (data?.ua_requests || [])
    .filter(r => r.client_id === client.id && !r.acknowledged)

  const RES_STYLE = {
    NEG: { background: '#dcfce7', color: '#15803d' },
    POS: { background: '#fee2e2', color: '#991b1b' },
    NT:  { background: '#f1f5f9', color: '#475569' },
  }

  async function requestUA() {
    setReqState('busy'); setReqErr('')
    try {
      const r = await fetch('/api/ua-requests', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: client.id, client_name: client.name, room: client.room }),
      })
      if (!r.ok) { const j = await r.json(); setReqErr(j.error || 'Request failed'); setReqState('err'); return }
      setReqState('done')
    } catch { setReqErr('Network error'); setReqState('err') }
  }

  return (
    <div>
      {/* UA request controls */}
      {hasPerm('ua.request') && (
        <div style={{ padding: '10px 16px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
          {pending.length > 0 && (
            <div style={{ fontSize: '.76rem', color: '#92400e', background: '#fef3c7', padding: '5px 10px', borderRadius: 6, marginBottom: 8 }}>
              ⚠ UA already pending for this resident ({pending.length} request{pending.length > 1 ? 's' : ''})
            </div>
          )}
          {reqErr && <div style={{ color: '#dc2626', fontSize: '.76rem', marginBottom: 6 }}>{reqErr}</div>}
          {reqState === 'done' ? (
            <div style={{ fontSize: '.82rem', color: '#15803d', fontWeight: 600 }}>✓ UA request submitted</div>
          ) : (
            <button className="btn btn-sm btn-primary" onClick={requestUA}
              disabled={reqState === 'busy' || pending.length > 0}>
              {reqState === 'busy' ? 'Requesting…' : '🧪 Request UA'}
            </button>
          )}
        </div>
      )}

      {records.length === 0 ? (
        <div style={{ padding: 28, textAlign: 'center', color: '#94a3b8', fontStyle: 'italic', fontSize: '.84rem' }}>
          No UA records for this resident.
        </div>
      ) : records.map(r => {
        const s = RES_STYLE[r.result] || RES_STYLE.NT
        return (
          <div key={r.id} style={{ padding: '10px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '.83rem', color: '#0f172a' }}>
                {r.test_type || 'Urinalysis'}
              </div>
              <div style={{ fontSize: '.71rem', color: '#94a3b8', marginTop: 2 }}>
                {fmtDate(r.tested_at)} · by {r.witnessed_by_name || '—'}
              </div>
              {r.collection_method && (
                <div style={{ fontSize: '.71rem', color: '#64748b' }}>{r.collection_method}</div>
              )}
              {r.notes && (
                <div style={{ fontSize: '.75rem', color: '#475569', marginTop: 3 }}>{r.notes}</div>
              )}
            </div>
            <span style={{ flexShrink: 0, fontSize: '.72rem', fontWeight: 800, padding: '2px 10px', borderRadius: 8, ...s }}>
              {r.result}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function MedsTab({ client, data }) {
  const records = (data?.med_log || [])
    .filter(m => m.client_id === client.id)
    .sort((a, b) => (b.administered_at || b.logged_at || '').localeCompare(a.administered_at || a.logged_at || ''))
    .slice(0, 40)

  if (records.length === 0) return (
    <div style={{ padding: 28, textAlign: 'center', color: '#94a3b8', fontStyle: 'italic', fontSize: '.84rem' }}>
      No medication records for this resident.
    </div>
  )

  return (
    <div>
      {records.map((m, i) => (
        <div key={m.id || i} style={{ padding: '8px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: '.83rem', color: '#0f172a' }}>
              {m.medication_name || 'Medication'}
              {m.dosage ? <span style={{ fontWeight: 400, color: '#64748b' }}> · {m.dosage}</span> : null}
            </div>
            <div style={{ fontSize: '.71rem', color: '#94a3b8', marginTop: 2 }}>
              {fmtDate(m.administered_at || m.logged_at)} · witnessed by {m.witnessed_by_name || '—'}
            </div>
          </div>
          {m.refused && (
            <span style={{ flexShrink: 0, fontSize: '.66rem', fontWeight: 700, padding: '2px 8px', borderRadius: 8, background: '#fee2e2', color: '#991b1b' }}>
              Refused
            </span>
          )}
        </div>
      ))}
      {(data?.med_log || []).filter(m => m.client_id === client.id).length > 40 && (
        <div style={{ padding: '8px 16px', fontSize: '.74rem', color: '#94a3b8', textAlign: 'center' }}>
          Showing 40 most recent records
        </div>
      )}
    </div>
  )
}

function MilestonesTab({ client, data }) {
  const today      = new Date().toISOString().slice(0, 10)
  const milestones = (data?.milestones || [])
    .filter(m => m.client_id === client.id)
    .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'))

  if (milestones.length === 0) return (
    <div style={{ padding: 28, textAlign: 'center', color: '#94a3b8', fontStyle: 'italic', fontSize: '.84rem' }}>
      No milestones for this resident.
    </div>
  )

  return (
    <div>
      {milestones.map(m => {
        const done    = !!m.completed_at
        const overdue = !done && m.due_date && m.due_date < today
        return (
          <div key={m.id} style={{ padding: '10px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ fontSize: '1.1rem', flexShrink: 0, marginTop: 1 }}>
              {done ? '✅' : overdue ? '🔴' : '⏳'}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: '.83rem', color: done ? '#15803d' : overdue ? '#991b1b' : '#0f172a' }}>
                {m.title}
              </div>
              {m.description && (
                <div style={{ fontSize: '.75rem', color: '#475569', marginTop: 2, lineHeight: 1.4 }}>{m.description}</div>
              )}
              <div style={{ fontSize: '.7rem', color: '#94a3b8', marginTop: 3 }}>
                {m.due_date ? `Due ${fmtDate(m.due_date)}` : 'No due date'}
                {done && m.completed_at ? ` · Completed ${fmtDate(m.completed_at)}` : ''}
                {done && m.signed_off_by ? ` by ${m.signed_off_by}` : ''}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function IncidentsTab({ client, data }) {
  const incidents = (data?.incidents || [])
    .filter(i => i.client_id === client.id)
    .sort((a, b) => (b.logged_at || '').localeCompare(a.logged_at || ''))

  if (incidents.length === 0) return (
    <div style={{ padding: 28, textAlign: 'center', color: '#94a3b8', fontStyle: 'italic', fontSize: '.84rem' }}>
      No incident reports for this resident.
    </div>
  )

  const SEV_STYLE = {
    low:      { background: '#dbeafe', color: '#1e40af' },
    medium:   { background: '#fef3c7', color: '#92400e' },
    high:     { background: '#fee2e2', color: '#9a3412' },
    critical: { background: '#fce7f3', color: '#7c2d12' },
  }

  return (
    <div>
      {incidents.map(inc => {
        const sevStyle = SEV_STYLE[inc.severity] || { background: '#f1f5f9', color: '#475569' }
        return (
          <div key={inc.id} style={{ padding: '10px 16px', borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ fontWeight: 700, fontSize: '.83rem', color: '#0f172a' }}>
                {inc.incident_type || 'Incident'}
              </div>
              <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                {inc.severity && (
                  <span style={{ fontSize: '.63rem', fontWeight: 700, padding: '2px 7px', borderRadius: 8, textTransform: 'capitalize', ...sevStyle }}>
                    {inc.severity}
                  </span>
                )}
                {inc.status && (
                  <span style={{ fontSize: '.63rem', fontWeight: 700, padding: '2px 7px', borderRadius: 8,
                    background: inc.status === 'closed' ? '#dcfce7' : '#fee2e2',
                    color:      inc.status === 'closed' ? '#15803d' : '#991b1b' }}>
                    {inc.status}
                  </span>
                )}
              </div>
            </div>
            <div style={{ fontSize: '.71rem', color: '#94a3b8', marginTop: 2 }}>
              {fmtDate(inc.logged_at)} · by {inc.logged_by}
            </div>
            {inc.narrative && (
              <div style={{ fontSize: '.77rem', color: '#475569', marginTop: 5, lineHeight: 1.45 }}>
                {inc.narrative}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ConsentsTab({ client }) {
  const [records, setRecords] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/consent-records?client_id=${client.id}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => { setRecords(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => { setRecords([]); setLoading(false) })
  }, [client.id])

  if (loading) return (
    <div style={{ padding: 28, textAlign: 'center', color: '#94a3b8', fontSize: '.84rem' }}>Loading…</div>
  )
  if (!records?.length) return (
    <div style={{ padding: 28, textAlign: 'center', color: '#94a3b8', fontStyle: 'italic', fontSize: '.84rem' }}>
      No consent records for this resident.
    </div>
  )

  return (
    <div>
      {records.map(c => (
        <div key={c.id} style={{ padding: '10px 16px', borderBottom: '1px solid #f1f5f9' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
            <div style={{ fontWeight: 700, fontSize: '.83rem', color: '#0f172a' }}>
              {c.consent_type}
            </div>
            <span style={{ flexShrink: 0, fontSize: '.66rem', fontWeight: 700, padding: '2px 8px', borderRadius: 8,
              background: c.status === 'active' ? '#dcfce7' : '#fee2e2',
              color:      c.status === 'active' ? '#15803d' : '#991b1b' }}>
              {c.status}
            </span>
          </div>
          <div style={{ fontSize: '.71rem', color: '#94a3b8', marginTop: 2 }}>
            Signed {fmtDate(c.signed_at)} · by {c.signed_by_name}
            {c.expires_at ? ` · expires ${fmtDate(c.expires_at)}` : ''}
          </div>
          {c.information_types && (
            <div style={{ fontSize: '.74rem', color: '#475569', marginTop: 3 }}>
              {Array.isArray(c.information_types) ? c.information_types.join(', ') : c.information_types}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Quick mail log mini-form ──────────────────────────────────────────────

function QuickMailForm({ client, onDone, onCancel }) {
  const [types,  setTypes]  = useState([])
  const [notes,  setNotes]  = useState('')
  const [saving, setSaving] = useState(false)
  const [err,    setErr]    = useState('')
  const [done,   setDone]   = useState(false)

  function toggleType(t) {
    setTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t])
  }

  async function submit() {
    if (types.length === 0) { setErr('Select at least one mail type'); return }
    setSaving(true); setErr('')
    try {
      const now = new Date()
      const h = now.getHours(); const mi = now.getMinutes()
      const ap = h >= 12 ? 'PM' : 'AM'
      const fh = h % 12 || 12
      const logTime = `${fh}:${String(mi).padStart(2, '0')} ${ap}`
      const r = await fetch('/api/mail', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ client_id: client.id, client_name: client.name, room: client.room, mail_type: types.join(' + '), notes }],
          log_time: logTime,
        }),
      })
      if (!r.ok) { const j = await r.json(); setErr(j.error || 'Save failed'); return }
      setDone(true); onDone && onDone()
    } catch { setErr('Network error') }
    finally { setSaving(false) }
  }

  if (done) return (
    <div style={{ padding: '10px 16px', background: '#f0fdf4', borderBottom: '1px solid #bbf7d0', display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: '.83rem', color: '#15803d', fontWeight: 600 }}>✓ Mail logged for {client.name}</span>
      <button className="btn btn-sm" style={{ background: 'none', border: '1px solid #d1d5db', color: '#64748b', marginLeft: 'auto' }} onClick={onCancel}>Close</button>
    </div>
  )

  return (
    <div style={{ padding: '12px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
      <div style={{ fontSize: '.78rem', fontWeight: 700, color: '#475569', marginBottom: 8 }}>
        Log mail for {client.name}
      </div>
      {err && <div style={{ color: '#dc2626', fontSize: '.76rem', marginBottom: 6 }}>{err}</div>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
        {['Letter', 'Package', 'Card', 'Legal'].map(t => (
          <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '.78rem', cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={types.includes(t)} onChange={() => toggleType(t)} />
            {t}
          </label>
        ))}
      </div>
      <input
        type="text" placeholder="Notes (optional)" value={notes}
        onChange={e => setNotes(e.target.value)}
        style={{ width: '100%', fontSize: '.8rem', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 5, outline: 'none', marginBottom: 8 }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn btn-sm btn-primary" onClick={submit} disabled={saving}>
          {saving ? 'Saving…' : 'Log Mail'}
        </button>
        <button className="btn btn-sm" style={{ background: 'none', border: '1px solid #e2e8f0', color: '#64748b' }} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ── NavButton helper ─────────────────────────────────────────────────────

function NavBtn({ onClick, disabled, children }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.22)',
        color: '#fff', padding: '3px 10px', borderRadius: 5, fontSize: '.71rem',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  )
}

function QuickActionBtn({ onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.22)',
        color: '#fff', padding: '4px 10px', borderRadius: 5,
        fontSize: '.71rem', cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >
      {children}
    </button>
  )
}

// ── Main drawer component ─────────────────────────────────────────────────

export default function ClientProfile({ onNavigateTab }) {
  const { profileClientId, openProfile, closeProfile, data } = useData()
  const { hasPerm } = usePermission()

  const [activeTab,    setActiveTab]    = useState('overview')
  const [showMailForm, setShowMailForm] = useState(false)

  // Reset when profile changes
  useEffect(() => {
    if (profileClientId) { setActiveTab('overview'); setShowMailForm(false) }
  }, [profileClientId])

  const clients = data?.clients || []
  const client  = clients.find(c => c.id === profileClientId) || null

  // Caseload navigation — active residents, sorted by room number
  const roster = useMemo(() =>
    clients
      .filter(c => c.is_active && !c.is_special && c.name !== 'VACANT')
      .sort((a, b) => (parseInt(a.room) || 0) - (parseInt(b.room) || 0)),
    [clients]
  )
  const rosterIdx  = roster.findIndex(c => c.id === profileClientId)
  const prevClient = rosterIdx > 0 ? roster[rosterIdx - 1] : null
  const nextClient = rosterIdx >= 0 && rosterIdx < roster.length - 1 ? roster[rosterIdx + 1] : null

  // Build permission-gated tab list
  const tabs = useMemo(() => {
    if (!client) return []
    const t = [
      { id: 'overview',   label: 'Overview'    },
      { id: 'timeline',   label: '📅 Timeline'  },
      { id: 'passes',     label: '🚪 Passes'    },
      { id: 'mail',       label: '✉ Mail'       },
    ]
    if (hasPerm('ua.acknowledge') || hasPerm('ua.record'))
      t.push({ id: 'ua', label: '🧪 UA' })
    if (hasPerm('med.witness'))
      t.push({ id: 'meds', label: '💊 Meds' })
    if (hasPerm('milestones.edit') || hasPerm('milestones.signoff'))
      t.push({ id: 'milestones', label: '🏁 Milestones' })
    if (hasPerm('incidents.log') || hasPerm('incidents.review'))
      t.push({ id: 'incidents', label: '🚨 Incidents' })
    if (hasPerm('consent.manage') || hasPerm('disclosures.view'))
      t.push({ id: 'consents', label: '📋 Consents' })
    return t
  }, [client, hasPerm])

  if (!profileClientId || !client) return null

  const riskLevel = computeRisk(client.id, data)
  const days      = daysSince(client.intake_date)

  // Quick-action: navigate dashboard tab + close drawer
  function goDashTab(tabId) {
    closeProfile()
    if (onNavigateTab) onNavigateTab(tabId)
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={closeProfile}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(15,23,42,.38)',
          zIndex: 1200,
        }}
      />

      {/* Drawer panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 490,
        background: '#fff', zIndex: 1201,
        display: 'flex', flexDirection: 'column',
        boxShadow: '-6px 0 32px rgba(0,0,0,.2)',
        overflow: 'hidden',
      }}>

        {/* ── Header ── */}
        <div style={{ background: 'var(--sidebar-bg)', color: '#fff', padding: '12px 16px 10px', flexShrink: 0 }}>

          {/* Caseload nav row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <NavBtn onClick={() => openProfile(prevClient.id)} disabled={!prevClient}>← Prev</NavBtn>
              {rosterIdx >= 0 && (
                <span style={{ fontSize: '.66rem', color: '#a8c0e8' }}>
                  {rosterIdx + 1} / {roster.length}
                </span>
              )}
              <NavBtn onClick={() => openProfile(nextClient.id)} disabled={!nextClient}>Next →</NavBtn>
            </div>
            <button
              onClick={closeProfile}
              style={{
                background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.22)',
                color: '#fff', width: 28, height: 28, borderRadius: 5,
                fontSize: '.9rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              ✕
            </button>
          </div>

          {/* Identity row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {client.photo ? (
              <img src={client.photo} alt=""
                style={{ width: 46, height: 46, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(255,255,255,.3)', flexShrink: 0 }} />
            ) : (
              <div style={{ width: 46, height: 46, borderRadius: '50%', background: 'rgba(255,255,255,.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.3rem', flexShrink: 0 }}>
                👤
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {client.name}
              </div>
              <div style={{ fontSize: '.73rem', color: '#a8c0e8', marginTop: 1 }}>
                Rm. {client.room}
                {days != null ? ` · Day ${days}` : ''}
                {!client.is_active && ' · Discharged'}
              </div>
            </div>
            <RiskChip level={riskLevel} />
          </div>

          {/* Quick-action buttons */}
          <div style={{ display: 'flex', gap: 5, marginTop: 10, flexWrap: 'wrap' }}>
            {hasPerm('passes.edit') && (
              <QuickActionBtn onClick={() => setActiveTab('passes')}>🚪 Passes</QuickActionBtn>
            )}
            {hasPerm('mail.log') && (
              <QuickActionBtn onClick={() => { setActiveTab('mail'); setShowMailForm(v => !v) }}>
                ✉ Mail
              </QuickActionBtn>
            )}
            {hasPerm('ua.request') && (
              <QuickActionBtn onClick={() => setActiveTab('ua')}>🧪 UA</QuickActionBtn>
            )}
            {hasPerm('violations.log') && (
              <QuickActionBtn onClick={() => goDashTab('violations')}>⚠ Violation</QuickActionBtn>
            )}
            {hasPerm('incidents.log') && (
              <QuickActionBtn onClick={() => goDashTab('incidents')}>🚨 Incident</QuickActionBtn>
            )}
          </div>
        </div>

        {/* ── Tab bar ── */}
        <div style={{
          display: 'flex', flexShrink: 0, background: '#f8fafc',
          borderBottom: '2px solid #e2e8f0', overflowX: 'auto',
        }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                padding: '8px 12px', border: 'none',
                borderBottom: activeTab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
                background: 'none',
                fontSize: '.74rem', fontWeight: activeTab === t.id ? 700 : 500,
                color: activeTab === t.id ? 'var(--accent)' : '#64748b',
                cursor: 'pointer', whiteSpace: 'nowrap', marginBottom: -2,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Tab body (scrollable) ── */}
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>

          {/* Inline mail form — shown when mail tab active + form toggled */}
          {activeTab === 'mail' && showMailForm && hasPerm('mail.log') && (
            <QuickMailForm
              client={client}
              onDone={() => setShowMailForm(false)}
              onCancel={() => setShowMailForm(false)}
            />
          )}

          {activeTab === 'overview'    && <OverviewTab    client={client} data={data} />}
          {activeTab === 'timeline'    && <TimelineTab    client={client} data={data} />}
          {activeTab === 'passes'      && <PassesTab      client={client} data={data} />}
          {activeTab === 'mail'        && <MailSubTab     client={client} data={data} />}
          {activeTab === 'ua'          && <UATab          client={client} data={data} hasPerm={hasPerm} />}
          {activeTab === 'meds'        && <MedsTab        client={client} data={data} />}
          {activeTab === 'milestones'  && <MilestonesTab  client={client} data={data} />}
          {activeTab === 'incidents'   && <IncidentsTab   client={client} data={data} />}
          {activeTab === 'consents'    && <ConsentsTab    client={client} />}
        </div>
      </div>

      {/* Slide-in animation */}
      <style>{`
        @keyframes op-slide-in-right {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </>
  )
}
