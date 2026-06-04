/* OpsPoint UI Kit — mock data (fictional). A residential-facility shift. */
window.OP_DATA = {
  facility: 'Cedar House',
  user: { name: 'Dani Okonkwo', role: 'supervisor', initials: 'DO' },
  shift: 'Swing Shift',
  shiftRange: '3:00 PM – 11:00 PM',
  date: '2026-05-28',
  pa: 'D. Okonkwo',

  // status keys: building | work | pass | bhc | efc | hospital | out | vacant
  residents: [
    { id: 1,  room: '201', name: 'Marcus Bell',        cm: 'R. Vance',   status: 'building', lastUA: 'May 12', lastRS: 'May 09' },
    { id: 2,  room: '202', name: 'Andre Coleman',      cm: 'R. Vance',   status: 'work',     lastUA: 'May 21', lastRS: 'May 14' },
    { id: 3,  room: '203', name: 'Tobias Reyes',       cm: 'P. Singh',   status: 'building', lastUA: 'May 02', lastRS: 'Apr 28' },
    { id: 4,  room: '204', name: 'VACANT',             cm: '',           status: 'vacant',   lastUA: '',       lastRS: '' },
    { id: 5,  room: '205', name: 'Devon Pierce',       cm: 'P. Singh',   status: 'pass',     lastUA: 'May 18', lastRS: 'May 10' },
    { id: 6,  room: '206', name: 'Liang Chen',         cm: 'R. Vance',   status: 'building', lastUA: 'May 25', lastRS: 'May 19' },
    { id: 7,  room: '207', name: 'Samuel Ortiz',       cm: 'A. Brooks',  status: 'bhc',      lastUA: 'May 07', lastRS: 'May 01' },
    { id: 8,  room: '208', name: 'Jerome Washington',  cm: 'A. Brooks',  status: 'building', lastUA: 'May 15', lastRS: 'May 12' },
    { id: 9,  room: '209', name: 'Kofi Mensah',        cm: 'P. Singh',   status: 'work',     lastUA: 'May 22', lastRS: 'May 16' },
    { id: 10, room: '210', name: 'Ethan Caldwell',     cm: 'R. Vance',   status: 'building', lastUA: 'May 04', lastRS: 'Apr 30' },
    { id: 11, room: '211', name: 'Hector Alvarez',     cm: 'A. Brooks',  status: 'hospital', lastUA: 'May 11', lastRS: 'May 06' },
    { id: 12, room: '212', name: 'Brandon Fisher',     cm: 'P. Singh',   status: 'building', lastUA: 'May 19', lastRS: 'May 13' },
    { id: 13, room: '213', name: 'Isaiah Grant',       cm: 'R. Vance',   status: 'building', lastUA: 'May 08', lastRS: 'May 03' },
    { id: 14, room: '214', name: 'Malik Johnson',      cm: 'A. Brooks',  status: 'building', lastUA: 'May 24', lastRS: 'May 20' },
    { id: 15, room: '215', name: 'Quentin Vance',      cm: 'P. Singh',   status: 'efc',      lastUA: 'May 16', lastRS: 'May 11' },
    { id: 16, room: '216', name: 'Nathaniel Cruz',     cm: 'R. Vance',   status: 'out',      lastUA: 'May 20', lastRS: 'May 15' },
    { id: 17, room: '217', name: 'Owen Delgado',       cm: 'A. Brooks',  status: 'building', lastUA: 'May 13', lastRS: 'May 07' },
    { id: 18, room: '218', name: 'VACANT',             cm: '',           status: 'vacant',   lastUA: '',       lastRS: '' },
  ],

  log: [
    { id: 1, time: '3:10 PM',  type: 'Note',        text: 'Shift change. Count verified — 16 residents, 2 vacant rooms.' },
    { id: 2, time: '4:30 PM',  type: 'Wellness',    text: 'Wellness check conducted by D. Okonkwo. All 16 accounted for.' },
    { id: 3, time: '5:45 PM',  type: 'Walkthrough', text: 'Building walkthrough — all areas clear. Nothing to report.' },
    { id: 4, time: '6:20 PM',  type: 'Mail',        text: 'Rm 209 K. Mensah — package logged, pending supervisor approval.' },
    { id: 5, time: '7:55 PM',  type: 'UA',          text: 'Rm 214 M. Johnson — UA collected, witnessed. Panel: ETG, THC, AMP. Sent to lab.' },
    { id: 6, time: '8:30 PM',  type: 'Wellness',    text: 'Wellness check conducted by R. Vance. 15 of 16 accounted for. Not located: Rm 216 N. Cruz (signed out — Other).' },
  ],

  issues: [
    'Rm 211 H. Alvarez transported to St. Luke\u2019s ER 4:15 PM for chest pain — case manager A. Brooks notified.',
    'Laundry room dryer #2 out of service — work order submitted to maintenance.',
  ],
  medNotes: [
    'Rm 207 S. Ortiz — missed 6:00 PM medication window, will administer with nurse at 9:00 PM per protocol.',
  ],

  logTypeStyle: {
    Wellness:      { bg: 'var(--st-building-bg)', color: 'var(--st-building-fg)' },
    Walkthrough:   { bg: 'var(--teal-100)',       color: 'var(--teal-700)' },
    UA:            { bg: 'var(--st-pass-bg)',      color: 'var(--st-pass-fg)' },
    Mail:          { bg: 'var(--st-work-bg)',      color: 'var(--st-work-fg)' },
    'Room Search': { bg: 'var(--st-bhc-bg)',       color: 'var(--st-bhc-fg)' },
    Violation:     { bg: 'var(--danger-bg)',       color: 'var(--danger)' },
    Note:          { bg: 'var(--st-vacant-bg)',    color: 'var(--ink-500)' },
  },

  statusOpts: [
    { v: 'building', l: 'In Building', c: 's-building' },
    { v: 'work',     l: 'Work',         c: 's-work' },
    { v: 'pass',     l: 'Weekend Pass', c: 's-pass' },
    { v: 'out',      l: 'Out / Other',  c: 's-out' },
    { v: 'bhc',      l: 'BHC',          c: 's-bhc' },
    { v: 'efc',      l: 'EFC',          c: 's-efc' },
    { v: 'hospital', l: 'Hospital',     c: 's-hospital' },
  ],

  sidebar: [
    { label: 'PEOPLE',    items: [
      { id: 'clients',   label: 'Clients',    icon: 'users' },
      { id: 'staff',     label: 'Staff',      icon: 'userCheck' },
      { id: 'caseloads', label: 'Caseloads',  icon: 'clipboardList' },
    ]},
    { label: 'DAILY OPS', items: [
      { id: 'report',    label: 'Report',     icon: 'fileText' },
      { id: 'chores',    label: 'Chores',     icon: 'checkSquare' },
      { id: 'passes',    label: 'Passes',     icon: 'ticket' },
      { id: 'mail',      label: 'Mail',       icon: 'mail' },
    ]},
    { label: 'HEALTH & COMPLIANCE', items: [
      { id: 'ua',         label: 'UA',         icon: 'flask' },
      { id: 'med_log',    label: 'Med Log',    icon: 'pill' },
      { id: 'milestones', label: 'Milestones', icon: 'award' },
    ]},
    { label: 'RECORDS',  items: [
      { id: 'incidents',  label: 'Incidents',  icon: 'alertTriangle' },
      { id: 'violations', label: 'Violations', icon: 'ban' },
      { id: 'consent',    label: 'Consents',   icon: 'penLine' },
      { id: 'archive',    label: 'Archive',    icon: 'archive' },
    ]},
  ],
};
