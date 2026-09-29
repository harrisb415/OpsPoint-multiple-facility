import ReasonModal from './ReasonModal.jsx'

// Void a UA result. Nothing deletes one, so the reason is required and stays
// on file with the name and time. onVoid(reason) resolves, or throws an Error
// whose message is shown.
export default function VoidModal({ subject, onClose, onVoid }) {
  return (
    <ReasonModal
      title="Void this UA result?"
      subject={subject}
      explain="UA results are never deleted. This one stays on file, marked void, with your name, the time and this reason."
      placeholder="Reason (required), e.g. entered for the wrong resident"
      confirmText="Void"
      onClose={onClose}
      onConfirm={onVoid}
    />
  )
}
