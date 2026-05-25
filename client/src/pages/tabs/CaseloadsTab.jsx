import { useMemo } from 'react'
import { useData } from '../../contexts/DataContext.jsx'

const STATUS_OPTS = [
  { v: 'building', l: 'In Building', c: 's-building' },
  { v: 'work',     l: 'Work',         c: 's-work' },
  { v: 'pass',     l: 'Weekend Pass', c: 's-pass' },
  { v: 'out',      l: 'Out / Other',  c: 's-out' },
  { v: 'bhc',      l: 'BHC',          c: 's-bhc' },
  { v: 'efc',      l: 'EFC',          c: 's-efc' },
  { v: 'hospital', l: 'Hospital',     c: 's-hospital' },
]

function fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

function formatPhone(raw) {
  if (!raw) return '—'
  const d = String(raw).replace(/\D/g, '').replace(/^1(\d{10})$/, '$1')
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  return raw
}

export default function CaseloadsTab() {
  const { data } = useData()
  const clients = data?.clients || []
  const reports = data?.reports || []
  const activeId = data?.active_report_id

  const activeReport = reports.find(r => r.id === activeId)
  const statuses = activeReport?.statuses || {}

  const grouped = useMemo(() => {
    const active = clients.filter(c => c.is_active && !c.is_special && c.name !== 'VACANT' && c.case_manager)
      .slice().sort((a, b) => (parseInt(a.room) || 0) - (parseInt(b.room) || 0))
    const map = new Map()
    active.forEach(c => {
      const cm = c.case_manager || 'Unassigned'
      if (!map.has(cm)) map.set(cm, [])
      map.get(cm).push(c)
    })
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [clients])

  const unassigned = useMemo(() =>
    clients.filter(c => c.is_active && !c.is_special && c.name !== 'VACANT' && !c.case_manager)
      .slice().sort((a, b) => (parseInt(a.room) || 0) - (parseInt(b.room) || 0)),
    [clients]
  )

  if (grouped.length === 0 && unassigned.length === 0) {
    return <div className="empty-state" style={{ paddingTop: 48 }}>No active residents with case managers assigned.</div>
  }

  return (
    <div>
      {grouped.map(([cm, cmClients]) => (
        <div key={cm} className="section">
          <div className="section-head">
            <div className="sh-left">
              <span className="sh-dot" />
              <span>{cm}</span>
            </div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.78rem', color: '#94a3b8' }}>
              {cmClients.length} {cmClients.length === 1 ? 'resident' : 'residents'}
            </span>
          </div>
          <div className="section-body" style={{ padding: 0 }}>
            <div className="roster-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Rm</th>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Phone</th>
                    <th>Intake</th>
                  </tr>
                </thead>
                <tbody>
                  {cmClients.map(c => {
                    const cur = statuses[c.id] || 'building'
                    const opt = STATUS_OPTS.find(o => o.v === cur) || { l: cur, c: '' }
                    return (
                      <tr key={c.id}>
                        <td className="rm">{c.room}</td>
                        <td className="name-cell">{c.name}</td>
                        <td>
                          <span className={`ss ${opt.c}`} style={{ display: 'inline-block', pointerEvents: 'none' }}>
                            {opt.l}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: '.78rem' }}>{formatPhone(c.phone)}</td>
                        <td className="date-cell">{fmtDate(c.intake_date)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ))}

      {unassigned.length > 0 && (
        <div className="section">
          <div className="section-head">
            <div className="sh-left"><span className="sh-dot" /><span>No Case Manager Assigned</span></div>
            <span style={{ fontFamily: 'var(--mono)', fontSize: '.78rem', color: '#94a3b8' }}>{unassigned.length}</span>
          </div>
          <div className="section-body" style={{ padding: 0 }}>
            <div className="roster-wrap">
              <table>
                <thead>
                  <tr><th>Rm</th><th>Name</th><th>Status</th><th>Phone</th><th>Intake</th></tr>
                </thead>
                <tbody>
                  {unassigned.map(c => {
                    const cur = statuses[c.id] || 'building'
                    const opt = STATUS_OPTS.find(o => o.v === cur) || { l: cur, c: '' }
                    return (
                      <tr key={c.id}>
                        <td className="rm">{c.room}</td>
                        <td className="name-cell">{c.name}</td>
                        <td><span className={`ss ${opt.c}`} style={{ display: 'inline-block', pointerEvents: 'none' }}>{opt.l}</span></td>
                        <td style={{ fontFamily: 'var(--mono)', fontSize: '.78rem' }}>{formatPhone(c.phone)}</td>
                        <td className="date-cell">{fmtDate(c.intake_date)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
