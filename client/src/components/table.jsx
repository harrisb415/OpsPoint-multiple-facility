// ════════════════════════════════════════════════════════════════════════
// Data-table primitives that match the design prototype exactly.
//
// Drop-in replacements for flowbite-react's Table* exports — same names and
// same child structure (<Table hoverable><TableHead><TableRow><TableHeadCell>
// …</TableHead><TableBody><TableRow><TableCell>…) — so a tab only swaps its
// import line. The markup mirrors the prototype's archetypes.js table():
// a rounded-xl bordered card wrapper, gray-50/700 head, p-3 cells, divide-y
// rows, and a blue hover. flowbite's stock Table theme (text-gray-700 head,
// px-6 py-3, no bordered wrapper) didn't match, which is why these exist.
// ════════════════════════════════════════════════════════════════════════
import { createContext, useContext } from 'react'

const cx = (...c) => c.filter(Boolean).join(' ')

// Table → rows read `hoverable`; TableHead → its <tr> stays transparent so the
// thead's gray fill shows through.
const TableCtx = createContext({ hoverable: false })
const HeadCtx = createContext(false)

export function Table({ children, hoverable = false, striped = false, flush = false, className, ...rest }) {
  return (
    <div className={cx(
      'overflow-x-auto',
      !flush && 'bg-white border border-gray-200 rounded-xl dark:bg-gray-800 dark:border-gray-700',
      className
    )} {...rest}>
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <TableCtx.Provider value={{ hoverable, striped }}>{children}</TableCtx.Provider>
      </table>
    </div>
  )
}

export function TableHead({ children, className, ...rest }) {
  return (
    <thead className={cx('bg-gray-50 dark:bg-gray-700', className)} {...rest}>
      <HeadCtx.Provider value={true}>{children}</HeadCtx.Provider>
    </thead>
  )
}

export function TableBody({ children, className, ...rest }) {
  return (
    <tbody className={cx('divide-y divide-gray-200 dark:divide-gray-700', className)} {...rest}>
      {children}
    </tbody>
  )
}

export function TableRow({ children, className, ...rest }) {
  const inHead = useContext(HeadCtx)
  const { hoverable } = useContext(TableCtx)
  if (inHead) return <tr className={className} {...rest}>{children}</tr>
  return (
    <tr
      className={cx(
        'bg-white dark:bg-gray-800',
        hoverable && 'hover:bg-primary-50/60 dark:hover:bg-gray-700',
        rest.onClick && 'cursor-pointer',
        className,
      )}
      {...rest}
    >
      {children}
    </tr>
  )
}

export function TableHeadCell({ children, className, ...rest }) {
  return (
    <th className={cx('p-3 text-xs font-medium tracking-wider text-left text-gray-500 uppercase dark:text-gray-300', className)} {...rest}>
      {children}
    </th>
  )
}

export function TableCell({ children, className, ...rest }) {
  return (
    <td className={cx('p-3 text-sm text-gray-700 dark:text-gray-200', className)} {...rest}>
      {children}
    </td>
  )
}
