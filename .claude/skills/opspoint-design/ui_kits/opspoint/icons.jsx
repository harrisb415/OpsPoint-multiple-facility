/* OpsPoint UI Kit — icon set
   Faithful inline recreations of the lucide-react icons the product uses in its
   sidebar & controls. Stroke-based, 24×24, currentColor. Exported to window. */
(function () {
  const P = {
    // sidebar nav
    users: ['<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>','<circle cx="9" cy="7" r="4"/>','<path d="M22 21v-2a4 4 0 0 0-3-3.87"/>','<path d="M16 3.13a4 4 0 0 1 0 7.75"/>'],
    userCheck: ['<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>','<circle cx="9" cy="7" r="4"/>','<polyline points="16 11 18 13 22 9"/>'],
    clipboardList: ['<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/>','<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>','<path d="M12 11h4"/>','<path d="M12 16h4"/>','<path d="M8 11h.01"/>','<path d="M8 16h.01"/>'],
    fileText: ['<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/>','<path d="M14 2v4a2 2 0 0 0 2 2h4"/>','<path d="M16 13H8"/>','<path d="M16 17H8"/>','<path d="M10 9H8"/>'],
    checkSquare: ['<polyline points="9 11 12 14 22 4"/>','<path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'],
    ticket: ['<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/>','<path d="M13 5v2"/>','<path d="M13 11v2"/>','<path d="M13 17v2"/>'],
    mail: ['<rect width="20" height="16" x="2" y="4" rx="2"/>','<path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>'],
    flask: ['<path d="M9 3h6v6l4.5 9.2a1 1 0 0 1-.9 1.4H5.4a1 1 0 0 1-.9-1.4L9 9Z"/>','<path d="M8.5 3h7"/>','<path d="M6.3 14h11.4"/>'],
    pill: ['<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/>','<path d="m8.5 8.5 7 7"/>'],
    award: ['<circle cx="12" cy="8" r="6"/>','<path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11"/>'],
    alertTriangle: ['<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/>','<path d="M12 9v4"/>','<path d="M12 17h.01"/>'],
    ban: ['<circle cx="12" cy="12" r="10"/>','<path d="m4.9 4.9 14.2 14.2"/>'],
    penLine: ['<path d="M12 20h9"/>','<path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'],
    archive: ['<rect width="20" height="5" x="2" y="3" rx="1"/>','<path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/>','<path d="M10 12h4"/>'],
    dice5: ['<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>','<path d="M16 8h.01"/>','<path d="M8 8h.01"/>','<path d="M8 16h.01"/>','<path d="M16 16h.01"/>','<path d="M12 12h.01"/>'],
    // chrome / controls
    bell: ['<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/>','<path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>'],
    settings: ['<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>','<circle cx="12" cy="12" r="3"/>'],
    logOut: ['<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>','<polyline points="16 17 21 12 16 7"/>','<line x1="21" x2="9" y1="12" y2="12"/>'],
    search: ['<circle cx="11" cy="11" r="8"/>','<path d="m21 21-4.3-4.3"/>'],
    plus: ['<path d="M5 12h14"/>','<path d="M12 5v14"/>'],
    x: ['<path d="M18 6 6 18"/>','<path d="m6 6 12 12"/>'],
    printer: ['<polyline points="6 9 6 2 18 2 18 9"/>','<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>','<rect width="12" height="8" x="6" y="14"/>'],
    check: ['<path d="M20 6 9 17l-5-5"/>'],
    clock: ['<circle cx="12" cy="12" r="10"/>','<polyline points="12 6 12 12 16 14"/>'],
    dashboard: ['<rect width="7" height="9" x="3" y="3" rx="1"/>','<rect width="7" height="5" x="14" y="3" rx="1"/>','<rect width="7" height="9" x="14" y="12" rx="1"/>','<rect width="7" height="5" x="3" y="16" rx="1"/>'],
    chevronRight: ['<path d="m9 18 6-6-6-6"/>'],
    refresh: ['<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>','<path d="M21 3v5h-5"/>','<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>','<path d="M8 16H3v5"/>'],
    megaphone: ['<path d="m3 11 18-5v12L3 14v-3z"/>','<path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>'],
    info: ['<circle cx="12" cy="12" r="10"/>','<path d="M12 16v-4"/>','<path d="M12 8h.01"/>'],
    shield: ['<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>'],
    footprints: ['<path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"/>','<path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/>','<path d="M16 17h4"/>','<path d="M4 13h4"/>'],
    heartPulse: ['<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.49 4.04 3 5.5l7 7Z"/>','<path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/>'],
  };

  function Icon({ name, size = 16, strokeWidth = 2, className = '', style = {} }) {
    const parts = P[name];
    if (!parts) return null;
    return React.createElement('svg', {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round',
      className, style,
      dangerouslySetInnerHTML: { __html: parts.join('') },
    });
  }

  window.Icon = Icon;
})();
