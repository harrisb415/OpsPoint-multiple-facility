/* OpsPoint UI Kit — interactive demo app wiring everything together */
const { useState, useCallback } = React;
const D = window.OP_DATA;

function genUADraw(residents, statuses) {
  const eligible = residents.filter(r => r.name !== 'VACANT' && (statuses[r.id] || 'building') === 'building');
  const n = Math.min(3, eligible.length);
  const pool = [...eligible];
  const picks = [];
  for (let i = 0; i < n; i++) picks.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return picks;
}

function App() {
  const [authed, setAuthed] = useState(false);
  const [active, setActive] = useState('report');
  const [statuses, setStatuses] = useState(() => {
    const m = {}; D.residents.forEach(r => { m[r.id] = r.status; }); return m;
  });
  const [log, setLog] = useState(D.log);
  const [issues, setIssues] = useState(D.issues);
  const [medNotes, setMedNotes] = useState(D.medNotes);
  const [saveState, setSaveState] = useState('saved');
  const [modal, setModal] = useState(null);   // {kind, ...}
  const [draw, setDraw] = useState(null);
  const [toast, setToast] = useState(null);

  const flashSaved = useCallback(() => {
    setSaveState('saving');
    setTimeout(() => setSaveState('saved'), 500);
  }, []);

  const setStatus = (id, v) => { setStatuses(s => ({ ...s, [id]: v })); flashSaved(); };

  const addLog = (time, text, type) => {
    const t = type || classify(text);
    setLog(l => [...l, { id: Date.now(), time: time ? to12(time) : nowTime(), type: t, text }]);
    flashSaved();
  };
  function to12(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
  }
  function classify(text) {
    const t = text.toLowerCase();
    if (t.includes('wellness') || t.includes('accounted')) return 'Wellness';
    if (t.includes('walkthrough') || t.includes('walk through')) return 'Walkthrough';
    if (t.includes('ua') || t.includes('urinaly')) return 'UA';
    if (t.includes('mail') || t.includes('package')) return 'Mail';
    if (t.includes('search')) return 'Room Search';
    if (t.includes('violation') || t.includes('contraband')) return 'Violation';
    return 'Note';
  }

  const quick = (kind) => {
    const map = {
      wellness: { type: 'Wellness', text: `Wellness check conducted by ${D.pa}. All residents accounted for.` },
      walk:     { type: 'Walkthrough', text: 'Building walkthrough — all areas clear. Nothing to report.' },
    };
    if (map[kind]) { addLog('', map[kind].text, map[kind].type); showToast('Entry logged'); return; }
    setModal({ kind });
  };

  function showToast(msg) { setToast(msg); setTimeout(() => setToast(null), 1800); }

  if (!authed) return <Login onLogin={() => setAuthed(true)} />;

  return (
    <div className="app-shell">
      <Header facility={D.facility} saveState={saveState} notifCount={issues.length}
        onBell={() => setModal({ kind: 'notif' })} />
      <div className="app-body">
        <Sidebar active={active} onNavigate={setActive} user={D.user}
          onDraw={() => { setDraw(genUADraw(D.residents, statuses)); setModal({ kind: 'uadraw' }); }} />
        <main className="app-content">
          <div className="container">
            {active === 'report'
              ? <ReportScreen statuses={statuses} setStatus={setStatus} log={log} addLog={addLog}
                  issues={issues} setIssues={setIssues} medNotes={medNotes} setMedNotes={setMedNotes}
                  onQuick={quick} onPrint={() => setModal({ kind: 'print' })} />
              : <Placeholder id={active} />}
          </div>
        </main>
      </div>

      {modal?.kind === 'uadraw' && (
        <Modal title="Random UA Draw" onClose={() => setModal(null)} width={440}
          footer={<>
            <button className="btn btn-secondary" onClick={() => setDraw(genUADraw(D.residents, statuses))}>↻ Redraw</button>
            <button className="btn btn-primary" onClick={() => {
              draw.forEach(r => addLog('', `Rm ${r.room} ${r.name} — selected for random UA draw.`, 'UA'));
              setModal(null); showToast(`${draw.length} residents logged for UA`);
            }}>Log {draw?.length} to Report</button>
          </>}>
          <p style={{ fontSize: 13, color: 'var(--ink-500)', marginBottom: 4 }}>
            Randomly selected from residents currently <strong style={{ color: 'var(--st-building-fg)' }}>In Building</strong>:
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {draw?.map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 14px', background: 'var(--gold-50)', border: '1px solid var(--gold-200)', borderRadius: 'var(--r-md)' }}>
                <span className="icon-chip"><Icon name="flask" size={16} /></span>
                <div><div style={{ fontWeight: 700 }}>{r.name}</div><div style={{ fontSize: 12, color: 'var(--ink-500)', fontFamily: 'var(--font-mono)' }}>Rm {r.room} · last UA {r.lastUA}</div></div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {modal?.kind && ['ua','roomsearch','mail','violation'].includes(modal.kind) && (
        <QuickModal kind={modal.kind} residents={D.residents} onClose={() => setModal(null)}
          onSubmit={(text, type) => { addLog('', text, type); setModal(null); showToast('Entry logged'); }} />
      )}

      {modal?.kind === 'notif' && (
        <Modal title="Notifications" onClose={() => setModal(null)} width={420}>
          {issues.length === 0 && <div style={{ color: 'var(--ink-400)' }}>No open items.</div>}
          {issues.map((v, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: i < issues.length-1 ? '1px solid var(--line-2)' : 'none' }}>
              <span style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 1 }}><Icon name="alertTriangle" size={16} /></span>
              <span style={{ fontSize: 13, lineHeight: 1.5 }}>{v}</span>
            </div>
          ))}
        </Modal>
      )}

      {modal?.kind === 'print' && (
        <Modal title="Export Shift Report" onClose={() => setModal(null)} width={420}
          footer={<>
            <button className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={() => { setModal(null); showToast('Report exported to PDF'); }}>
              <Icon name="printer" size={15} /> Export PDF
            </button>
          </>}>
          <p style={{ fontSize: 13, color: 'var(--ink-700)', lineHeight: 1.6 }}>
            Generate the <strong>{D.shift}</strong> report for <strong>{D.facility}</strong> — {D.date}.
            Includes census, full roster, activity log ({log.length} entries), issues &amp; medication notes.
          </p>
          <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
            <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 13 }}><input type="checkbox" defaultChecked /> Include resident names</label>
            <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 13 }}><input type="checkbox" defaultChecked /> Sign &amp; lock</label>
          </div>
        </Modal>
      )}

      {toast && <div className="toast"><Icon name="check" size={15} />{toast}</div>}
    </div>
  );
}

