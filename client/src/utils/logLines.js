// Shift-log lines: which ones are UA results, and the note a voided UA result
// carries in every view — the Report tab, print, the Word export, the phone.
// UA results are never deleted, only voided with a reason.

export const isUALine = (e) => /\s—\sUA:/i.test((e && e.text) || '')

export function voidNote(x) {
  if (!x || !x.voided_at) return ''
  return `VOIDED${x.voided_by_name ? ` by ${x.voided_by_name}` : ''}: ${x.void_reason || 'no reason given'}`
}

// The line's text as printed or exported: the original words, then the note.
export const lineText = (e) => (e && e.voided_at ? `${e.text || ''} [${voidNote(e)}]` : (e && e.text) || '')
