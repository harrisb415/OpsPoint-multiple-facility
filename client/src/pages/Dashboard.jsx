import { useEffect, useMemo } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useData } from '../contexts/DataContext.jsx'
import { usePermission } from '../hooks/usePermission.js'
import ReportTab from './ReportTab.jsx'
import ArchiveTab from './tabs/ArchiveTab.jsx'
import ClientsTab from './tabs/ClientsTab.jsx'
import StaffTab from './tabs/StaffTab.jsx'
import ChoresTab from './tabs/ChoresTab.jsx'
import PassesTab from './tabs/PassesTab.jsx'
import CaseloadsTab from './tabs/CaseloadsTab.jsx'
import MailTab from './tabs/MailTab.jsx'
import UARequestsTab from './tabs/UARequestsTab.jsx'
import ViolationsTab from './tabs/ViolationsTab.jsx'
import MedLogTab     from './tabs/MedLogTab.jsx'
import MilestonesTab from './tabs/MilestonesTab.jsx'
import IncidentsTab  from './tabs/IncidentsTab.jsx'
import ConsentTab    from './tabs/ConsentTab.jsx'

const ALL_TABS = [
  { id: 'report',     label: 'Report' },
  { id: 'archive',    label: 'Archive' },
  { id: 'clients',    label: 'Clients' },
  { id: 'staff',      label: 'Staff' },
  { id: 'chores',     label: 'Chores' },
  { id: 'passes',     label: 'Passes' },
  { id: 'caseloads',  label: 'Caseloads' },
  { id: 'mail',       label: 'Mail' },
  { id: 'ua',         label: 'UA' },
  { id: 'med_log',    label: 'Med Log',    perm: 'med.witness' },
  { id: 'milestones', label: 'Milestones', perms: ['milestones.edit','milestones.signoff'] },
  { id: 'incidents',  label: 'Incidents',  perms: ['incidents.log','incidents.review'] },
  { id: 'violations', label: 'Violations' },
  { id: 'consent',    label: 'Consents',   perm: 'consent.manage' },
]

// ── Dashboard ─────────────────────────────────────────────────────────
export default function Dashboard() {
  const { activeTab, setActiveTab, requestedTab, clearRequestedTab } = useOutletContext() || {}
  const { hasPerm }  = usePermission()
  const { loading, data } = useData()

  // UI visibility settings from server
  const uiVis = useMemo(() => {
    const def = { tabs: {}, buttons: {} }
    if (!data?.ui_visibility) return def
    try { return typeof data.ui_visibility === 'string' ? JSON.parse(data.ui_visibility) : data.ui_visibility }
    catch { return def }
  }, [data?.ui_visibility])

  // Handle cross-component tab navigation (e.g. from notification panel "View violations")
  useEffect(() => {
    if (requestedTab) { setActiveTab(requestedTab); clearRequestedTab() }
  }, [requestedTab, clearRequestedTab, setActiveTab])

  function isTabVisible(id) {
    if (uiVis.tabs && Object.keys(uiVis.tabs).length > 0) {
      if (uiVis.tabs[id] === false) return false
    }
    return true
  }

  const visibleTabs = ALL_TABS.filter(t => {
    if (t.perm  && !hasPerm(t.perm)) return false
    if (t.perms && !t.perms.some(p => hasPerm(p))) return false
    if (!isTabVisible(t.id)) return false
    return true
  })

  if (loading) {
    return (
      <div className="container">
        <div className="card" style={{ padding: 24 }}>
          <div className="skeleton-block" style={{ height: 24, marginBottom: 10 }} />
          <div className="skeleton-block" style={{ height: 24, width: '60%', marginBottom: 10 }} />
          <div className="skeleton-block" style={{ height: 24, width: '80%' }} />
        </div>
      </div>
    )
  }

  const currentTab = activeTab || 'report'
  const active = visibleTabs.find(t => t.id === currentTab) || visibleTabs[0]

  return (
    <div className="container" role="main">
      {active?.id === 'report'     && <ReportTab onNavigate={setActiveTab} />}
      {active?.id === 'archive'    && <ArchiveTab />}
      {active?.id === 'clients'    && <ClientsTab />}
      {active?.id === 'staff'      && <StaffTab />}
      {active?.id === 'chores'     && <ChoresTab />}
      {active?.id === 'passes'     && <PassesTab />}
      {active?.id === 'caseloads'  && <CaseloadsTab />}
      {active?.id === 'mail'       && <MailTab />}
      {active?.id === 'ua'         && <UARequestsTab />}
      {active?.id === 'med_log'    && <MedLogTab />}
      {active?.id === 'milestones' && <MilestonesTab />}
      {active?.id === 'incidents'  && <IncidentsTab />}
      {active?.id === 'violations' && <ViolationsTab />}
      {active?.id === 'consent'    && <ConsentTab />}
    </div>
  )
}
