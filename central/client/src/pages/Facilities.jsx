import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Button, TextInput,
  Table, TableHead, TableHeadCell, TableBody, TableRow, TableCell,
} from 'flowbite-react'
import { Copy, Check } from 'lucide-react'
import { Panel, Field, ErrLine, StatusPill, useConfirm } from '../components/ui.jsx'
import { api, errOf } from '../api.js'

export default function Facilities() {
  const confirm = useConfirm()
  const [rows, setRows] = useState([])
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [reveal, setReveal] = useState(null) // { facName, facId, key }
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    const r = await api('/api/facilities')
    if (r.ok) setRows(r.body.facilities || [])
  }, [])

  useEffect(() => { load() }, [load])

  const create = async () => {
    setErr(''); setReveal(null); setCopied(false)
    if (!name.trim()) { setErr('Enter a facility name'); return }
    const r = await api('/api/facilities', { method: 'POST', body: { name: name.trim() } })
    if (!r.ok) { setErr(errOf(r, 'Failed')); return }
    setName('')
    setReveal({ facName: r.body.facility.name, facId: r.body.facility.id, key: r.body.apiKey })
    load()
  }

  const copyKey = () => {
    if (reveal?.key && navigator.clipboard) {
      navigator.clipboard.writeText(reveal.key)
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    }
  }

  const toggle = async (f) => {
    await api(`/api/facilities/${f.id}/status`, { method: 'POST', body: { status: f.status === 'active' ? 'disabled' : 'active' } })
    load()
  }

  const remove = async (f) => {
    const ok = await confirm({
      title: `Remove “${f.name}”?`,
      body: 'This deletes the facility record, its API key, and all backed-up data from HQ. The facility\'s own database is not affected.\n\nThis cannot be undone.',
      confirmText: 'Remove', color: 'red',
    })
    if (!ok) return
    const r = await api(`/api/facilities/${f.id}`, { method: 'DELETE' })
    if (!r.ok) { await confirm({ title: 'Remove failed', body: errOf(r), confirmText: 'OK' }); return }
    load()
  }

  return (
    <>
      <Panel title="Enroll a facility">
        <div className="flex items-end gap-3">
          <Field label="Facility name" className="flex-1">
            <TextInput placeholder="e.g. Maple House" value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()} />
          </Field>
          <Button color="default" onClick={create}>Create &amp; generate key</Button>
        </div>
        <ErrLine>{err}</ErrLine>

        {reveal && (
          <div className="p-4 mt-3 border rounded-lg border-amber-300 bg-amber-50">
            <strong className="text-sm text-gray-900">Enrollment key for {reveal.facName}</strong>
            <code className="block my-2 text-sm break-all">{reveal.key}</code>
            <p className="text-xs text-gray-500">
              Copy this now — it is shown <b>once</b> and cannot be retrieved. Paste it into the facility's{' '}
              <em>Admin → System → Connect to HQ</em> screen along with the Facility ID and this server's URL.
            </p>
            <div className="flex gap-2 mt-3">
              <Button size="xs" color="light" onClick={copyKey}>
                {copied ? <><Check className="w-4 h-4 mr-1" /> Copied</> : <><Copy className="w-4 h-4 mr-1" /> Copy key</>}
              </Button>
              <Button size="xs" color="light" onClick={() => setReveal(null)}>Done</Button>
            </div>
            <p className="mt-2 text-xs text-gray-500">Facility ID: <code>{reveal.facId}</code></p>
          </div>
        )}
      </Panel>

      <Panel title="Facilities">
        <div className="overflow-x-auto">
          <Table hoverable>
            <TableHead>
              <TableRow>
                <TableHeadCell>Name</TableHeadCell>
                <TableHeadCell>Facility ID</TableHeadCell>
                <TableHeadCell>Status</TableHeadCell>
                <TableHeadCell>App</TableHeadCell>
                <TableHeadCell>Last check-in</TableHeadCell>
                <TableHeadCell><span className="sr-only">Actions</span></TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-gray-400">No facilities yet. Enroll one above.</TableCell></TableRow>
              )}
              {rows.map((f) => (
                <TableRow key={f.id} className="bg-white">
                  <TableCell>
                    <Link to={`/facilities/${f.id}`} className="font-medium text-primary-600 hover:underline">{f.name}</Link>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{String(f.id).slice(0, 8)}…</TableCell>
                  <TableCell><StatusPill status={f.status} /></TableCell>
                  <TableCell>{f.app_version || <span className="text-gray-400">—</span>}</TableCell>
                  <TableCell className="text-gray-500">{f.last_seen_at || <span className="text-gray-400">never</span>}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button size="xs" color="light" className="inline-flex mr-2" onClick={() => toggle(f)}>
                      {f.status === 'active' ? 'Disable' : 'Enable'}
                    </Button>
                    <Button size="xs" color="red" className="inline-flex" onClick={() => remove(f)}>Remove</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Panel>
    </>
  )
}
