import { useState } from 'react'

// Reusable print-scope picker. Two modes:
//   - 'shift'  : print only the currently-active report
//   - 'range'  : print entries between start/end dates (inclusive, ISO yyyy-mm-dd)
//
// onConfirm receives { mode, startDate, endDate }.
export default function PrintScopeModal({
  open,
  title = 'Print Report',
  defaultMode = 'shift',
  shiftLabel = 'This shift',
  onClose,
  onConfirm,
}) {
  const today = new Date().toLocaleDateString('en-CA')
  const weekAgo = new Date(Date.now() - 6 * 86400000).toLocaleDateString('en-CA')
  const [mode, setMode]           = useState(defaultMode)
  const [startDate, setStartDate] = useState(weekAgo)
  const [endDate, setEndDate]     = useState(today)

  if (!open) return null

  function confirm() {
    if (mode === 'range') {
      if (!startDate || !endDate) return
      if (startDate > endDate) { alert('Start date must be on or before end date.'); return }
    }
    onConfirm({ mode, startDate, endDate })
  }

  return (
    <div className="modal-overlay open" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 440 }}>
        <div className="modal-head">
          <h2>🖨 {title}</h2>
          <button className="xbtn" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Scope</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button type="button" onClick={() => setMode('shift')} style={btnStyle(mode === 'shift')}>
                📋 {shiftLabel}
              </button>
              <button type="button" onClick={() => setMode('range')} style={btnStyle(mode === 'range')}>
                📅 Date range
              </button>
            </div>
          </div>

          {mode === 'range' && (
            <div className="field" style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <label>Start date</label>
                <input type="date" value={startDate} max={endDate || today}
                  onChange={e => setStartDate(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label>End date</label>
                <input type="date" value={endDate} min={startDate} max={today}
                  onChange={e => setEndDate(e.target.value)} />
              </div>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn-cancel" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={confirm}>Print</button>
        </div>
      </div>
    </div>
  )
}

function btnStyle(active) {
  return {
    flex: 1, padding: '10px 0', borderRadius: 8, cursor: 'pointer',
    fontSize: '.85rem', fontWeight: 700,
    border: `2px solid ${active ? 'var(--crimson)' : 'var(--line)'}`,
    background: active ? 'var(--crimson)' : 'transparent',
    color: active ? '#fff' : 'var(--steel)',
    transition: 'all .12s',
  }
}
