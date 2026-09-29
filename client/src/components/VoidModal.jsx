import { useState } from 'react'
import { Alert, Button, Modal, ModalBody, ModalFooter, ModalHeader, Textarea } from 'flowbite-react'

// Void a UA result. Nothing deletes one, so the reason is required and stays
// on file with the name and time. onVoid(reason) resolves, or throws an Error
// whose message is shown.
export default function VoidModal({ subject, onClose, onVoid }) {
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!reason.trim()) { setErr('Say why it is being voided.'); return }
    setBusy(true); setErr('')
    try {
      await onVoid(reason.trim())
    } catch (e) {
      setErr(e.message || 'Could not void it.')
      setBusy(false)
      return
    }
    onClose()
  }

  return (
    <Modal show size="md" onClose={onClose}>
      <ModalHeader>Void this UA result?</ModalHeader>
      <ModalBody>
        <div className="space-y-3">
          {subject && <p className="text-sm font-medium text-gray-900 dark:text-white">{subject}</p>}
          <p className="text-sm text-gray-600 dark:text-gray-400">
            UA results are never deleted. This one stays on file, marked void, with your name, the time and this reason.
          </p>
          {err && <Alert color="failure">{err}</Alert>}
          <Textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} autoFocus
            placeholder="Reason (required), e.g. entered for the wrong resident" />
        </div>
      </ModalBody>
      <ModalFooter className="justify-end">
        <Button color="light" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button color="failure" onClick={submit} isProcessing={busy} disabled={busy || !reason.trim()}>Void</Button>
      </ModalFooter>
    </Modal>
  )
}
