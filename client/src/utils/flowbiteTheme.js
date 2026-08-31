import { createTheme } from 'flowbite-react'

// App-wide flowbite-react overrides, applied once via ThemeProvider in main.jsx.
//
// Done here rather than at the 35 <ModalHeader> call sites so every modal —
// including ones added later — picks the treatment up automatically.
//
// Full class strings are given (not just the added ones) so the result does not
// depend on how flowbite merges a partial override against its default.
export const opsTheme = createTheme({
  modal: {
    content: {
      // dark:bg-gray-800 rather than flowbite's gray-700: form controls in dark
      // mode are gray-700 (--inp-bg), so on a gray-700 panel an input had the
      // same value as the surface behind it. This also matches the app's cards.
      inner:
        'relative flex max-h-[90dvh] flex-col rounded-xl bg-white shadow-xl ' +
        'dark:bg-gray-800',
    },
    header: {
      // The tinted band the app's cards use (CARD_HEAD in utils/ui.js), so a
      // modal reads as the same surface family and follows the facility theme.
      base:
        'flex items-start justify-between rounded-t-xl border-b p-5 ' +
        'bg-gradient-to-r from-primary-50 to-primary-100/60 border-primary-100 ' +
        'dark:from-gray-700/50 dark:to-gray-700/30 dark:border-gray-700',
      // The confirm dialog (useConfirm in components/ui.jsx) renders a headerless
      // <ModalHeader /> in popup mode — just a close button. A tinted band two
      // pixels tall would read as a rendering fault, so strip it back.
      popup: 'bg-none border-b-0 p-2',
      title: 'font-display text-lg font-semibold tracking-tight text-gray-900 dark:text-white',
    },
    body: {
      base: 'flex-1 overflow-auto p-6',
      popup: 'pt-0',
    },
    footer: {
      // flowbite leaves the footer borderless unless popup; without a rule the
      // action row floats against the body.
      base: 'flex items-center gap-2 rounded-b-xl border-t border-gray-200 p-5 dark:border-gray-700',
      popup: 'border-t',
    },
  },
})
