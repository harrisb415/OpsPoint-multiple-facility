/* OpsPoint UI Kit — Report screen + census, roster, activity log, modals */

const STATUS_LABEL = { building:'In Building', work:'Work', pass:'Pass', bhc:'BHC', efc:'EFC', hospital:'Hospital', out:'Out / Other', vacant:'Vacant' };

function nowTime() {
  const d = new Date(); const h = d.getHours(), m = String(d.getMinutes()).padStart(2,'0');
  return `${h % 12 || 12}:${m} ${h >= 12 ? 'PM' : 'AM'}`;
}

/* ── Census ────────────────────────────────────────────────────────── */
function Census({ residents, statuses }) {
  const cnt = { building:0, work:0, pass:0, bhc:0, efc:0, hospital:0, out:0 };
  residents.forEach(r => {
    if (r.name === 'VACANT') return;
    const s = statuses[r.id] || 'building';
    if (cnt[s] != null) cnt[s]++;
  });
  const total = Object.values(cnt).reduce((a,b) => a+b, 0);
  const cells = [
    ['building','In Building'], ['work','Work'], ['pass','Pass'],
    ['bhc','BHC'], ['efc','EFC'], ['hospital','Hospital'], ['out','Out / Other'],
  ];
  return (
    <div className="section">
      <div className="section-head"><div className="sh-left"><span className="sh-dot"></span>Census</div><span className="sh-meta">{total} residents</span></div>
      <div className="section-body">
        <div className="census-grid">
          {cells.map(([k,l]) => (
            <div key={k} className="census-card"><div className="count">{cnt[k]}</div><div className="clabel">{l}</div></div>
          ))}
          <div className="census-card hi"><div className="count">{total}</div><div className="clabel">Total</div></div>
        </div>
      </div>
    </div>
  );
}

