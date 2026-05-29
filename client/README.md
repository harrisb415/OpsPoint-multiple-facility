# OpsPoint — React Frontend

React 19 + Vite SPA. Built with Tailwind CSS v4 and React Router v7. Served from `client/dist/` by the Express backend.

## Commands

```bash
# Install dependencies
npm install

# Production build (output → dist/)
npm run build

# Hot-reload dev server on :5173 (proxies /api/* → https://localhost:3000)
npm run dev

# Lint
npm run lint
```

The backend must be running with TLS certs before starting the dev server — the Vite proxy target is `https://localhost:3000`.

## Structure

```
src/
  App.jsx                  ← Route tree, auth guards, mobile redirect
  index.css                ← Tailwind v4 + Clinical Teal design tokens
  contexts/
    AuthContext.jsx         ← Session state (GET /api/me)
    DataContext.jsx         ← App data, WebSocket, real-time sync
  components/
    AppShell.jsx            ← Desktop layout: header, icon sidebar, Outlet
    ClientProfile.jsx       ← Sliding profile drawer
    ConductUAModal.jsx      ← UA conduct flow
    PrintScopeModal.jsx     ← Print date range picker
    ProtectedRoute.jsx      ← Auth / permission guards
  hooks/
    usePermission.js        ← hasPerm() helper
  pages/
    Login.jsx
    ChangePassword.jsx
    Dashboard.jsx           ← Tab switcher
    Admin.jsx               ← User/permission/facility management
    Mobile.jsx              ← Standalone mobile interface
    About.jsx
    ReportTab.jsx           ← Active shift report
    tabs/                   ← One component per Dashboard tab
  utils/
    printLog.js             ← openPrintWindow(), classifyLogEntry()
```

See the root [`CLAUDE.md`](../CLAUDE.md) for full architecture notes.
