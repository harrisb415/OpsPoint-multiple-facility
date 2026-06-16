/**
 * ConductUAModal — unified UA entry modal
 *
 * Props:
 *   req           — pending ua_request object (optional; locks Resident field)
 *   clientId      — pre-selected client id (optional)
 *   panel         — array of drug codes, e.g. ['ETG','THC','FEN',...]
 *   clients       — array of active resident objects { id, name, room }
 *   onClose       — called on Cancel / backdrop click
 *   onSaved       — called after all server calls succeed (parent closes modal)
 *
 * Behaviour:
 *   • Always saves to /api/ua-records (resident UAs only — interviews get log-only)
 *   • If an active (unclosed, today) report exists, also adds a log entry via patchData
 *   • If !interview and active report, also stamps last_ua for the resident
 *   • If req provided, acknowledges the pending request
 */
import { useState, useMemo } from 'react'
import {
  Button, Modal, ModalHeader, ModalBody, ModalFooter,
  TextInput, Select, Textarea, Checkbox, Label, Alert,
} from 'flowbite-react'
import { useData } from '../contexts/DataContext.jsx'
import { Field } from './ui.jsx'

// ── Drug label map ────────────────────────────────────────────────────────
const UA_LABELS = {
  ETG:'Alcohol',    THC:'Marijuana',     K2:'Spice',       FEN:'Fentanyl',
  AMP:'Amphetamines', MDMA:'Ecstasy',    MET:'Meth',       PCP:'PCP',
  MOR:'Morphine',   OXY:'Oxycodone',     OPI:'Opiates',    BZO:'Benzos',
  MTD:'Methadone',  BUP:'Buprenorphine', COC:'Cocaine',
}

// ── Reason options ────────────────────────────────────────────────────────
const REASON_OPTS = [
  { v: 'suspicious',       l: 'Suspicion' },
  { v: 'random',           l: 'Random' },
  { v: 'return_from_pass', l: 'Return from pass' },
  { v: 'cm_request',       l: 'CM request' },
  { v: 'other',            l: 'Other' },
]