/* ── Activity log ──────────────────────────────────────────────────── */
function ActivityLog({ log, onQuick, onAdd }) {
  const [time, setTime] = React.useState('');
  const [text, setText] = React.useState('');
  const ts = window.OP_DATA.logTypeStyle;
  function add() {
    if (!text.trim()) return;
    onAdd(time, text.trim()); setText(''); setTime('');
  }
  return (
    <div className="section">
      <div className="section-head"><div className="sh-left"><span className="sh-dot"></span>Activity Log</div><span className="sh-meta">{log.length} entries</span></div>
      <div className="section-body">
        <div className="pill-bar">
          <button className="pill pill-green" onClick={() => onQuick('wellness')}>✓ Wellness Check</button>
          <button className="pill pill-blue" onClick={() => onQuick('walk')}>⊕ Walkthrough</button>
          <button className="pill pill-yellow" onClick={() => onQuick('ua')}>🧪 UA</button>
          <button className="pill pill-slate" onClick={() => onQuick('roomsearch')}>🔎 Room Search</button>
          <button className="pill pill-slate" onClick={() => onQuick('mail')}>✉ Mail</button>
          <button className="pill pill-red" onClick={() => onQuick('violation')}>⚠ Violation</button>
        </div>
        <div className="roster-wrap" style={{ border: '1px solid var(--line)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
          <table className="log-table">
            <thead><tr><th className="log-th">Time</th><th className="log-th">Type</th><th className="log-th">Details</th></tr></thead>
            <tbody>
              {log.map(e => {
                const st = ts[e.type] || ts.Note;
                return (
                  <tr key={e.id}>
                    <td className="log-td-time">{e.time}</td>
                    <td className="log-td-type"><span className="log-type-badge" style={{ background: st.bg, color: st.color }}>{e.type}</span></td>
                    <td className="log-td-details">{e.text}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="log-add" style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input className="text-input" type="time" value={time} onChange={e => setTime(e.target.value)} style={{ width: 110, flexShrink: 0, fontFamily: 'var(--font-mono)' }} />
          <input className="text-input" type="text" value={text} placeholder="Entry text…" onChange={e => setText(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
          <button className="btn-add" onClick={add} style={{ flexShrink: 0 }}>+ Add</button>
        </div>
      </div>
    </div>
  );
}

/* ── Editable list (issues / med notes) ────────────────────────────── */
function ListPanel({ title, items, placeholder, onAdd, onRemove, med }) {
  const [val, setVal] = React.useState('');
  return (
    <div className="section">
      <div className="section-head"><div className="sh-left"><span className="sh-dot"></span>{title}</div></div>
      <div className="section-body">
        <div className="issues-list">
          {items.length === 0 && <div style={{ color: 'var(--ink-400)', fontSize: 13, padding: '2px 0' }}>None recorded.</div>}
          {items.map((v, i) => (
            <div key={i} className={`issue-item${med ? ' med' : ''}`}>
              <span className="issue-text">{v}</span>
              <button className="del-btn" onClick={() => onRemove(i)}>×</button>
            </div>
          ))}
        </div>
        <div className="issue-add">
          <input className="text-input" value={val} placeholder={placeholder} onChange={e => setVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && val.trim()) { onAdd(val.trim()); setVal(''); } }} />
          <button className="btn-add" onClick={() => { if (val.trim()) { onAdd(val.trim()); setVal(''); } }} style={{ flexShrink: 0 }}>+ Add</button>
        </div>
      </div>
    </div>
  );
}

/* ── Roster ────────────────────────────────────────────────────────── */
function Roster({ residents, statuses, onStatus }) {
  const [q, setQ] = React.useState('');
  const opts = window.OP_DATA.statusOpts;
  const rows = residents.filter(r => {
    if (!q) return true;
    const s = q.toLowerCase();
    return r.name.toLowerCase().includes(s) || String(r.room).includes(s);
  });
  return (
    <div className="section">
      <div className="section-head">
        <div className="sh-left"><span className="sh-dot"></span>Roster</div>
        <div style={{ position: 'relative' }}>
          <Icon name="search" size={13} style={{ position: 'absolute', left: 9, top: 8, color: 'var(--ink-400)' }} />
          <input className="text-input" value={q} placeholder="Search…" onChange={e => setQ(e.target.value)}
            style={{ height: 30, width: 170, paddingLeft: 28, fontSize: 12, textTransform: 'none' }} />
        </div>
      </div>
      <div className="section-body" style={{ padding: 0 }}>
        <div className="roster-wrap">
          <table>
            <thead><tr>
              <th className="tc">Rm</th><th>Name</th><th>Status</th>
              <th className="tc">Last UA</th><th className="tc">Last Room Search</th><th>Case Mgr</th>
            </tr></thead>
            <tbody>
              {rows.map(r => {
                const s = statuses[r.id] || (r.name === 'VACANT' ? 'vacant' : 'building');
                const vacant = r.name === 'VACANT';
                return (
                  <tr key={r.id}>
                    <td className="rm">{r.room}</td>
                    <td className="name-cell" style={vacant ? { color: 'var(--ink-400)', fontStyle: 'italic', fontWeight: 400 } : null}>{r.name}</td>
                    <td>
                      {vacant
                        ? <span className="ss s-vacant">Vacant</span>
                        : <select className={`ss ${opts.find(o => o.v === s)?.c || ''}`} value={s} onChange={e => onStatus(r.id, e.target.value)}>
                            {opts.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
                          </select>}
                    </td>
                    <td className="date-cell tc" style={{ textAlign: 'center' }}>{r.lastUA || '—'}</td>
                    <td className="date-cell tc" style={{ textAlign: 'center' }}>{r.lastRS || '—'}</td>
                    <td style={{ fontSize: 12, color: 'var(--ink-500)' }}>{r.cm || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ── Modal shell ───────────────────────────────────────────────────── */
function Modal({ title, children, onClose, footer, width = 480 }) {
  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: width }}>
        <div className="modal-head"><h2>{title}</h2><button className="xbtn" onClick={onClose}>×</button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

Object.assign(window, { Census, ActivityLog, ListPanel, Roster, Modal, STATUS_LABEL, nowTime });
