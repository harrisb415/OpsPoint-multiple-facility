import { useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { Users, UserCheck, UserX, Calendar } from 'lucide-react'
import { useData } from '../../contexts/DataContext.jsx'
import { CARD, Header, Kpi, KpiRow, Board, BoardCard } from '../../components/console.jsx'

const STATUS_LABEL = {
  building: 'In Building', work: 'Work', pass: 'Weekend Pass',
  out: 'Out / Other', bhc: 'BHC', efc: 'EFC', hospital: 'Hospital',
}
const STATUS_TONE = {
  building: 'green', work: 'sky', pass: 'yellow',
  out: 'gray', bhc: 'purple', efc: 'purple', hospital: 'red',
}
const COL_ACCENT = ['primary', 'sky', 'green', 'purple', 'yellow', 'red']

function fmtDate(d) {
  if (!d) return '—'
  try { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}

function formatPhone(raw) {
  if (!raw) return ''
  const d = String(raw).replace(/\D/g, '').replace(/^1(\d{10})$/, '$1')
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`
  return raw
}

export default function CaseloadsTab() {
  const { data } = useData()
  const clients = data?.clients || []
  const reports = data?.reports || []
  const activeId = data?.active_report_id
  const { globalSearch = '' } = useOutletContext() || {}

  const activeReport = reports.find(r => r.id === activeId)
  const statuses = activeReport?.statuses || {}

  const match = c => {
    const q = globalSearch.trim().toLowerCase()
    return !q || `${c.name} ${c.room} ${c.case_manager || ''}`.toLowerCase().includes(q)
  }

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

  const assignedTotal = grouped.reduce((n, [, list]) => n + list.length, 0)

  const card = c => {
    const cur = statuses[c.id] || 'building'
    const phone = formatPhone(c.phone)
    return (
      <BoardCard
        key={c.id}
        title={c.name}
        badge={{ tone: STATUS_TONE[cur] || 'gray', label: STATUS_LABEL[cur] || cur }}
        sub={`Rm ${c.room}${phone ? ' · ' + phone : ''}`}
        meta={c.intake_date ? `Intake ${fmtDate(c.intake_date)}` : undefined}
        metaIcon={Calendar}
      />
    )
  }

  const columns = grouped.map(([cm, list], i) => {
    const visible = list.filter(match)
    return {
      Icon: Users,
      title: cm,
      accent: COL_ACCENT[i % COL_ACCENT.length],
      count: list.length,
      cards: visible.map(card),
      empty: 'No matches',
    }
  })
  if (unassigned.length > 0) {
    columns.push({
      Icon: UserX,
      title: 'No Case Manager',
      accent: 'gray',
      count: unassigned.length,
      cards: unassigned.filter(match).map(card),
      empty: 'No matches',
    })
  }

  return (
    <div>
      <Header
        crumb={['People', 'Caseloads']}
        title="Caseloads"
        sub="Active residents grouped by case manager"
      />

      <KpiRow>
        <Kpi label="Case Managers" value={grouped.length} sub="with assignments" Icon={UserCheck} accent="primary" />
        <Kpi label="Assigned" value={assignedTotal} sub="residents on a caseload" Icon={Users} accent="green" />
        <Kpi label="Unassigned" value={unassigned.length} sub="no case manager" Icon={UserX} accent="yellow" />
      </KpiRow>

      {columns.length === 0
        ? <div className={`${CARD} p-8 text-sm text-center text-gray-400`}>No active residents with case managers assigned.</div>
        : <Board columns={columns} />}
    </div>
  )
}