// ── Time helpers ──────────────────────────────────────────────────────────
function timeFieldDefault() {
  const n = new Date()
  return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`
}
function tsFromInput(val) {
  if (!val) return fmtTime()
  const [h, m] = val.split(':')
  const hr = parseInt(h)
  return `${hr % 12 || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`
}
function fmtTime(d = new Date()) {
  const h = d.getHours(), m = String(d.getMinutes()).padStart(2, '0')
  return `${h % 12 || 12}:${m} ${h >= 12 ? 'PM' : 'AM'}`
}
function dateStamp() {
  return new Date().toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
}
function todayStr() {
  const d = new Date(), p = n => String(n).padStart(2,'0')
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`
}
function nowLocalDT() {
  const d = new Date(), p = n => String(n).padStart(2,'0')
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

// ── Result cycle colours ──────────────────────────────────────────────────
function resultColor(r) {
  if (r === 'POS') return { bg:'#FEE2E2', color:'#991B1B', border:'#FCA5A5' }
  if (r === 'NT')  return { bg:'#F1F5F9', color:'#94A3B8', border:'#E2E8F0' }
  return { bg:'#D8F3DC', color:'#15803D', border:'#86EFAC' }
}

// ── Component ─────────────────────────────────────────────────────────────
export default function ConductUAModal({ req, clientId: initialClientId, panel, clients, onClose, onSaved }) {
  const { data } = useData()

  const [clientId,       setClientId]       = useState(req ? String(req.client_id) : (initialClientId ? String(initialClientId) : ''))
  const [isInterview,    setIsInterview]    = useState(req ? !!req.is_interview : false)
  const [interviewName,  setInterviewName]  = useState(req?.interview_name || '')
  const [staff,          setStaff]          = useState('')
  const [time,           setTime]           = useState(timeFieldDefault)
  const [reason,         setReason]         = useState('')
  const [collMethod,     setCollMethod]     = useState('observed')
  const [results,        setResults]        = useState(() => Object.fromEntries(panel.map(c => [c, 'NEG'])))
  const [notes,          setNotes]          = useState('')
  const [saving,         setSaving]         = useState(false)
  const [err,            setErr]            = useState('')

  // The report to stamp the log entry / last_ua against MUST be the server's
  // authoritative active report — the PATCH /api/data route rejects (403) any
  // reportId that isn't exactly active_report_id. Recomputing it client-side by
  // date breaks for overnight shifts / multiple same-day reports, silently
  // dropping the log entry + last_ua. Use the server value directly.
  const activeReportId = useMemo(() => {
    const id = data?.active_report_id
    if (!id) return null
    const r = (data?.reports || []).find(x => x.id === id)
    return (r && !r.is_closed) ? id : null
  }, [data?.active_report_id, data?.reports])

  function cycleResult(code) {
    setResults(prev => {
      const cur = prev[code]
      return { ...prev, [code]: cur === 'NEG' ? 'POS' : cur === 'POS' ? 'NT' : 'NEG' }
    })
  }

  async function handleSubmit() {
    if (!isInterview && !clientId) { setErr('Select a resident'); return }
    if (!staff.trim())             { setErr('Conducted by is required'); return }
    if (!isInterview && !reason)   { setErr('Select a reason'); return }

    const c = clients.find(x => String(x.id) === String(clientId))

    // ── Build log entry text ──
    const subjectName  = isInterview
      ? (interviewName.trim() || 'Interview')
      : `${c?.name || 'Unknown'} (Rm. ${c?.room || '?'})`
    const pos  = panel.filter(code => results[code] === 'POS')
    const neg  = panel.filter(code => results[code] === 'NEG')
    const nt   = panel.filter(code => results[code] === 'NT')
    const parts = []
    if (pos.length) parts.push(`POS: ${pos.join(', ')}`)
    if (neg.length) parts.push(`NEG: ${neg.join(', ')}`)
    if (nt.length)  parts.push(`NT: ${nt.join(', ')}`)
    const resultStr   = parts.join(' | ') || 'No results entered'
    const reasonLabel = reason
      ? (REASON_OPTS.find(o => o.v === reason)?.l || reason)
      : (isInterview ? 'Interview' : '')
    const collLabel   = collMethod.charAt(0).toUpperCase() + collMethod.slice(1)
    const suffix      = ` — by ${staff.trim()} [${[reasonLabel, collLabel].filter(Boolean).join(', ')}]`
    const logMsg      = pos.length === 0 && nt.length === 0
      ? `${subjectName} — UA: All NEG${suffix}`
      : `${subjectName} — UA: ${resultStr}${suffix}`

    // ── Build panel_results (neg/pos/na) ──
    const panelResults = {}
    panel.forEach(code => {
      const v = results[code]
      panelResults[code] = v === 'POS' ? 'pos' : v === 'NT' ? 'na' : 'neg'
    })
    const anyPos  = Object.values(panelResults).some(v => v === 'pos')
    const overall = anyPos ? 'fail' : 'pass'

    setSaving(true); setErr('')

    try {
      // 1. Create log entry first — we need its ID to link the UA record.
      //    Single PATCH combines the log_entry + last_ua stamp in one round-trip.
      let logEntryId = null
      if (activeReportId) {
        const patch = {
          reportId: activeReportId,
          log_entry: { time: tsFromInput(time), text: logMsg },
          ...(!isInterview && clientId
            ? { last_ua: { [parseInt(clientId)]: dateStamp() } }
            : {}),
        }
        const pr = await fetch('/api/data', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(patch),
        })
        const pj = await pr.json().catch(() => ({}))
        // Don't fail silently: a UA must always produce its log entry + last_ua
        // stamp. If the PATCH is rejected, surface it instead of saving a UA
        // record with no log trail.
        if (!pr.ok) { setErr(pj.error || 'Could not write the log entry — UA not saved.'); setSaving(false); return }
        logEntryId = pj.log_entry_id || null
      }

      // 2. Save UA record (residents and interviews)
      //    log_entry_id links it to the shared chain-of-custody photo on the log entry.
      {
        const body = isInterview ? {
          is_interview:      true,
          client_id:         0,
          client_name:       interviewName.trim() || 'Interview',
          room:              '',
          tested_at:         nowLocalDT(),
          collection_method: collMethod,
          reason,
          result:            overall,
          panel_results:     panelResults,
          witnessed_by_name: staff.trim(),
          notes,
          log_entry_id:      logEntryId,
        } : {
          client_id:         parseInt(clientId),
          client_name:       c?.name  || '',
          room:              c?.room  || '',
          tested_at:         nowLocalDT(),
          collection_method: collMethod,
          reason,
          result:            overall,
          panel_results:     panelResults,
          witnessed_by_name: staff.trim(),
          notes,
          log_entry_id:      logEntryId,
        }
        const r = await fetch('/api/ua-records', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const j = await r.json().catch(() => ({}))
        if (!r.ok) { setErr(j.error || 'Save failed'); setSaving(false); return }
      }

      // 3. Acknowledge pending request (if any)
      if (req?.id && !req.acknowledged) {
        await fetch(`/api/ua-requests/${req.id}/acknowledge`, {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' }, body: '{}',
        })
      }

      await onSaved()
    } catch {
      setErr('Network error')
      setSaving(false)
    }
  }

  return (
    <Modal show size="2xl" onClose={onClose}>
      <ModalHeader>🧪 Conduct UA</ModalHeader>
      <ModalBody>
        <div className="space-y-4">
          {err && <Alert color="failure">{err}</Alert>}

          {/* Interview / Non-Resident toggle — hidden when from a pending request */}
          {!req && (
            <Label className="flex items-center gap-2.5 p-2.5 text-sm border rounded-lg cursor-pointer border-gray-200 dark:border-gray-700">
              <Checkbox checked={isInterview} onChange={() => setIsInterview(v => !v)} />
              Interview / Non-Resident
            </Label>
          )}

          {/* Resident selector or interview name */}
          {isInterview ? (
            <Field label="Name">
              <TextInput value={interviewName} onChange={e => setInterviewName(e.target.value)} placeholder="Interviewee name" autoFocus disabled={!!req} />
            </Field>
          ) : (
            <Field label="Resident">
              <Select value={clientId} onChange={e => setClientId(e.target.value)} disabled={!!req}>
                <option value="">— Select resident —</option>
                {clients.map(c => <option key={c.id} value={c.id}>Rm. {c.room} — {c.name}</option>)}
              </Select>
            </Field>
          )}

          {/* Conducted by + Time */}
          <div className="grid grid-cols-3 gap-3">
            <Field label="Conducted by" className="col-span-2"><TextInput value={staff} onChange={e => setStaff(e.target.value)} placeholder="Staff name" /></Field>
            <Field label="Time"><TextInput type="time" value={time} onChange={e => setTime(e.target.value)} /></Field>
          </div>

          {/* Reason + Collection method */}
          <div className="grid grid-cols-2 gap-3">
            {!isInterview && (
              <Field label="Reason">
                <Select value={reason} onChange={e => setReason(e.target.value)}>
                  <option value="">— Select reason —</option>
                  {REASON_OPTS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                </Select>
              </Field>
            )}
            <Field label="Collection method">
              <Select value={collMethod} onChange={e => setCollMethod(e.target.value)}>
                <option value="observed">Observed</option>
                <option value="unobserved">Unobserved</option>
                <option value="lab">Lab</option>
              </Select>
            </Field>
          </div>

          {/* Substance tiles */}
          <Field label="Results" hint="Tap each to cycle: NEG → POS → NT">
            <div className="grid grid-cols-5 gap-1.5 mt-1">
              {panel.map(code => {
                const res = results[code]
                const { bg, color, border } = resultColor(res)
                return (
                  <button key={code} type="button" onClick={() => cycleResult(code)}
                    style={{ background:bg, color, border:`1.5px solid ${border}` }}
                    className="flex flex-col items-center justify-center px-1 py-1.5 text-center rounded-lg cursor-pointer select-none">
                    <div className="text-xs font-extrabold text-gray-900">{code}</div>
                    <div className="text-[10px] text-gray-500 leading-tight mb-0.5">{UA_LABELS[code] || code}</div>
                    <div className="text-xs font-bold" style={{ color }}>{res}</div>
                  </button>
                )
              })}
            </div>
          </Field>

          {/* Notes */}
          <Field label="Notes (optional)"><Textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></Field>

          {/* Hint when no active report is open */}
          {!activeReportId && (
            <p className="text-xs text-gray-400">No open shift report — UA record will be saved without a log entry.</p>
          )}
        </div>
      </ModalBody>
      <ModalFooter className="justify-end">
        <Button color="light" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} isProcessing={saving}
          disabled={saving || (!isInterview && !clientId) || !staff.trim() || (!isInterview && !reason)}>
          Save UA Record
        </Button>
      </ModalFooter>
    </Modal>
  )
}
