import { useState, useMemo, useEffect } from 'react'
import { useData } from '../../contexts/DataContext.jsx'
import { usePermission } from '../../hooks/usePermission.js'
import { ShieldCheck, FileCheck, Share2, Plus } from 'lucide-react'
import {
  Breadcrumb, BreadcrumbItem, Button, Select, Checkbox, Label,
  TextInput, Textarea, Modal, ModalHeader, ModalBody, ModalFooter, Alert,
} from 'flowbite-react'
import { Table, TableHead, TableHeadCell, TableBody, TableRow, TableCell } from '../../components/table'
import { initials } from '../../utils/ui.js'
import { Field, ColoredAvatar, StatusBadge, useConfirm } from '../../components/ui.jsx'

const CARD = 'p-8 bg-white border border-gray-200 shadow-sm rounded-xl dark:border-gray-700 dark:bg-gray-800'

function todayStr() { return new Date().toISOString().slice(0, 10) }
function fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

function consentStatus(row) {
  if (row.revoked) return { key: 'revoked', color: 'gray', label: 'Revoked' }
  if (row.expiration_date) {
    const exp = new Date(row.expiration_date + 'T23:59:59')
    if (exp < new Date()) return { key: 'expired', color: 'gray', label: 'Expired' }
  }
  return { key: 'active', color: 'success', label: 'Active' }
}

const BLANK = {
  recipient_name: '', recipient_org: '',
  purpose: '', information_type: 'all',
  effective_date: todayStr(),
  expiration_date: '',
  signature_on_file: true,
}

const INFO_TYPES = [
  { value:'all',                 label:'All records' },
  { value:'ua_records',          label:'UA records only' },
  { value:'incidents',           label:'Behavioral incidents only' },
  { value:'milestones',          label:'Milestones only' },
  { value:'med_administration_log', label:'Med admin log only' },
  { value:'discharge_records',   label:'Discharge record only' },
]
const INFO_LABEL = Object.fromEntries(INFO_TYPES.map(t => [t.value, t.label]))

