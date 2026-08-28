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
import ConsentTab    from './tabs/ConsentTab.jsx'
import GroupsTab     from './tabs/GroupsTab.jsx'
import DashboardHome  from './DashboardHome.jsx'

const ALL_TABS = [
  { id: 'report',     label: 'Report' },
  { id: 'archive',    label: 'Archive' },
  { id: 'clients',    label: 'Clients' },
  { id: 'staff',      label: 'Staff' },
  { id: 'chores',     label: 'Chores' },
  { id: 'groups',     label: 'Groups',  perm: 'groups.view' },
  { id: 'passes',     label: 'Passes' },
  { id: 'caseloads',  label: 'Caseloads' },
  { id: 'mail',       label: 'Mail' },
  { id: 'ua',         label: 'UA' },
  { id: 'violations', label: 'Infractions' },
  { id: 'consent',    label: 'Consents',   perm: 'consent.manage' },
]

// ── Dashboard ─────────────────────────────────────────────────────────
export default function Dashboard() {
  const { activeTab, setActiveTab, requestedTab, clearRequestedTab, globalSearch = '' } = useOutletContext() || {}
  const { hasPerm }  = usePermission()
  const { loading, data } = useData()

  // UI visibility settings from server
  const uiVis = useMemo(() => {
    const def = { tabs: {}, buttons: {} }
    if (!data?.ui_visibility) return def
    try { return typeof data.ui_visibility === 'string' ? JSON.parse(data.ui_visibility) : data.ui_visibility }
    catch { return def }
  }, [data])

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
      <div className="flex-1 p-6 overflow-y-auto">
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6 shadow-sm">
          <div className="h-6 mb-2.5 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          <div className="h-6 mb-2.5 w-3/5 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          <div className="h-6 w-4/5 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        </div>
      </div>
    )
  }

  const currentTab = activeTab || 'dashboard'
  if (currentTab === 'dashboard') {
    return <DashboardHome onNavigate={setActiveTab} globalSearch={globalSearch} />
  }
  const active = visibleTabs.find(t => t.id === currentTab) || visibleTabs[0]

  return (
    <div className="flex-1 p-6 overflow-y-auto" role="main">
      {active?.id === 'report'     && <ReportTab onNavigate={setActiveTab} />}
      {active?.id === 'archive'    && <ArchiveTab />}
      {active?.id === 'clients'    && <ClientsTab />}
      {active?.id === 'staff'      && <StaffTab />}
      {active?.id === 'chores'     && <ChoresTab />}
      {active?.id === 'passes'     && <PassesTab />}
      {active?.id === 'caseloads'  && <CaseloadsTab />}
      {active?.id === 'mail'       && <MailTab />}
      {active?.id === 'ua'         && <UARequestsTab />}
      {active?.id === 'violations' && <ViolationsTab />}
      {active?.id === 'consent'    && <ConsentTab />}
      {active?.id === 'groups'     && <GroupsTab />}
    </div>
  )
}