function ReportScreen({ statuses, setStatus, log, addLog, issues, setIssues, medNotes, setMedNotes, onQuick, onPrint }) {
  return (
    <>
      <div className="report-hero">
        <div>
          <div className="eyebrow-on-dark">Daily Ops · Shift Report #2</div>
          <div className="hero-title">{D.shift} Report</div>
          <div className="hero-date">{D.date} · {D.shiftRange} · {D.facility}</div>
        </div>
        <div className="hero-actions">
          <button className="btn btn-on-teal" onClick={onPrint}><Icon name="printer" size={15} /> Export</button>
          <button className="btn btn-on-teal-danger">Close Shift</button>
          <button className="btn btn-primary"><Icon name="plus" size={15} /> New Report</button>
        </div>
      </div>

      <ShiftDetails />
      <ReminderBar />
      <Census residents={D.residents} statuses={statuses} />
      <Roster residents={D.residents} statuses={statuses} onStatus={setStatus} />
      <ActivityLog log={log} onQuick={onQuick} onAdd={(t, txt) => addLog(t, txt)} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <ListPanel title="Issues / Incidents" items={issues} placeholder="Describe an issue…"
          onAdd={v => setIssues(x => [...x, v])} onRemove={i => setIssues(x => x.filter((_, j) => j !== i))} />
        <ListPanel title="Medication Notes" med items={medNotes} placeholder="Add a med note…"
          onAdd={v => setMedNotes(x => [...x, v])} onRemove={i => setMedNotes(x => x.filter((_, j) => j !== i))} />
      </div>
    </>
  );
}

