import { createContext, useContext } from 'react'

// { snap, reload, patchSnap, live, session, hasPerm, toast, flags, installPrompt }
// — provided by MobileApp.jsx.
export const MobileCtx = createContext(null)
export const useMobile = () => useContext(MobileCtx)
