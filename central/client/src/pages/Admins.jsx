import { useEffect, useState, useCallback } from 'react'
import {
  Button, TextInput, Badge,
  Modal, ModalHeader, ModalBody, ModalFooter,
  Table, TableHead, TableHeadCell, TableBody, TableRow, TableCell,
} from 'flowbite-react'
import { Panel, Field, ErrLine, useConfirm } from '../components/ui.jsx'
import { api, errOf } from '../api.js'

export default function Admins() {
  const confirm = useConfirm()
  const [me, setMe] = useState(null)
  const [users, setUsers] = useState([])
  const [err, setErr] = useState('')
  const [form, setForm] = useState({ username: '', display_name: '', password: '' })
  const [reset, setReset] = useState(null) // { id, username, pw, err }

  const load = useCallback(async () => {
    const r = await api('/api/central-users')
    if (!r.ok) return
    setMe(r.body.me)
    setUsers(r.body.users || [])
  }, [])

  useEffect(() => { load() }, [load])

  const create = async () => {
    setErr('')
    const body = { username: form.username.trim(), display_name: form.display_name.trim(), password: form.password }
    if (!body.username || !body.password) { setErr('Username and temporary password are required'); return }
    const r = await api('/api/central-users', { method: 'POST', body })
    if (!r.ok) { setErr(errOf(r, 'Failed')); return }
    setForm({ username: '', display_name: '', password: '' })
    load()
  }

  const submitReset = async () => {
    if (reset.pw.length < 10) { setReset({ ...reset, err: 'Password must be at least 10 characters' }); return }
    const r = await api(`/api/central-users/${reset.id}/password`, { method: 'POST', body: { password: reset.pw } })
    if (!r.ok) { setReset({ ...reset, err: errOf(r, 'Failed') }); return }
    setReset(null)
    load()
  }

  const remove = async (u) => {
    const ok = await confirm({
      title: `Delete HQ administrator ${u.username}?`,
      body: 'This cannot be undone.', confirmText: 'Delete', color: 'red',
    })
    if (!ok) return
    const r = await api(`/api/central-users/${u.id}`, { method: 'DELETE' })
    if (!r.ok) { await confirm({ title: 'Delete failed', body: errOf(r), confirmText: 'OK' }); return }
    load()
  }

  return (
    <>
      <Panel title="Add an HQ administrator">
        <p className="mb-3 text-xs text-gray-500">
          HQ admins sign in to <b>this console only</b> — they manage the fleet and never sync down to any
          facility. New admins are created with a temporary password and <b>must change it on first sign-in</b>.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Username"><TextInput placeholder="jsmith" value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
          <Field label="Display name"><TextInput placeholder="Jordan Smith" value={form.display_name}
            onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></Field>
          <Field label="Temporary password"><TextInput placeholder="min 10 chars" value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
        </div>
        <div className="mt-3"><Button color="default" onClick={create}>Create administrator</Button></div>
        <ErrLine>{err}</ErrLine>
      </Panel>

      <Panel title="HQ administrators">
        <div className="overflow-x-auto">
          <Table hoverable>
            <TableHead>
              <TableRow>
                <TableHeadCell>Username</TableHeadCell>
                <TableHeadCell>Name</TableHeadCell>
                <TableHeadCell>Password</TableHeadCell>
                <TableHeadCell>Created</TableHeadCell>
                <TableHeadCell><span className="sr-only">Actions</span></TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-gray-400">No administrators.</TableCell></TableRow>
              )}
              {users.map((u) => {
                const isMe = u.id === me
                const canDelete = !isMe && users.length > 1
                return (
                  <TableRow key={u.id} className="bg-white">
                    <TableCell className="font-mono text-xs">
                      {u.username}{isMe && <Badge color="success" className="inline-flex ml-2 w-fit">you</Badge>}
                    </TableCell>
                    <TableCell>{u.display_name || '—'}</TableCell>
                    <TableCell>
                      {u.must_change_pw
                        ? <Badge color="failure" className="inline-flex w-fit">must change</Badge>
                        : <span className="text-gray-400">set</span>}
                    </TableCell>
                    <TableCell className="text-gray-500">{u.created_at || '—'}</TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button size="xs" color="light" className="inline-flex mr-2"
                        onClick={() => setReset({ id: u.id, username: u.username, pw: '', err: '' })}>Reset password</Button>
                      <Button size="xs" color="red" className="inline-flex" disabled={!canDelete}
                        onClick={() => remove(u)}>Delete</Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
        <p className="mt-3 text-xs text-gray-400">You cannot delete your own account or the last remaining administrator.</p>
      </Panel>

      <Modal show={!!reset} size="md" onClose={() => setReset(null)}>
        <ModalHeader>Reset password — {reset?.username}</ModalHeader>
        <ModalBody>
          <Field label="New password" hint="Minimum 10 characters. They must change it on next sign-in.">
            <TextInput type="text" value={reset?.pw || ''} autoFocus
              onChange={(e) => setReset({ ...reset, pw: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && submitReset()} />
          </Field>
          <ErrLine>{reset?.err}</ErrLine>
        </ModalBody>
        <ModalFooter className="justify-end">
          <Button color="light" onClick={() => setReset(null)}>Cancel</Button>
          <Button color="default" onClick={submitReset}>Reset password</Button>
        </ModalFooter>
      </Modal>
    </>
  )
}
