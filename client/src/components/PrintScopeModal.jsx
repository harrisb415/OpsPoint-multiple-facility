import { useState } from 'react'
import { Button, Modal, ModalHeader, ModalBody, ModalFooter, TextInput } from 'flowbite-react'
import { Field } from './ui.jsx'

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
    <Modal show size="md" onClose={onClose}>
      <ModalHeader>🖨 {title}</ModalHeader>
      <ModalBody>
        <div className="space-y-4">
          <Field label="Scope">
            <div className="flex gap-2">
              <Button type="button" className="flex-1" color={mode === 'shift' ? 'default' : 'light'} onClick={() => setMode('shift')}>📋 {shiftLabel}</Button>
              <Button type="button" className="flex-1" color={mode === 'range' ? 'default' : 'light'} onClick={() => setMode('range')}>📅 Date range</Button>
            </div>
          </Field>
          {mode === 'range' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start date"><TextInput type="date" value={startDate} max={endDate || today} onChange={e => setStartDate(e.target.value)} /></Field>
              <Field label="End date"><TextInput type="date" value={endDate} min={startDate} max={today} onChange={e => setEndDate(e.target.value)} /></Field>
            </div>
          )}
        </div>
      </ModalBody>
      <ModalFooter className="justify-end">
        <Button color="light" onClick={onClose}>Cancel</Button>
        <Button onClick={confirm}>Print</Button>
      </ModalFooter>
    </Modal>
  )
}