function ShiftDetails() {
  const [date, setDate] = useState(D.date);
  const [shift, setShift] = useState('swing');
  const [mod, setMod] = useState(D.pa);
  return (
    <div className="section">
      <div className="section-head">
        <div className="sh-left"><span className="sh-dot"></span>Shift Details</div>
        <span className="sh-meta">Report #2 · open</span>
      </div>
      <div className="section-body">
        <div className="meta-grid">
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ fontFamily: 'var(--font-mono)' }} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Shift Worked</label>
            <select value={shift} onChange={e => setShift(e.target.value)}>
              <option value="morning">Morning Shift (7:00 AM – 3:00 PM)</option>
              <option value="swing">Swing Shift (3:00 PM – 11:00 PM)</option>
              <option value="overnight">Overnight Shift (11:00 PM – 7:00 AM)</option>
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Manager on Duty (MOD / PA)</label>
            <input type="text" value={mod} placeholder="Staff name…" onChange={e => setMod(e.target.value)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function ReminderBar() {
  return (
    <div className="reminder-bar">
      <div className="reminder-card ok"><Icon name="check" size={15} /><span>Wellness Check</span><span className="rtime">next 9:30 PM</span></div>
      <div className="reminder-card warn"><Icon name="clock" size={15} /><span>Walkthrough</span><span className="rtime">due in 9m</span></div>
      <div className="reminder-card ok"><Icon name="check" size={15} /><span>Med Pass</span><span className="rtime">done 6:00 PM</span></div>
    </div>
  );
}

function QuickModal({ kind, residents, onClose, onSubmit }) {
  const cfg = {
    ua:        { title: 'Log UA',          type: 'UA',          tmpl: r => `Rm ${r.room} ${r.name} — UA collected, witnessed. Sent to lab.` },
    roomsearch:{ title: 'Log Room Search', type: 'Room Search', tmpl: r => `Rm ${r.room} ${r.name} — room search conducted. No contraband found.` },
    mail:      { title: 'Log Mail',        type: 'Mail',        tmpl: r => `Rm ${r.room} ${r.name} — package logged, pending supervisor approval.` },
    violation: { title: 'Log Violation',   type: 'Violation',   tmpl: r => `Rm ${r.room} ${r.name} — rule violation observed. Incident report to follow.` },
  }[kind];
  const live = residents.filter(r => r.name !== 'VACANT');
  const [rid, setRid] = useState(live[0].id);
  const [note, setNote] = useState('');
  const r = live.find(x => x.id === Number(rid));
  return (
    <Modal title={cfg.title} onClose={onClose} width={460}
      footer={<>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onSubmit((note.trim() || cfg.tmpl(r)), cfg.type)}>Log Entry</button>
      </>}>
      <div className="field">
        <label>Resident</label>
        <select value={rid} onChange={e => setRid(e.target.value)}>
          {live.map(x => <option key={x.id} value={x.id}>Rm {x.room} · {x.name}</option>)}
        </select>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Note (optional)</label>
        <textarea rows={3} value={note} placeholder={cfg.tmpl(r)} onChange={e => setNote(e.target.value)} />
      </div>
    </Modal>
  );
}

function Placeholder({ id }) {
  const labels = {};
  D.sidebar.forEach(g => g.items.forEach(it => { labels[it.id] = it.label; }));
  return (
    <div className="empty-state">
      <span className="icon-chip" style={{ width: 48, height: 48, margin: '0 auto 14px', display: 'flex' }}><Icon name="archive" size={22} /></span>
      <h2>{labels[id] || id}</h2>
      <p style={{ fontSize: 13 }}>This module is part of OpsPoint but isn't built out in this UI kit.<br />The <strong>Report</strong> screen demonstrates the full component system.</p>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
