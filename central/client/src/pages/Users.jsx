import { useEffect, useState, useCallback } from 'react'
import {
  Button, TextInput, Select, Checkbox, Label,
  Table, TableHead, TableHeadCell, TableBody, TableRow, TableCell,
} from 'flowbite-react'
import { Panel, Field, ErrLine, StatusPill, useConfirm } from '../components/ui.jsx'
import { api, errOf } from '../api.js'

const ROLES = [
  ['pa', 'Program Assistant'],
  ['supervisor', 'Supervisor'],
  ['case_manager', 'Case Manager'],
  ['admin', 'Administrator'],
]

export default function Users() {
  const confirm = useConfirm()
  const [facs, setFacs] = useState([])
  const [users, setUsers] = useState([])
  const [err, setErr] = useState('')
  const [form, setForm] = useState({ username: '', display_name: '', role: 'pa', password: '' })
  const [picked, setPicked] = useState({}) // facId → bool (new-user assignment)

  const load = useCallback(async () => {
    const r = await api('/api/managed-users')
    if (!r.ok) return
    setFacs(r.body.facilities || [])
    setUsers(r.body.users || [])
  }, [])

  useEffect(() => { load() }, [load])

  const create = async () => {
    setErr('')
    const body = { ...form, username: form.username.trim(), display_name: form.display_name.trim(),
      facilities: Object.keys(picked).filter((k) => picked[k]) }
    if (!body.username || !body.password) { setErr('Username and initial password are required'); return }
    const r = await api('/api/managed-users', { method: 'POST', body })
    if (!r.ok) { setErr(errOf(r, 'Failed')); return }
    setForm({ username: '', display_name: '', role: 'pa', password: '' })
    setPicked({})
    load()
  }

  const assign = async (u, facId, checked) => {
    const next = new Set(u.facilities)
    checked ? next.add(facId) : next.delete(facId)
    setUsers((us) => us.map((x) => x.id === u.id ? { ...x, facilities: [...next] } : x))
    await api(`/api/managed-users/${u.id}/facilities`, { method: 'PUT', body: { facilities: [...next] } })
  }

  const toggleStatus = async (u) => {
    await api(`/api/managed-users/${u.id}`, { method: 'PUT', body: { status: u.status === 'active' ? 'disabled' : 'active' } })
    load()
  }

  const remove = async (u) => {
    const ok = await confirm({
      title: `Delete managed user ${u.username}?`,
      body: 'They will be removed from all assigned facilities on next sync.',
      confirmText: 'Delete', color: 'red',
    })
    if (!ok) return
    await api(`/api/managed-users/${u.id}`, { method: 'DELETE' })
    load()
  }

  return (
    <>
      <Panel title="Add a managed user">
        <p className="mb-3 text-xs text-gray-500">
          Created with an initial password and <b>must-change-on-first-login</b>. The user can sign in at any
          assigned facility that has opted into HQ user management; each facility owns the password after the
          first change. Role maps to that facility's own permission preset.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Username"><TextInput placeholder="jdoe" value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
          <Field label="Display name"><TextInput placeholder="Jane Doe" value={form.display_name}
            onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></Field>
          <Field label="Role">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <Field label="Initial password"><TextInput placeholder="min 8 chars" value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
        </div>
        <label className="block mt-3 mb-1 text-sm font-medium text-gray-700">Assign to facilities</label>
        {facs.length === 0
          ? <span className="text-sm text-gray-400">Enroll a facility first.</span>
          : (
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {facs.map((f) => (
                <Label key={f.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={!!picked[f.id]} onChange={(e) => setPicked({ ...picked, [f.id]: e.target.checked })} />
                  {f.name}
                </Label>
              ))}
            </div>
          )}
        <div className="mt-3"><Button color="default" onClick={create}>Create user</Button></div>
        <ErrLine>{err}</ErrLine>
      </Panel>

      <Panel title="Managed users">
        <div className="overflow-x-auto">
          <Table hoverable>
            <TableHead>
              <TableRow>
                <TableHeadCell>Username</TableHeadCell>
                <TableHeadCell>Name</TableHeadCell>
                <TableHeadCell>Role</TableHeadCell>
                <TableHeadCell>Status</TableHeadCell>
                <TableHeadCell>Assigned facilities</TableHeadCell>
                <TableHeadCell><span className="sr-only">Actions</span></TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-gray-400">No managed users yet.</TableCell></TableRow>
              )}
              {users.map((u) => (
                <TableRow key={u.id} className="bg-white">
                  <TableCell className="font-mono text-xs">{u.username}</TableCell>
                  <TableCell>{u.display_name || '—'}</TableCell>
                  <TableCell>{u.role}</TableCell>
                  <TableCell><StatusPill status={u.status} /></TableCell>
                  <TableCell>
                    {facs.length === 0 ? <span className="text-gray-400">no facilities</span> : (
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {facs.map((f) => (
                          <Label key={f.id} className="flex items-center gap-1.5 text-xs">
                            <Checkbox checked={u.facilities.includes(f.id)}
                              onChange={(e) => assign(u, f.id, e.target.checked)} />
                            {f.name}
                          </Label>
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">
                    <Button size="xs" color="light" className="inline-flex mr-2" onClick={() => toggleStatus(u)}>
                      {u.status === 'active' ? 'Disable' : 'Enable'}
                    </Button>
                    <Button size="xs" color="red" className="inline-flex" onClick={() => remove(u)}>Delete</Button>
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
