import { useEffect, useState, useCallback } from 'react'
import {
  Button, TextInput, Badge,
  Table, TableHead, TableHeadCell, TableBody, TableRow, TableCell,
} from 'flowbite-react'
import { Panel, Field, ErrLine, StatusPill, useConfirm } from '../components/ui.jsx'
import { api, errOf } from '../api.js'

export default function Releases() {
  const confirm = useConfirm()
  const [rows, setRows] = useState([])
  const [url, setUrl] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const su = await api('/api/releases/saved-urls')
    if (su.ok) setUrl(su.body.facility || '')
    const r = await api('/api/releases')
    if (r.ok) setRows(r.body.releases || [])
  }, [])

  useEffect(() => { load() }, [load])

  const saveUrl = async () => {
    await api('/api/releases/saved-urls', { method: 'POST', body: { channel: 'facility', url: url.trim() } })
  }

  const importRelease = async () => {
    setErr(''); setMsg('Importing… (downloads + verifies the bundle)')
    if (!url.trim()) { setErr('Manifest URL required'); setMsg(''); return }
    const r = await api('/api/releases/import', { method: 'POST', body: { manifest_url: url.trim(), channel: 'facility' } })
    if (!r.ok) { setErr(errOf(r, 'Import failed')); setMsg(''); return }
    await saveUrl()
    setMsg(`✓ Imported v${r.body.release.version}`)
    load()
  }

  const setStatus = async (x, next) => {
    const r = await api(`/api/releases/${encodeURIComponent(x.channel)}/${encodeURIComponent(x.version)}/status`,
      { method: 'POST', body: { status: next } })
    if (!r.ok) { await confirm({ title: 'Failed', body: errOf(r), confirmText: 'OK' }); return }
    load()
  }

  return (
    <>
      <Panel title="Import a release">
        <p className="mb-3 text-xs text-gray-500">
          Fetches a <b>signed</b> manifest, verifies its signature + checksum, downloads the bundle, and stores it
          here so facilities pull from HQ — no internet needed at the buildings. Unsigned or tampered releases are refused.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Manifest URL" className="flex-1 min-w-[280px]">
            <TextInput placeholder="https://github.com/…/releases/latest/download/update-manifest.json"
              value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <Button color="light" onClick={saveUrl}>Save URL</Button>
          <Button color="default" onClick={importRelease}>Import</Button>
        </div>
        <ErrLine>{err}</ErrLine>
        {msg && <p className="mt-1 text-xs text-gray-500">{msg}</p>}
      </Panel>

      <Panel title="Stored releases">
        <div className="overflow-x-auto">
          <Table hoverable>
            <TableHead>
              <TableRow>
                <TableHeadCell>Channel</TableHeadCell>
                <TableHeadCell>Version</TableHeadCell>
                <TableHeadCell>Size</TableHeadCell>
                <TableHeadCell>Signed</TableHeadCell>
                <TableHeadCell>Status</TableHeadCell>
                <TableHeadCell>Imported</TableHeadCell>
                <TableHeadCell><span className="sr-only">Actions</span></TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-gray-400">No releases imported yet.</TableCell></TableRow>
              )}
              {rows.map((x) => {
                const next = x.status === 'published' ? 'yanked' : 'published'
                return (
                  <TableRow key={`${x.channel}-${x.version}`} className="bg-white">
                    <TableCell>{x.channel}</TableCell>
                    <TableCell className="font-mono text-xs">{x.version}</TableCell>
                    <TableCell>{x.size ? `${(x.size / 1048576).toFixed(2)} MB` : '—'}</TableCell>
                    <TableCell>
                      {x.signature
                        ? <Badge color="success" className="inline-flex w-fit">signed</Badge>
                        : <Badge color="failure" className="inline-flex w-fit">unsigned</Badge>}
                    </TableCell>
                    <TableCell><StatusPill status={x.status} /></TableCell>
                    <TableCell className="text-gray-500">{x.created_at || ''}</TableCell>
                    <TableCell className="text-right">
                      <Button size="xs" color="light" onClick={() => setStatus(x, next)}>
                        {next === 'yanked' ? 'Yank' : 'Publish'}
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
        <p className="mt-3 text-xs text-gray-400">
          Facilities pull the latest <b>published facility</b> release from <code>/fleet/manifest</code> (API-key authed).
          Yank to stop serving a version.
        </p>
      </Panel>
    </>
  )
}
