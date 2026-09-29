import { useState } from 'react'
import { Alert, Button, Modal, ModalBody, ModalFooter, ModalHeader, Textarea } from 'flowbite-react'

// Asks why before something is voided or deleted. The reason is required and
// goes on file with who and when: on the record for a void, in the audit log
// for both. onConfirm(reason) resolves, or throws an Error whose message is
// shown.
export default function ReasonModal({ title, subject, explain, placeholder = 'Reason (required)', confirmText = 'Void', onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!reason.trim()) { setErr('A reason is required.'); return }
    setBusy(true); setErr('')
    try {
      await onConfirm(reason.trim())
    } catch (e) {
      setErr(e.message || 'That didn’t go through.')
      setBusy(false)
      return
    }
    onClose()
  }

  return (
    <Modal show size="md" onClose={onClose}>
      <ModalHeader>{title}</ModalHeader>
      <ModalBody>
        <div className="space-y-3">
          {subject && <p className="text-sm font-medium text-gray-900 whitespace-pre-line break-words dark:text-white">{subject}</p>}
          {explain && <p className="text-sm text-gray-600 dark:text-gray-400">{explain}</p>}
          {err && <Alert color="failure">{err}</Alert>}
          <Textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} autoFocus placeholder={placeholder} />
        </div>
      </ModalBody>
      <ModalFooter className="justify-end">
        <Button color="light" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button color="failure" onClick={submit} isProcessing={busy} disabled={busy || !reason.trim()}>{confirmText}</Button>
      </ModalFooter>
    </Modal>
  )
}
