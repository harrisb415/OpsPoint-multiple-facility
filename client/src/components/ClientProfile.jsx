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

import { useState, useMemo, useEffect } from 'react'
import { Badge, Button } from 'flowbite-react'
import { useData } from '../contexts/DataContext.jsx'
import { usePermission } from '../hooks/usePermission.js'
import { openPrintWindow, classifyLogEntry } from '../utils/printLog.js'

const LOG_TYPE_CLS = {
  Wellness:      'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  Walkthrough:   'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  UA:            'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  Lunch:         'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  'Room Search': 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  Mail:          'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  Infraction:    'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  Intake:        'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  Discharge:     'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
  Group:         'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
  Note:          'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400',
}
const LOG_TYPE_CLS_DEFAULT = 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'

const PASS_STATUS_CLS = {
  Out:      'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  Extended: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  Returned: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
}
const PASS_STATUS_CLS_DEFAULT = 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'

const MAIL_STATUS = {
  pending:   { cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400', label: 'Pending' },
  approved:  { cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', label: 'Approved' },
  delivered: { cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',    label: 'Delivered' },
}
const MAIL_STATUS_DEFAULT = { cls: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400', label: '' }

const RES_CLS = {
  NEG: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  POS: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  NT:  'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
}
const RES_CLS_DEFAULT = 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'

const SEV_CLS = {
  low:      'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  medium:   'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  high:     'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  critical: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-400',
}
const SEV_CLS_DEFAULT = 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'

const VIOL_STATUS = {
  pending:   { cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400', label: 'Pending' },
  assigned:  { cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',     label: 'Assigned' },
  completed: { cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', label: 'Completed' },
  waived:    { cls: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',        label: 'Waived' },
}
const VIOL_STATUS_DEFAULT = { cls: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400', label: '' }

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
  const cutoff = new Date(Date.now() - 30 * 86400000).toLocaleDateString('en-CA')
  const posUA = (data.ua_records || []).find(
    r => r.client_id === clientId && r.result === 'POS' && (r.tested_at || '').slice(0, 10) >= cutoff
  )
  if (posUA) return 'amber'
  // Amber: overdue milestone (due date passed, not yet completed)
  const today = new Date().toLocaleDateString('en-CA')
  const overdue = (data.milestones || []).find(
    m => m.client_id === clientId && m.due_date && m.due_date < today && !m.completed_at
  )
  if (overdue) return 'amber'
  return 'green'
}

const RISK_CLS = {
  red:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
}
const RISK_LABEL = {
  red:   '⚠ Open Incident',
  amber: '⚡ Needs Attention',
  green: '✓ On Track',
}

function RiskChip({ level }) {
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 ${RISK_CLS[level] || RISK_CLS.green}`}>
      {RISK_LABEL[level] || RISK_LABEL.green}
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
    <div className={span ? 'col-span-2' : ''}>
      <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-0.5 dark:text-gray-500">{label}</div>
      <div className="text-sm text-gray-900 dark:text-gray-100">{children}</div>
    </div>
  )

  return (
    <div className="p-4 flex flex-col gap-3.5">
      {/* Identity card */}
      <div className="bg-slate-50 rounded-lg p-3.5 border border-gray-200 dark:bg-gray-800 dark:border-gray-700">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          <Field label="Room">
            <span className="font-bold font-mono text-[#0a4655] dark:text-primary-400">Rm. {client.room}</span>
          </Field>
          <Field label="Days in Program">
            <span className="font-bold text-[#0a4655] dark:text-primary-400">{days != null ? days : '—'}</span>
          </Field>
          <Field label="Case Manager">
            <span className="font-semibold">{client.case_manager || '—'}</span>
          </Field>
          <Field label="Phone">
            <span className="font-mono text-xs">{formatPhone(client.phone) || '—'}</span>
          </Field>
          <Field label="Intake Date">{fmtDate(client.intake_date)}</Field>
          <Field label="Current Status">
            <span className="font-semibold">{STATUS_LABEL[status] || status}</span>
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
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1.5 dark:text-gray-400">Emergency Contacts</div>
          {ecs.map((ec, i) => (
            <div key={i} className={`flex items-center gap-2.5 py-1.5 ${i < ecs.length - 1 ? 'border-b border-gray-100 dark:border-gray-700' : ''}`}>
              <span className="text-base shrink-0">👤</span>
              <div>
                <div className="font-semibold text-sm text-gray-900 dark:text-gray-100">
                  {ec.name}
                  {ec.relationship ? <span className="font-normal text-gray-500"> ({ec.relationship})</span> : null}
                </div>
                {ec.phone && <div className="text-xs font-mono text-gray-600 dark:text-gray-400">{formatPhone(ec.phone)}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Intake notes */}
      {client.intake_notes && (
        <div>
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wide mb-1 dark:text-gray-400">Intake Notes</div>
          <div className="bg-yellow-50 border border-yellow-200 rounded-md px-2.5 py-2 text-sm text-yellow-900 leading-relaxed dark:bg-yellow-900/10 dark:border-yellow-800 dark:text-yellow-200">
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
    <p className="py-7 text-center text-sm text-gray-400 italic dark:text-gray-500">No activity log entries found for this resident.</p>
  )

  return (
    <div>
      {entries.map((e, i) => {
        const type  = classifyLogEntry(e.text)
        const cls   = LOG_TYPE_CLS[type] || LOG_TYPE_CLS_DEFAULT
        const isPos = e.text && /POS:/.test(e.text)
        return (
          <div key={e.id || i} className={`flex gap-3 px-4 py-2.5 border-b border-gray-100 dark:border-gray-700 ${isPos ? 'bg-red-50 border-l-2 border-l-red-500 dark:bg-red-900/10' : ''}`}>
            <div className="shrink-0 w-14 text-right">
              <div className="font-mono text-[11px] font-bold text-[#0a4655] dark:text-primary-400">{e.time}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">{fmtDate(e.report_date)}</div>
            </div>
            <div className="flex-1 min-w-0">
              <span className={`inline-block mb-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${cls}`}>{type}</span>
              <div className="text-[13px] text-gray-900 leading-snug dark:text-gray-100">
                {isPos
                  ? e.text.split(/(POS:[^|<]+)/).map((part, pi) =>
                      /^POS:/.test(part)
                        ? <strong key={pi} className="text-red-600 dark:text-red-400">{part}</strong>
                        : part
                    )
                  : e.text
                }
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PassesTab({ client, data }) {
  const passes = (data?.passes || [])
    .filter(p => p.client_id === client.id)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))

  if (passes.length === 0) return (
    <p className="py-7 text-center text-sm text-gray-400 italic dark:text-gray-500">No pass records for this resident.</p>
  )

  return (
    <div>
      {passes.map(p => (
        <div key={p.id} className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-700">
          <div className="flex justify-between items-start gap-2">
            <div>
              <div className="font-bold text-sm text-gray-900 dark:text-gray-100">
                Departed {fmtDate(p.departure)}
                {p.return_date ? ` — Returns ${fmtDate(p.return_date)}` : ' (open)'}
              </div>
              {p.notes && <div className="text-xs text-gray-500 mt-0.5 dark:text-gray-400">{p.notes}</div>}
              {p.ua_notes && <div className="text-xs text-violet-700 mt-0.5 dark:text-violet-400">UA: {p.ua_notes}</div>}
            </div>
            <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${PASS_STATUS_CLS[p.status] || PASS_STATUS_CLS_DEFAULT}`}>
              {p.status}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

function MailSubTab({ client, data }) {
  const records = (data?.mail || [])
    .filter(m => m.client_id === client.id)
    .sort((a, b) => (b.logged_at || '').localeCompare(a.logged_at || ''))

  if (records.length === 0) return (
    <p className="py-7 text-center text-sm text-gray-400 italic dark:text-gray-500">No mail records for this resident.</p>
  )

  return (
    <div>
      {records.map(m => {
        const s = MAIL_STATUS[m.status] || { ...MAIL_STATUS_DEFAULT, label: m.status }
        return (
          <div key={m.id} className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-700 flex justify-between items-start gap-2">
            <div>
              <div className="font-bold text-sm text-gray-900 dark:text-gray-100">
                {m.mail_type || 'Mail'}
                {m.notes ? <span className="font-normal text-gray-500"> — {m.notes}</span> : null}
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5">Logged {fmtDate(m.logged_at)} · by {m.logged_by}</div>
            </div>
            <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>
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
      {hasPerm('ua.request') && (
        <div className="px-4 py-2.5 border-b border-gray-200 bg-gray-50 dark:bg-gray-800 dark:border-gray-700">
          {pending.length > 0 && (
            <div className="text-xs text-amber-800 bg-amber-100 rounded px-2.5 py-1.5 mb-2 dark:bg-amber-900/20 dark:text-amber-300">
              ⚠ UA already pending for this resident ({pending.length} request{pending.length > 1 ? 's' : ''})
            </div>
          )}
          {reqErr && <p className="text-xs text-red-600 mb-1.5 dark:text-red-400">{reqErr}</p>}
          {reqState === 'done'
            ? <p className="text-sm font-semibold text-green-600 dark:text-green-400">✓ UA request submitted</p>
            : <Button size="xs" onClick={requestUA} isProcessing={reqState === 'busy'}
                disabled={reqState === 'busy' || pending.length > 0}>
                {reqState === 'busy' ? 'Requesting…' : '🧪 Request UA'}
              </Button>
          }
        </div>
      )}

      {records.length === 0
        ? <p className="py-7 text-center text-sm text-gray-400 italic dark:text-gray-500">No UA records for this resident.</p>
        : records.map(r => (
          <div key={r.id} className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-700 flex justify-between items-start gap-2">
            <div>
              <div className="font-bold text-sm text-gray-900 dark:text-gray-100">{r.test_type || 'Urinalysis'}</div>
              <div className="text-[11px] text-gray-400 mt-0.5">{fmtDate(r.tested_at)} · by {r.witnessed_by_name || '—'}</div>
              {r.collection_method && <div className="text-[11px] text-gray-500 dark:text-gray-400">{r.collection_method}</div>}
              {r.notes && <div className="text-xs text-gray-600 mt-0.5 dark:text-gray-400">{r.notes}</div>}
            </div>
            <span className={`shrink-0 text-[10px] font-extrabold px-2.5 py-0.5 rounded-full ${RES_CLS[r.result] || RES_CLS_DEFAULT}`}>
              {r.result}
            </span>
          </div>
        ))
      }
    </div>
  )
}

function MedsTab({ client, data }) {
  const records = (data?.med_log || [])
    .filter(m => m.client_id === client.id)
    .sort((a, b) => (b.administered_at || b.logged_at || '').localeCompare(a.administered_at || a.logged_at || ''))
    .slice(0, 40)

  if (records.length === 0) return (
    <p className="py-7 text-center text-sm text-gray-400 italic dark:text-gray-500">No medication records for this resident.</p>
  )

  return (
    <div>
      {records.map((m, i) => (
        <div key={m.id || i} className="px-4 py-2 border-b border-gray-100 dark:border-gray-700 flex justify-between items-start gap-2">
          <div>
            <div className="font-bold text-sm text-gray-900 dark:text-gray-100">
              {m.medication_name || 'Medication'}
              {m.dosage ? <span className="font-normal text-gray-500"> · {m.dosage}</span> : null}
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              {fmtDate(m.administered_at || m.logged_at)} · witnessed by {m.witnessed_by_name || '—'}
            </div>
          </div>
          {m.refused && (
            <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
              Refused
            </span>
          )}
        </div>
      ))}
      {(data?.med_log || []).filter(m => m.client_id === client.id).length > 40 && (
        <p className="px-4 py-2 text-xs text-gray-400 text-center">Showing 40 most recent records</p>
      )}
    </div>
  )
}

function MilestonesTab({ client, data }) {
  const today      = new Date().toLocaleDateString('en-CA')
  const milestones = (data?.milestones || [])
    .filter(m => m.client_id === client.id)
    .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'))

  if (milestones.length === 0) return (
    <p className="py-7 text-center text-sm text-gray-400 italic dark:text-gray-500">No milestones for this resident.</p>
  )

  return (
    <div>
      {milestones.map(m => {
        const done    = !!m.completed_at
        const overdue = !done && m.due_date && m.due_date < today
        return (
          <div key={m.id} className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-700 flex gap-2.5 items-start">
            <span className="text-base shrink-0 mt-0.5">{done ? '✅' : overdue ? '🔴' : '⏳'}</span>
            <div className="flex-1">
              <div className={`font-bold text-sm ${done ? 'text-green-700 dark:text-green-400' : overdue ? 'text-red-700 dark:text-red-400' : 'text-gray-900 dark:text-gray-100'}`}>
                {m.title}
              </div>
              {m.description && <div className="text-xs text-gray-500 mt-0.5 leading-snug dark:text-gray-400">{m.description}</div>}
              <div className="text-[11px] text-gray-400 mt-0.5">
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
    <p className="py-7 text-center text-sm text-gray-400 italic dark:text-gray-500">No incident reports for this resident.</p>
  )

  return (
    <div>
      {incidents.map(inc => (
        <div key={inc.id} className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-700">
          <div className="flex justify-between items-start gap-2">
            <div className="font-bold text-sm text-gray-900 dark:text-gray-100">{inc.incident_type || 'Incident'}</div>
            <div className="flex gap-1 shrink-0">
              {inc.severity && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full capitalize ${SEV_CLS[inc.severity] || SEV_CLS_DEFAULT}`}>
                  {inc.severity}
                </span>
              )}
              {inc.status && (
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${inc.status === 'closed' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                  {inc.status}
                </span>
              )}
            </div>
          </div>
          <div className="text-[11px] text-gray-400 mt-0.5">{fmtDate(inc.logged_at)} · by {inc.logged_by}</div>
          {inc.narrative && <div className="text-xs text-gray-600 mt-1.5 leading-snug dark:text-gray-400">{inc.narrative}</div>}
        </div>
      ))}
    </div>
  )
}

function DischargeTab({ client, data }) {
  const REASON_LABEL = {
    graduate:       'Graduate / Successful Completion',
    ama:            'AMA (Against Medical Advice)',
    therapeutic:    'Therapeutic Discharge',
    administrative: 'Administrative Discharge',
  }

  function parseReferrals(raw) {
    if (Array.isArray(raw)) return raw
    try { return JSON.parse(raw || '[]') } catch { return [] }
  }

  const records = (data?.discharge_records || [])
    .filter(r => r.client_id === client.id)
    .sort((a, b) => (b.discharge_date || '').localeCompare(a.discharge_date || ''))

  if (records.length === 0) return (
    <p className="py-7 text-center text-sm text-gray-400 italic dark:text-gray-500">No discharge records for this resident.</p>
  )

  function printDischarge() {
    const facilityName = data?.settings?.facility_name || 'OpsPoint'
    const rows = records.map(r => {
      const refs = parseReferrals(r.referrals_made)
      return {
        date:      fmtDate(r.discharge_date),
        reason:    REASON_LABEL[r.reason] || r.reason || '—',
        days:      r.days_in_program != null ? String(r.days_in_program) : '—',
        filed_by:  r.created_by_name || '—',
        narrative: r.narrative || '—',
        aftercare: r.aftercare_plan || '—',
        referrals: refs.length
          ? refs.map(rf => [rf.agency, rf.type, rf.date ? fmtDate(rf.date) : ''].filter(Boolean).join(' · ')).join(' | ')
          : '—',
      }
    })
    openPrintWindow({
      title: `Discharge Summary — ${client.name}`,
      facility: facilityName,
      subtitle: `Rm. ${client.room}${client.intake_date ? ' · Admitted ' + fmtDate(client.intake_date) : ''}`,
      columns: [
        { key: 'date',      label: 'Date',          width: '90px' },
        { key: 'reason',    label: 'Reason',         width: '155px' },
        { key: 'days',      label: 'Days',           width: '46px', align: 'center' },
        { key: 'filed_by',  label: 'Filed By',       width: '95px' },
        { key: 'narrative', label: 'Narrative' },
        { key: 'aftercare', label: 'Aftercare Plan' },
        { key: 'referrals', label: 'Referrals',      width: '130px' },
      ],
      rows,
      emptyMessage: 'No discharge records.',
    })
  }

  return (
    <div>
      <div className="px-4 py-2 border-b border-gray-200 bg-gray-50 dark:bg-gray-800 dark:border-gray-700 flex justify-end">
        <Button size="xs" color="light" onClick={printDischarge}>🖨 Print</Button>
      </div>

      {records.map((r, i) => {
        const referrals = parseReferrals(r.referrals_made)
        return (
          <div key={r.id || i} className="px-4 py-3.5 border-b border-gray-100 dark:border-gray-700">
            <div className="flex justify-between items-start gap-2 mb-2.5">
              <div>
                <div className="font-extrabold text-sm text-gray-900 dark:text-gray-100">
                  {REASON_LABEL[r.reason] || r.reason || 'Discharge'}
                </div>
                <div className="text-[11px] text-gray-400 mt-0.5">
                  Discharged {fmtDate(r.discharge_date)}
                  {r.days_in_program != null ? ` · ${r.days_in_program} days in program` : ''}
                  {r.created_by_name ? ` · by ${r.created_by_name}` : ''}
                </div>
              </div>
              <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                Discharged
              </span>
            </div>

            {r.narrative && (
              <div className="mb-2">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1 dark:text-gray-500">Narrative</div>
                <div className="text-sm text-gray-700 leading-relaxed bg-gray-50 rounded-md px-2.5 py-2 border border-gray-200 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300">
                  {r.narrative}
                </div>
              </div>
            )}

            {r.aftercare_plan && (
              <div className="mb-2">
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1 dark:text-gray-500">Aftercare Plan</div>
                <div className="text-sm text-gray-700 leading-relaxed bg-green-50 rounded-md px-2.5 py-2 border border-green-200 dark:bg-green-900/10 dark:border-green-800 dark:text-green-200">
                  {r.aftercare_plan}
                </div>
              </div>
            )}

            {referrals.length > 0 && (
              <div>
                <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mb-1.5 dark:text-gray-500">Referrals Made</div>
                {referrals.map((ref, j) => (
                  <div key={j} className={`text-xs text-gray-700 dark:text-gray-300 py-1.5 ${j < referrals.length - 1 ? 'border-b border-gray-100 dark:border-gray-700' : ''}`}>
                    <span className="font-semibold">{ref.agency || '—'}</span>
                    {ref.contact ? <span className="text-gray-500"> · {ref.contact}</span> : null}
                    {ref.type   ? <span className="text-gray-500"> · {ref.type}</span> : null}
                    {ref.date   ? <span className="text-gray-400"> · {fmtDate(ref.date)}</span> : null}
                  </div>
                ))}
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
    fetch(`/api/consent-records/${client.id}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(d => { setRecords(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => { setRecords([]); setLoading(false) })
  }, [client.id])

  if (loading) return <p className="py-7 text-center text-sm text-gray-400 dark:text-gray-500">Loading…</p>
  if (!records?.length) return (
    <p className="py-7 text-center text-sm text-gray-400 italic dark:text-gray-500">No consent records for this resident.</p>
  )

  return (
    <div>
      {records.map(c => {
        const active = !c.revoked
        return (
          <div key={c.id} className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-700">
            <div className="flex justify-between items-start gap-2">
              <div className="font-bold text-sm text-gray-900 dark:text-gray-100">{c.recipient_name || '—'}</div>
              <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                {active ? 'Active' : 'Revoked'}
              </span>
            </div>
            <div className="text-xs text-gray-600 mt-0.5 dark:text-gray-400">{c.purpose}</div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              Effective {fmtDate(c.effective_date)} · by {c.created_by_name}
              {c.expiration_date ? ` · expires ${fmtDate(c.expiration_date)}` : ''}
            </div>
            {c.information_type && <div className="text-xs text-gray-500 mt-0.5 dark:text-gray-400">{c.information_type}</div>}
          </div>
        )
      })}
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
    <div className="px-4 py-2.5 bg-green-50 border-b border-green-200 dark:bg-green-900/10 dark:border-green-800 flex items-center gap-2.5">
      <span className="text-sm font-semibold text-green-700 dark:text-green-400">✓ Mail logged for {client.name}</span>
      <Button size="xs" color="light" className="ml-auto" onClick={onCancel}>Close</Button>
    </div>
  )

  return (
    <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 dark:bg-gray-800 dark:border-gray-700">
      <div className="text-xs font-bold text-gray-600 mb-2 dark:text-gray-300">Log mail for {client.name}</div>
      {err && <p className="text-xs text-red-600 mb-1.5 dark:text-red-400">{err}</p>}
      <div className="flex flex-wrap gap-3 mb-2">
        {['Letter', 'Package', 'Card', 'Legal'].map(t => (
          <label key={t} className="flex items-center gap-1.5 text-xs cursor-pointer select-none text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={types.includes(t)} onChange={() => toggleType(t)} className="rounded border-gray-300 text-primary-600 dark:border-gray-600 dark:bg-gray-700" />
            {t}
          </label>
        ))}
      </div>
      <input
        type="text" placeholder="Notes (optional)" value={notes}
        onChange={e => setNotes(e.target.value)}
        className="w-full text-sm px-2 py-1.5 border border-gray-300 rounded-md outline-none mb-2 dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:ring-1 focus:ring-primary-500"
      />
      <div className="flex gap-1.5">
        <Button size="xs" onClick={submit} isProcessing={saving} disabled={saving}>
          {saving ? 'Saving…' : 'Log Mail'}
        </Button>
        <Button size="xs" color="light" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

// ── Violations profile tab ────────────────────────────────────────────────

function ViolationsProfileTab({ client }) {
  const [records, setRecords] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch('/api/violations', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(all => {
        const mine = (Array.isArray(all) ? all : [])
          .filter(v => v.client_id === client.id)
          .sort((a, b) => (b.violation_date || '').localeCompare(a.violation_date || ''))
        setRecords(mine)
        setLoading(false)
      })
      .catch(() => { setRecords([]); setLoading(false) })
  }, [client.id])

  if (loading) return <p className="py-7 text-center text-sm text-gray-400 dark:text-gray-500">Loading…</p>
  if (!records?.length) return (
    <p className="py-7 text-center text-sm text-gray-400 italic dark:text-gray-500">No infraction records for this resident.</p>
  )

  return (
    <div>
      {records.map((v, i) => {
        const s = VIOL_STATUS[v.status] || { ...VIOL_STATUS_DEFAULT, label: v.status }
        return (
          <div key={v.id || i} className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-700">
            <div className="flex justify-between items-start gap-2">
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm text-gray-900 leading-snug dark:text-gray-100">{v.description || 'Infraction'}</div>
                <div className="text-[11px] text-gray-400 mt-0.5">
                  {fmtDate(v.violation_date)}{v.logged_by ? ` · logged by ${v.logged_by}` : ''}
                </div>
                {v.notes && <div className="text-xs text-gray-500 mt-0.5 dark:text-gray-400">{v.notes}</div>}
                {(v.status === 'assigned' || v.status === 'completed') && v.consequence && (
                  <div className="text-xs text-blue-700 mt-0.5 dark:text-blue-400">
                    Consequence: {v.consequence}
                    {v.consequence_by ? <span className="text-gray-400"> · by {v.consequence_by}</span> : null}
                  </div>
                )}
                {v.status === 'waived' && <div className="text-xs text-gray-500 mt-0.5">Waived — no consequence</div>}
              </div>
              <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${s.cls}`}>{s.label}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Groups profile tab ────────────────────────────────────────────────────

function GroupsProfileTab({ client }) {
  const [sessions, setSessions] = useState(null)
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch('/api/group-sessions?from=2000-01-01&to=2099-12-31', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(all => {
        const mine = all
          .filter(s => (s.attendance || []).some(a => a.client_id === client.id))
          .map(s => ({
            ...s,
            myAtt: (s.attendance || []).find(a => a.client_id === client.id),
          }))
          .sort((a, b) => b.session_date.localeCompare(a.session_date))
        setSessions(mine)
        setLoading(false)
      })
      .catch(() => { setSessions([]); setLoading(false) })
  }, [client.id])

  if (loading) return <p className="py-7 text-center text-sm text-gray-400 dark:text-gray-500">Loading…</p>
  if (!sessions?.length) return (
    <p className="py-7 text-center text-sm text-gray-400 italic dark:text-gray-500">No group session records for this resident.</p>
  )

  return (
    <div>
      {sessions.map(s => {
        const present = (s.attendance || []).filter(a => a.present).length
        const total   = (s.attendance || []).length
        return (
          <div key={s.id} className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-700">
            <div className="flex justify-between items-start gap-2">
              <div>
                <div className="flex items-center gap-1.5 font-bold text-sm text-gray-900 dark:text-gray-100">
                  {s.group_name}
                  {s.time_of_day && (
                    <span className="text-[10px] font-extrabold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full dark:bg-blue-900/30 dark:text-blue-400">
                      {s.time_of_day}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-gray-400 mt-0.5">
                  {fmtDate(s.session_date)}{s.facilitator ? ` · ${s.facilitator}` : ''}
                </div>
                {total > 0 && <div className="text-[11px] text-gray-500 mt-0.5">Group: {present}/{total} attended</div>}
              </div>
              {s.myAtt && (
                <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${s.myAtt.present ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-gray-100 text-gray-400 dark:bg-gray-700'}`}>
                  {s.myAtt.present ? 'Present' : 'Absent'}
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── NavButton helper ─────────────────────────────────────────────────────

function NavBtn({ onClick, disabled, children }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={`px-2.5 py-0.5 rounded text-[11px] text-white border border-white/20 bg-white/10 transition-opacity ${disabled ? 'opacity-40 cursor-default' : 'hover:bg-white/20 cursor-pointer'}`}
    >
      {children}
    </button>
  )
}

// ── Main drawer component ─────────────────────────────────────────────────

export default function ClientProfile({ onNavigateTab }) {
  const { profileClientId, openProfile, closeProfile, data } = useData()
  const { hasPerm } = usePermission()

  const [activeTab, setActiveTab] = useState('overview')

  // Reset when profile changes
  useEffect(() => {
    if (profileClientId) { setActiveTab('overview') }
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
      t.push({ id: 'incidents', label: '🚨 Incident Reports' })
    if (hasPerm('violations.log') || hasPerm('violations.review'))
      t.push({ id: 'violations', label: '⚠ Infractions' })
    if (hasPerm('consent.manage') || hasPerm('disclosures.view'))
      t.push({ id: 'consents', label: '📋 Consents' })
    if (hasPerm('groups.view'))
      t.push({ id: 'groups', label: '👥 Groups' })
    if (!client.is_active)
      t.push({ id: 'discharge', label: '📤 Discharge' })
    return t
  }, [client, hasPerm])

  if (!profileClientId || !client) return null

  const riskLevel = computeRisk(client.id, data)
  const days      = daysSince(client.intake_date)

  return (
    <>
      {/* Backdrop */}
      <div onClick={closeProfile} className="fixed inset-0 bg-slate-900/40 z-[1200]" />

      {/* Drawer panel */}
      <div className="fixed top-0 right-0 bottom-0 w-[490px] bg-white dark:bg-gray-900 z-[1201] flex flex-col shadow-[-6px_0_32px_rgba(0,0,0,0.2)] overflow-hidden">

        {/* ── Header ── */}
        <div className="bg-[#0a4655] text-white px-4 pt-3 pb-2.5 shrink-0">
          {/* Caseload nav row */}
          <div className="flex justify-between items-center mb-2.5">
            <div className="flex gap-1.5 items-center">
              <NavBtn onClick={() => openProfile(prevClient.id)} disabled={!prevClient}>← Prev</NavBtn>
              {rosterIdx >= 0 && (
                <span className="text-[10px] text-blue-200">{rosterIdx + 1} / {roster.length}</span>
              )}
              <NavBtn onClick={() => openProfile(nextClient.id)} disabled={!nextClient}>Next →</NavBtn>
            </div>
            <button onClick={closeProfile}
              className="w-7 h-7 rounded flex items-center justify-center text-sm text-white bg-white/10 border border-white/20 hover:bg-white/20 cursor-pointer">
              ✕
            </button>
          </div>

          {/* Identity row */}
          <div className="flex items-center gap-3">
            {client.photo
              ? <img src={client.photo} alt="" className="w-11 h-11 rounded-full object-cover border-2 border-white/30 shrink-0" />
              : <div className="w-11 h-11 rounded-full bg-white/15 flex items-center justify-center text-xl shrink-0">👤</div>
            }
            <div className="flex-1 min-w-0">
              <div className="font-extrabold text-base text-white truncate">{client.name}</div>
              <div className="text-[11px] text-blue-200 mt-0.5">
                Rm. {client.room}
                {days != null ? ` · Day ${days}` : ''}
                {!client.is_active && ' · Discharged'}
              </div>
            </div>
            <RiskChip level={riskLevel} />
          </div>
        </div>

        {/* ── Tab bar ── */}
        <div className="flex shrink-0 bg-gray-50 border-b-2 border-gray-200 overflow-x-auto dark:bg-gray-800 dark:border-gray-700">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`px-3 py-2 border-none whitespace-nowrap text-xs -mb-0.5 border-b-2 cursor-pointer bg-transparent transition-colors
                ${activeTab === t.id
                  ? 'border-b-[#c9780c] text-[#c9780c] font-bold'
                  : 'border-b-transparent text-gray-500 font-medium hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Tab body (scrollable) ── */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {activeTab === 'overview'    && <OverviewTab       client={client} data={data} />}
          {activeTab === 'timeline'    && <TimelineTab       client={client} data={data} />}
          {activeTab === 'passes'      && <PassesTab         client={client} data={data} />}
          {activeTab === 'mail'        && <MailSubTab        client={client} data={data} />}
          {activeTab === 'ua'          && <UATab             client={client} data={data} hasPerm={hasPerm} />}
          {activeTab === 'meds'        && <MedsTab           client={client} data={data} />}
          {activeTab === 'milestones'  && <MilestonesTab     client={client} data={data} />}
          {activeTab === 'incidents'   && <IncidentsTab         client={client} data={data} />}
          {activeTab === 'violations'  && <ViolationsProfileTab client={client} />}
          {activeTab === 'consents'    && <ConsentsTab          client={client} />}
          {activeTab === 'groups'      && <GroupsProfileTab  client={client} />}
          {activeTab === 'discharge'   && <DischargeTab      client={client} data={data} />}
        </div>
      </div>
    </>
  )
}
