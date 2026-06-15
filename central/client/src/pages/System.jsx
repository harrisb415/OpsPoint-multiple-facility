import { useEffect, useState, useRef, useCallback } from 'react'
import {
  Button, TextInput, Badge, Progress,
  Table, TableHead, TableHeadCell, TableBody, TableRow, TableCell,
} from 'flowbite-react'
import { Panel, ErrLine, useConfirm } from '../components/ui.jsx'
import { api, errOf } from '../api.js'

const DONE = ['idle', 'done', 'error']

export default function System() {
  const confirm = useConfirm()
  const [s, setS] = useState({ current: '—', progress: { phase: 'idle' } })
  const [backups, setBackups] = useState([])
  const [manifestUrl, setManifestUrl] = useState('')
  const [manifestMsg, setManifestMsg] = useState('')
  const [err, setErr] = useState('')
  const poll = useRef(null)

  const loadBackups = useCallback(async () => {
    const r = await api('/api/update/backups')
    if (r.ok) setBackups(r.body || [])
  }, [])

  const stopPoll = () => { if (poll.current) { clearInterval(poll.current); poll.current = null } }

  const startPoll = useCallback(() => {
    stopPoll()
    poll.current = setInterval(async () => {
      try {
        const r = await api('/api/update/status')
        if (!r.ok) return
        setS(r.body)
        const p = r.body.progress || {}
        if (!p.applying && DONE.includes(p.phase || 'idle')) {
          stopPoll()
          if ((p.phase || '') !== 'error') setTimeout(loadBackups, 1500)
        }
      } catch { /* server restarting — keep polling */ }
    }, 1200)
  }, [loadBackups])

  const loadSystem = useCallback(async () => {
    const r = await api('/api/update/status')
    if (!r.ok) return
    setS(r.body)
    loadBackups()
    const mu = await api('/api/update/manifest-url')
    if (mu.ok) setManifestUrl(mu.body.url || '')
    if (r.body.progress?.applying) startPoll()
  }, [loadBackups, startPoll])

  useEffect(() => { loadSystem(); return stopPoll }, [loadSystem])

  const saveManifestUrl = async () => {
    setManifestMsg('Saving…')
    const r = await api('/api/update/manifest-url', { method: 'POST', body: { url: manifestUrl.trim() } })
    setManifestMsg(r.ok ? 'Saved.' : errOf(r, 'Error'))
    setTimeout(() => setManifestMsg(''), 2500)
  }

  const check = async () => {
    setErr('Checking…')
    const r = await api('/api/update/check', { method: 'POST' })
    if (!r.ok) { setErr(errOf(r, 'Check failed')); return }
    setErr('')
    setS({ ...r.body, progress: { phase: 'idle' } })
    loadBackups()
  }

  const apply = async () => {
    if (!await confirm({ title: 'Install this update?', body: 'Download, verify, and install. The HQ server will restart.', confirmText: 'Install' })) return
    const r = await api('/api/update/apply', { method: 'POST' })
    if (!r.ok) { setErr(errOf(r, 'Install failed to start')); return }
    startPoll()
  }

  const rollback = async () => {
    if (!await confirm({ title: 'Roll back to the previous HQ version?', body: 'The server will restart.', confirmText: 'Roll back', color: 'red' })) return
    const r = await api('/api/update/rollback', { method: 'POST' })
    if (!r.ok) { setErr(errOf(r, 'Rollback failed')); return }
    startPoll()
  }

  const avail = !!(s.available && s.latest)
  const p = s.progress || {}
  const ph = p.phase || 'idle'
  const active = !!p.applying || !DONE.includes(ph)

  return (
    <>
      <Panel title="HQ software updates"
        action={<Button size="xs" color="light" onClick={check}>Check for updates</Button>}>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <TextInput sizing="sm" className="flex-1 min-w-[280px]" placeholder="https://github.com/…/central-manifest.json"
            value={manifestUrl} onChange={(e) => setManifestUrl(e.target.value)} />
          <Button size="sm" color="light" onClick={saveManifestUrl}>Save URL</Button>
          <span className="text-xs text-gray-500">{manifestMsg}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-sm">Current version: <b>{s.current || '—'}</b></div>
          <span className="text-sm text-gray-500">
            {s.latest ? (avail ? `→ v${s.latest} available` : '· up to date') : ''}
          </span>
          {s.latest && avail && (
            s.signed
              ? <Badge color="success" className="inline-flex w-fit">signed</Badge>
              : <Badge color="failure" className="inline-flex w-fit">unsigned — will be refused</Badge>
          )}
          <span className="flex-1" />
          {avail && s.signed && <Button size="sm" color="default" onClick={apply}>Download &amp; install</Button>}
        </div>

        {active && (
          <div className="mt-4">
            <Progress progress={p.pct || 0} color="blue" />
            <p className="mt-1.5 text-xs text-gray-500">{p.message || ''}</p>
          </div>
        )}
        <ErrLine>{(ph === 'error' && p.error) ? p.error : err}</ErrLine>

        {s.changelog?.length > 0 && (
          <div className="mt-2 text-xs text-gray-500">
            <b>Changelog</b>
            <ul className="mt-1 ml-4 list-disc">{s.changelog.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </div>
        )}
        <p className="mt-3 text-xs text-gray-400">
          Updates must be signed with the OpsPoint release key — the server refuses anything unsigned, tampered,
          or from a non-allow-listed host. A full backup (code + central.db) is taken before applying; roll back
          below if needed. The HQ server restarts to finish.
        </p>
      </Panel>

      <Panel title="Backups"
        action={<Button size="xs" color="light" onClick={rollback}>Roll back to previous</Button>}>
        <div className="overflow-x-auto">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeadCell>From</TableHeadCell>
                <TableHeadCell>To</TableHeadCell>
                <TableHeadCell>When</TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {backups.length === 0 && (
                <TableRow><TableCell colSpan={3} className="text-gray-400">None yet.</TableCell></TableRow>
              )}
              {backups.map((b, i) => (
                <TableRow key={i} className="bg-white">
                  <TableCell>{b.from || '—'}</TableCell>
                  <TableCell>{b.to || '—'}</TableCell>
                  <TableCell className="text-gray-500">{b.ts || ''}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Panel>
    </>
  )
}
