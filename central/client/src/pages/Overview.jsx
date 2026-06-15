import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Button, TextInput, Badge,
  Table, TableHead, TableHeadCell, TableBody, TableRow, TableCell,
} from 'flowbite-react'
import { Panel, Tile } from '../components/ui.jsx'
import { api } from '../api.js'

function Dot({ on }) {
  return <span className={`inline-block w-2 h-2 mr-1.5 rounded-full ${on ? 'bg-green-500' : 'bg-gray-300'}`} />
}

export default function Overview() {
  const [data, setData] = useState(null)
  const [target, setTarget] = useState('')
  const [msg, setMsg] = useState('')

  const load = useCallback(async () => {
    const r = await api('/api/report/overview')
    if (!r.ok) return
    setData(r.body)
    setTarget((cur) => (document.activeElement?.id === 'fleetTarget' ? cur : (r.body.target_version || '')))
  }, [])

  useEffect(() => { load() }, [load])

  const setFleetTarget = async () => {
    setMsg('')
    const r = await api('/api/fleet/target', { method: 'POST', body: { version: target.trim() } })
    if (!r.ok) { setMsg('Failed'); return }
    setMsg(target.trim() ? `✓ Target set to v${target.trim()}` : '✓ Target cleared')
    load()
  }

  const t = data?.totals || {}
  const facs = data?.facilities || []
  const tv = data?.target_version || ''

  return (
    <>
      <div className="grid grid-cols-2 gap-3 mb-4 sm:grid-cols-3 lg:grid-cols-5">
        <Tile hi label="Facilities" value={`${t.online || 0} / ${t.facilities || 0} online`} />
        <Tile label="Residents" value={t.residents || 0} />
        <Tile label="Open incidents" value={t.incidents_open || 0} />
        <Tile label="On target" value={tv ? `${t.on_target || 0} / ${t.facilities || 0}` : '—'} />
        <Tile label="Gone dark" value={t.dark || 0} />
      </div>

      <Panel>
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <strong className="text-sm text-gray-900">Fleet target version</strong>
            <p className="text-xs text-gray-500">
              The version you want all facilities running. Shown on each node next to its own
              updater — HQ does not push binaries.
            </p>
          </div>
          <span className="flex-1" />
          <TextInput id="fleetTarget" sizing="sm" className="w-32" placeholder="e.g. 2.3.4"
            value={target} onChange={(e) => setTarget(e.target.value)} />
          <Button size="sm" color="default" onClick={setFleetTarget}>Set target</Button>
          <span className="text-xs text-gray-500">{msg}</span>
        </div>
      </Panel>

      <Panel title="Facilities at a glance"
        action={<Button size="xs" color="light" onClick={load}>Refresh</Button>}>
        <div className="overflow-x-auto">
          <Table hoverable>
            <TableHead>
              <TableRow>
                <TableHeadCell>Facility</TableHeadCell>
                <TableHeadCell>Status</TableHeadCell>
                <TableHeadCell>Version</TableHeadCell>
                <TableHeadCell>Residents</TableHeadCell>
                <TableHeadCell>Vacant</TableHeadCell>
                <TableHeadCell>Open incidents</TableHeadCell>
                <TableHeadCell>UA pos/total</TableHeadCell>
                <TableHeadCell>Backed-up rows</TableHeadCell>
                <TableHeadCell>Last check-in</TableHeadCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {facs.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-gray-400">No facilities enrolled yet.</TableCell></TableRow>
              )}
              {facs.map((f) => (
                <TableRow key={f.id} className="bg-white">
                  <TableCell>
                    <Link to={`/facilities/${f.id}`} className="font-medium text-primary-600 hover:underline">{f.name}</Link>
                    {f.status !== 'active' && <span className="ml-1 text-red-600">· disabled</span>}
                  </TableCell>
                  <TableCell>
                    {f.dark
                      ? <span className="text-red-600"><Dot on={false} />gone dark</span>
                      : <span><Dot on={f.online} />{f.online ? 'online' : 'offline'}</span>}
                  </TableCell>
                  <TableCell>
                    {f.version || <span className="text-gray-400">—</span>}
                    {f.behind && <Badge color="failure" className="inline-flex ml-1 w-fit">behind</Badge>}
                  </TableCell>
                  <TableCell>{f.residents}</TableCell>
                  <TableCell>{f.vacant}</TableCell>
                  <TableCell>{f.incidents_open}</TableCell>
                  <TableCell>{f.ua_positive} / {f.ua_total}</TableCell>
                  <TableCell>{(f.rows_total || 0).toLocaleString()}</TableCell>
                  <TableCell className="text-gray-500">{f.last_seen_at || <span className="text-gray-400">never</span>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="mt-3 text-xs text-gray-400">
          Aggregate counts only — no resident names or clinical details are shown here (HIPAA minimum-necessary).
        </p>
      </Panel>
    </>
  )
}
