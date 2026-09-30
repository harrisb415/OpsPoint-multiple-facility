import { useState } from 'react'
import { Button, TextInput } from 'flowbite-react'
import { Check, Copy } from 'lucide-react'
import QrCode from './QrCode.jsx'

// An invite link to hand to one person: its QR code to scan from a phone, the
// link to copy into a message, and when it stops working. Used by the setup
// wizard's staff step and by Admin › Users.
export default function InviteLink({ name, link, expiresAt }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000) }
    catch { /* clipboard blocked: the field below can still be selected */ }
  }
  const until = expiresAt ? new Date(expiresAt).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : null
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
      <QrCode text={link} label={`Invite link for ${name}`} className="w-40 h-40 shrink-0" />
      <div className="w-full min-w-0 space-y-2">
        <p className="text-sm text-gray-700 dark:text-gray-300">
          <span className="font-semibold text-gray-900 dark:text-white">{name}</span> scans this, or opens the link, and sets their own password.
          {until && <> It works once, until {until}.</>}
        </p>
        <div className="flex gap-2">
          <TextInput readOnly value={link} sizing="sm" className="flex-1 min-w-0 font-mono" onFocus={(e) => e.target.select()} aria-label="Invite link" />
          <Button size="xs" color="light" onClick={copy} aria-label="Copy the link">
            {copied ? <><Check className="w-4 h-4 mr-1" />Copied</> : <><Copy className="w-4 h-4 mr-1" />Copy</>}
          </Button>
        </div>
      </div>
    </div>
  )
}
