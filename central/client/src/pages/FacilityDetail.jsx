import { useEffect, useState, useCallback, Fragment } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Button, Alert,
  Table, TableHead, TableHeadCell, TableBody, TableRow, TableCell,
} from 'flowbite-react'
import { ArrowLeft, ShieldAlert } from 'lucide-react'
import { Panel } from '../components/ui.jsx'
import { api } from '../api.js'

const PHOTO_KEYS = ['photo', 'ua_photo']
const isPhoto = (k, v) => PHOTO_KEYS.includes(k) && typeof v === 'string' && v.startsWith('data:')
const trunc = (v) => {
  if (v == null) return ''
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  return s.length > 60 ? s.slice(0, 57) + '…' : s
}

function RowDetail({ data }) {
  const keys = Object.keys(data)
  if (!keys.length) return <span className="text-gray-400">empty row</span>
  return (
    <div className="p-3 border border-gray-200 rounded-lg bg-gray-50">
      {keys.map((k) => isPhoto(k, data[k]) ? (
        <div key={k} className="my-2">
          <b className="text-primary-800">{k}</b><br />
          <img src={data[k]} alt={k} className="mt-1 border border-gray-200 rounded-lg max-h-52 max-w-full" />
        </div>
      ) : (
        <div key={k} className="my-1 text-sm">
          <b className="text-primary-800">{k}:</b>{' '}
          <span className="font-mono break-words whitespace-pre-wrap">
            {data[k] && typeof data[k] === 'object' ? JSON.stringify(data[k], null, 2) : String(data[k] ?? '')}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function FacilityDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [meta, setMeta] = useState({ name: 'Loading…', sub: '' })
  const [tables, setTables] = useState(null)
  const [table, setTable] = useState(null)
  const [rows, setRows] = useState([])
  const [count, setCount] = useState('')
  const [open, setOpen] = useState({}) // row index → expanded

  const loadTables = useCallback(async () => {
    const r = await api(`/api/facilities/${id}/stats`)
    if (!r.ok) { setMeta({ name: 'Failed to load', sub: '' }); setTables({}); return }
    const name = r.body.facility?.name || 'Facility'
    const last = r.body.facility?.last_seen_at || 'never'
    setMeta({ name, sub: `${(r.body.total || 0).toLocaleString()} backed-up rows · last check-in ${last}` })
    setTables(r.body.tables || {})
  }, [id])

  useEffect(() => { loadTables() }, [loadTables])

  const openTable = useCallback(async (t) => {
    setTable(t); setCount('Loading…'); setRows([]); setOpen({})
    const r = await api(`/api/facilities/${id}/rows?table=${encodeURIComponent(t)}&limit=500`)
    if (!r.ok) { setCount('Failed'); return }
    const rws = r.body.rows || []
    setRows(rws)
    setCount(`${rws.length} row${rws.length === 1 ? '' : 's'}${rws.length >= 500 ? ' (first 500)' : ''}`)
  }, [id])

  // Column set: union of keys across first 50 rows, minus photos, capped at 9.
  const cols = (() => {
    const seen = []
    rows.slice(0, 50).forEach((r) => Object.keys(r.data || {}).forEach((k) => { if (!seen.includes(k)) seen.push(k) }))
    return seen.filter((k) => !PHOTO_KEYS.includes(k)).slice(0, 9)
  })()

  const tableKeys = tables ? Object.keys(tables) : []

  return (
    <>
      <Panel className="!p-4">
        <div className="flex items-center gap-3">
          <Button size="xs" color="light" onClick={() => navigate(-1)}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
          <h2 className="text-base font-semibold text-gray-900">{meta.name}</h2>
          <span className="flex-1" />
          <span className="text-xs text-gray-500">{meta.sub}</span>
        </div>
      </Panel>

      <Alert color="failure" icon={ShieldAlert} className="mb-4">
        <span className="font-semibold">Protected health information.</span> The records below are the
        backed-up facility data and include resident names, narratives, and photos. Every table you open
        is recorded in the HQ audit trail.
      </Alert>

      <Panel title="Backed-up tables">
        {tables == null ? <span className="text-sm text-gray-400">Loading…</span>
          : tableKeys.length === 0 ? <span className="text-sm text-gray-400">No backed-up data yet for this facility.</span>
          : (
            <div className="flex flex-wrap gap-2">
              {tableKeys.map((t) => (
                <Button key={t} size="xs" color={t === table ? 'default' : 'light'} onClick={() => openTable(t)}>
                  {t} <span className="ml-1 opacity-70">({tables[t]})</span>
                </Button>
              ))}
            </div>
          )}
      </Panel>

      {table && (
        <Panel
          title={table}
          action={<Button size="xs" color="light" onClick={() => openTable(table)}>Refresh</Button>}
        >
          <p className="mb-3 -mt-2 text-xs text-gray-500">{count}</p>
          <div className="overflow-x-auto">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeadCell>id</TableHeadCell>
                  {cols.map((c) => <TableHeadCell key={c}>{c}</TableHeadCell>)}
                  <TableHeadCell><span className="sr-only">Details</span></TableHeadCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow><TableCell colSpan={cols.length + 2} className="text-gray-400">No rows in this table.</TableCell></TableRow>
                )}
                {rows.map((r, i) => (
                  <Fragment key={i}>
                    <TableRow className="bg-white">
                      <TableCell className="font-mono text-xs">{r.source_id}</TableCell>
                      {cols.map((c) => <TableCell key={c}>{trunc((r.data || {})[c])}</TableCell>)}
                      <TableCell className="text-right">
                        <Button size="xs" color="light" onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}>Details</Button>
                      </TableCell>
                    </TableRow>
                    {open[i] && (
                      <TableRow>
                        <TableCell colSpan={cols.length + 2}><RowDetail data={r.data || {}} /></TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
        </Panel>
      )}
    </>
  )
}
