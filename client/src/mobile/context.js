import { createContext, useContext } from 'react'

// { snap, reload, patchSnap, live, session, hasPerm, toast, flags, installPrompt,
//   outbox, box, offline } — provided by MobileApp.jsx. snap has the entries
// waiting in the outbox laid over it; box is the outbox's state.
export const MobileCtx = createContext(null)
export const useMobile = () => useContext(MobileCtx)
