import { useEffect, useState, useCallback } from 'react'
import {
  Button, Select, Checkbox, Label, Badge,
  Table, TableHead, TableHeadCell, TableBody, TableRow, TableCell,
} from 'flowbite-react'
import { Panel, Field, ErrLine, useConfirm } from '../components/ui.jsx'
import { api, errOf } from '../api.js'

export default function Rollout() {
  const confirm = useConfirm()
  const [ro, setRo] = useState(null)
  const [facs, setFacs] = useState([])
  const [rels, setRels] = useState([])
  const [version, setVersion] = useState('')
  const [canary, setCanary] = useState({})
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const r = await api('/api/rollout')
    if (!r.ok) return
    setRo(r.body.rollout || null)
    setFacs(r.body.facilities || [])
    const published = (r.body.releases || []).filter((x) => x.status === 'published')
    setRels(published)
    setVersion((v) => v || (published[0]?.version || ''))
  }, [])

  useEffect(() => { load() }, [load])

  const start = async () => {
    setErr('')
    if (!version) { setErr('Import a facility release first'); return }
    const canary_ids = Object.keys(canary).filter((k) => canary[k])
    const ok = await confirm({
      title: `Start rollout of v${version}?`,
      body: canary_ids.length ? `Updates ${canary_ids.length} canary facility(ies) first.` : 'Updates ALL facilities.',
      confirmText: 'Start rollout',
    })
    if (!ok) return
    const r = await api('/api/rollout', { method: 'POST', body: { version, canary_ids } })
    if (!r.ok) { setErr(errOf(r, 'Failed')); return }
    setCanary({})
    load()
  }

  const action = async (a) => {
    if (a === 'advance' && !await confirm({ title: 'Advance to ALL facilities now?', confirmText: 'Advance' })) return
    const r = await api(`/api/rollout/${a}`, { method: 'POST' })
    if (!r.ok) { await confirm({ title: 'Failed', body: errOf(r), confirmText: 'OK' }); return }
    load()
  }

  const onTarget = ro ? facs.filter((f) => (f.app_version || '') === ro.version).length : 0

  return (
    <>
      <Panel title="Fleet rollout"
        action={<Button size="xs" color="light" onClick={load}>Refresh</Button>}>
        {ro ? (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>Target <b>v{ro.version}</b></span>
              <Badge color={ro.state === 'paused' ? 'failure' : 'success'} className="inline-flex w-fit">{ro.state}</Badge>
              <span className="text-gray-500">· {onTarget} / {facs.length} on target</span>
              {ro.canary_ids?.length > 0 && <span className="text-gray-500">· canary {ro.canary_ids.length}</span>}
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {(ro.state === 'canary' || ro.state === 'active') && <Button size="xs" color="light" onClick={() => action('pause')}>Pause</Button>}
              {ro.state === 'paused' && <Button size="xs" color="default" onClick={() => action('resume')}>Resume</Button>}
              {ro.state === 'canary' && <Button size="xs" color="light" onClick={() => action('advance')}>Advance to all</Button>}
            </div>
          </>
        ) : <p className="text-sm text-gray-500">No active rollout.</p>}
      </Panel>

      <Panel title="Start a rollout">
        <p className="mb-3 text-xs text-gray-500">
          Pick a stored, published facility version. <b>Canary</b> facilities update first; when they report healthy on
          the new version the rollout auto-advances to the rest. A canary that rolls back auto-pauses it. Facilities apply
          only if they've opted into auto-update (and within their maintenance window).
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Version" className="min-w-[200px]">
            <Select value={version} onChange={(e) => setVersion(e.target.value)} disabled={rels.length === 0}>
              {rels.length === 0
                ? <option value="">(import a facility release first)</option>
                : rels.map((x) => <option key={x.version} value={x.version}>{x.version}</option>)}
            </Select>
          </Field>
          <Button color="default" onClick={start}>Start rollout</Button>
        </div>
        <label className="block mt-3 mb-1 text-sm font-medium text-gray-700">
          Canary facilities (update first; select none = all-at-once)
        </label>
        {facs.length === 0
          ? <span className="text-sm text-gray-400">No facilities enrolled.</span>
          : (
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {facs.map((f) => (
                <Label key={f.id} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={!!canary[f.id]} onChange={(e) => setCanary({ ...canary, [f.id]: e.target.checked })} />
                  {f.name} <span className="text-gray-400">({f.app_version || '?'})</span>
                </Label>
              ))}
            </div>
          )}
        <ErrLine>{err}</ErrLine>
      </Panel>

      <Panel title="Per-facility progress">
        <div className="overflow-x-auto">
          <Table hoverable>
            <TableHead>
              <TableRow>
                <TableHeadCell>Facility</TableHeadCell>
                <TableHeadCell>Running</TableHeadCell>
                <TableHeadCell>Update state</TableHeadCell>
                <TableHeadCell>Reported</TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {facs.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-gray-400">No facilities.</TableCell></TableRow>
              )}
              {facs.map((f) => {
                const onT = ro && (f.app_version || '') === ro.version
                const bad = f.upd_state === 'rolled_back' || f.upd_state === 'failed'
                return (
                  <TableRow key={f.id} className="bg-white">
                    <TableCell>{f.name}</TableCell>
                    <TableCell>{f.app_version || '—'}</TableCell>
                    <TableCell>
                      {onT ? <Badge color="success" className="inline-flex w-fit">on target</Badge>
                        : f.upd_state
                          ? <Badge color={bad ? 'failure' : 'info'} className="inline-flex w-fit">
                              {f.upd_state}{f.upd_attempted ? ` → ${f.upd_attempted}` : ''}
                            </Badge>
                          : <span className="text-gray-400">—</span>}
                    </TableCell>
                    <TableCell className="text-gray-500">{f.upd_reported_at || f.last_seen_at || ''}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </Panel>
    </>
  )
}