export default function ConsentTab() {
  const { data } = useData()
  const { hasPerm } = usePermission()
  const canManage   = hasPerm('consent.manage')
  const canViewDisc = hasPerm('disclosures.view')
  const confirm = useConfirm()

  const clients = useMemo(() =>
    (data?.clients || [])
      .filter(c => !c.is_special && c.name !== 'VACANT')
      .slice().sort((a, b) => (parseInt(a.room)||0) - (parseInt(b.room)||0)),
    [data?.clients]
  )

  const [selectedClient, setSelectedClient] = useState('')
  const [consents, setConsents] = useState([])
  const [disclosures, setDisclosures] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)
  const [modalErr, setModalErr] = useState('')

  async function loadConsents(cid) {
    if (!cid) { setConsents([]); setDisclosures([]); return }
    setLoading(true); setErr('')
    try {
      const r = await fetch(`/api/consent-records/${cid}`, { credentials:'include' })
      if (!r.ok) throw new Error()
      setConsents(await r.json())
      if (canViewDisc) {
        const d = await fetch(`/api/disclosures/${cid}`, { credentials:'include' })
        if (d.ok) setDisclosures(await d.json())
        else setDisclosures([])
      }
    } catch { setErr('Failed to load consents') }
    finally { setLoading(false) }
  }

  useEffect(() => { if (selectedClient) loadConsents(selectedClient) }, [selectedClient])

  async function save() {
    if (!selectedClient) { setModalErr('Select a resident first'); return }
    if (!form.recipient_name.trim()) { setModalErr('Recipient name required'); return }
    if (!form.purpose.trim()) { setModalErr('Purpose required'); return }
    setSaving(true); setModalErr('')
    try {
      const r = await fetch('/api/consent-records', {
        method:'POST', credentials:'include',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          client_id: parseInt(selectedClient),
          recipient_name: form.recipient_name.trim(),
          recipient_org:  form.recipient_org.trim(),
          purpose:        form.purpose.trim(),
          information_type: form.information_type,
          effective_date: form.effective_date,
          expiration_date: form.expiration_date || null,
          signature_on_file: form.signature_on_file ? 1 : 0,
        }),
      })
      const j = await r.json().catch(()=>({}))
      if (!r.ok) { setModalErr(j.error || 'Save failed'); return }
      setModal(false); setForm(BLANK)
      loadConsents(selectedClient)
    } catch { setModalErr('Network error') } finally { setSaving(false) }
  }

  async function revoke(c) {
    if (!await confirm({ title: `Revoke consent to ${c.recipient_name}?`, body: 'This cannot be undone.', confirmText: 'Revoke', color: 'red' })) return
    const r = await fetch(`/api/consent-records/${c.id}/revoke`, { method:'PUT', credentials:'include' })
    if (!r.ok) { const j = await r.json().catch(()=>({})); alert(j.error||'Revoke failed'); return }
    loadConsents(selectedClient)
  }

  const activeCount = consents.filter(c => consentStatus(c).key === 'active').length
  const inactiveCount = consents.length - activeCount

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col gap-4 mb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Breadcrumb className="mb-1">
            <BreadcrumbItem>Records</BreadcrumbItem>
            <BreadcrumbItem>Consents</BreadcrumbItem>
          </Breadcrumb>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Consents</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">42 CFR Part 2 — consent &amp; disclosure tracking</p>
        </div>
        {canManage && selectedClient && (
          <Button onClick={() => { setForm(BLANK); setModalErr(''); setModal(true) }}><Plus className="w-4 h-4 mr-2" /> New Consent</Button>
        )}
      </div>

      {/* Resident selector */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-sm font-medium text-gray-600 dark:text-gray-300">Resident:</span>
        <Select sizing="sm" value={selectedClient} onChange={e => setSelectedClient(e.target.value)}>
          <option value="">— select resident —</option>
          {clients.map(c => <option key={c.id} value={c.id}>Rm {c.room} — {c.name}</option>)}
        </Select>
      </div>

      {!selectedClient ? (
        <div className={`${CARD} text-sm text-center text-gray-400`}>
          Select a resident to view their consent records and disclosure history.
        </div>
      ) : loading ? (
        <div className={`${CARD} text-sm text-center text-gray-400`}>Loading…</div>
      ) : err ? (
        <div className={`${CARD} text-sm text-center text-red-600`}>{err}</div>
      ) : (
        <>
          <div className="grid gap-4 mb-4 sm:grid-cols-2 xl:grid-cols-3">
            {[
              { label: 'Active Consents', value: activeCount, sub: 'currently in force', Icon: ShieldCheck, tint: 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-300' },
              { label: 'Revoked / Expired', value: inactiveCount, sub: 'no longer valid', Icon: FileCheck, tint: 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-300' },
              ...(canViewDisc ? [{ label: 'Disclosures', value: disclosures.length, sub: 'external releases logged', Icon: Share2, tint: 'bg-sky-100 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300' }] : []),
            ].map(k => (
              <div key={k.label} className="p-4 bg-white border border-gray-200 shadow-sm rounded-xl dark:border-gray-700 sm:p-5 dark:bg-gray-800">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-sm font-normal text-gray-500 dark:text-gray-400">{k.label}</h3>
                    <p className="mt-1 text-3xl font-bold leading-none text-gray-900 dark:text-white">{k.value}</p>
                    <p className="mt-2 text-xs text-gray-400">{k.sub}</p>
                  </div>
                  <div className={`flex items-center justify-center rounded-lg w-11 h-11 ${k.tint}`}><k.Icon className="w-5 h-5" /></div>
                </div>
              </div>
            ))}
          </div>

          <h3 className="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">Active &amp; historical consents</h3>
          {consents.length === 0
            ? <div className={`${CARD} text-sm text-center text-gray-400`}>No consent records on file.</div>
            : (
              <Table hoverable>
                <TableHead>
                  <TableRow>
                    <TableHeadCell>Recipient</TableHeadCell>
                    <TableHeadCell>Purpose</TableHeadCell>
                    <TableHeadCell>Scope</TableHeadCell>
                    <TableHeadCell>Effective</TableHeadCell>
                    <TableHeadCell>Expires</TableHeadCell>
                    <TableHeadCell>Status</TableHeadCell>
                    <TableHeadCell><span className="sr-only">Actions</span></TableHeadCell>
                  </TableRow>
                </TableHead>
                <TableBody className="divide-y">
                  {consents.map(c => {
                    const st = consentStatus(c)
                    return (
                      <TableRow key={c.id} className="bg-white dark:border-gray-700 dark:bg-gray-800">
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <ColoredAvatar name={c.recipient_name} />
                            <div>
                              <p className="text-sm font-semibold text-gray-900 dark:text-white">{c.recipient_name}</p>
                              {c.recipient_org && <p className="font-mono text-xs text-gray-400">{c.recipient_org}</p>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-gray-500 dark:text-gray-400">{c.purpose}</TableCell>
                        <TableCell className="text-gray-500 dark:text-gray-400">{INFO_LABEL[c.information_type] || c.information_type}</TableCell>
                        <TableCell className="font-mono">{fmtDate(c.effective_date)}</TableCell>
                        <TableCell className="font-mono">{c.expiration_date ? fmtDate(c.expiration_date) : '—'}</TableCell>
                        <TableCell><StatusBadge color={st.color}>{st.label}</StatusBadge></TableCell>
                        <TableCell className="text-right">
                          {!c.revoked && canManage
                            ? <Button size="xs" color="light" className="text-red-600" onClick={() => revoke(c)}>Revoke</Button>
                            : <span className="text-xs text-gray-300">—</span>}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )
          }

          {canViewDisc && (
            <>
              <h3 className="mt-6 mb-2 text-sm font-semibold text-gray-700 dark:text-gray-200">Disclosure history</h3>
              {disclosures.length === 0
                ? <div className={`${CARD} text-sm text-center text-gray-400`}>No external disclosures logged.</div>
                : (
                  <Table hoverable>
                    <TableHead>
                      <TableRow>
                        <TableHeadCell>When</TableHeadCell>
                        <TableHeadCell>Recipient</TableHeadCell>
                        <TableHeadCell>Scope</TableHeadCell>
                        <TableHeadCell>Method</TableHeadCell>
                        <TableHeadCell>By</TableHeadCell>
                        <TableHeadCell>Consent</TableHeadCell>
                      </TableRow>
                    </TableHead>
                    <TableBody className="divide-y">
                      {disclosures.map(d => (
                        <TableRow key={d.id} className="bg-white dark:border-gray-700 dark:bg-gray-800">
                          <TableCell className="font-mono">{fmtDate((d.disclosed_at||'').slice(0,10))} {(d.disclosed_at||'').slice(11,16)}</TableCell>
                          <TableCell>{d.recipient}</TableCell>
                          <TableCell className="text-gray-500 dark:text-gray-400">{INFO_LABEL[d.information_type] || d.information_type}</TableCell>
                          <TableCell className="text-gray-500 dark:text-gray-400">{d.method || '—'}</TableCell>
                          <TableCell className="text-gray-500 dark:text-gray-400">{d.disclosed_by_name}</TableCell>
                          <TableCell className="font-mono">{d.consent_id ? '✓ #' + d.consent_id : '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )
              }
            </>
          )}
        </>
      )}

      {modal && (
        <Modal show size="xl" onClose={() => setModal(false)}>
          <ModalHeader>New Consent — {clients.find(c=>String(c.id)===selectedClient)?.name || ''}</ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              {modalErr && <Alert color="failure">{modalErr}</Alert>}
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Per 42 CFR Part 2 §2.31, consent must specify the recipient, purpose,
                information scope, effective date, expiration, and the patient's right to revoke.
              </p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Recipient name"><TextInput value={form.recipient_name} onChange={e=>setForm({...form, recipient_name:e.target.value})}/></Field>
                <Field label="Recipient organization"><TextInput value={form.recipient_org} onChange={e=>setForm({...form, recipient_org:e.target.value})}/></Field>
              </div>
              <Field label="Purpose of disclosure"><Textarea rows={2} value={form.purpose} onChange={e=>setForm({...form, purpose:e.target.value})}/></Field>
              <Field label="Information scope">
                <Select value={form.information_type} onChange={e=>setForm({...form, information_type:e.target.value})}>
                  {INFO_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Effective date"><TextInput type="date" value={form.effective_date} onChange={e=>setForm({...form, effective_date:e.target.value})}/></Field>
                <Field label="Expiration date (blank = none)"><TextInput type="date" value={form.expiration_date} onChange={e=>setForm({...form, expiration_date:e.target.value})}/></Field>
              </div>
              <Label className="flex items-center gap-2 text-sm">
                <Checkbox checked={!!form.signature_on_file} onChange={e=>setForm({...form, signature_on_file:e.target.checked})}/>
                Patient signature is on file (paper form scanned to records)
              </Label>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                The patient retains the right to revoke this consent at any time. Once revoked,
                this record will be marked revoked and the consent gate will block further disclosures.
              </p>
            </div>
          </ModalBody>
          <ModalFooter className="justify-end">
            <Button color="light" onClick={()=>setModal(false)}>Cancel</Button>
            <Button disabled={saving} isProcessing={saving} onClick={save}>Save Consent</Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}
