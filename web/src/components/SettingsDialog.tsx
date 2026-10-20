import { useEffect, useId, useRef, type ReactNode } from 'react'

export default function SettingsDialog({ title, children, onClose }: {
  title: string; children: ReactNode; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const backdropDown = useRef(false)
  const titleId = useId()
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { element.close(); document.body.style.overflow = previousOverflow }
  }, [])
  return <dialog ref={dialog} aria-labelledby={titleId} onCancel={onClose}
    onPointerDown={event => { backdropDown.current = event.target === event.currentTarget }}
    onClick={event => { if (event.target === event.currentTarget && backdropDown.current) onClose(); backdropDown.current = false }}
    className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none items-center justify-center border-0 bg-transparent p-4 backdrop:bg-black/40 open:flex">
    <div className="max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5 text-zinc-900 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
      <h2 id={titleId} className="mb-4 text-base font-semibold">{title}</h2>
      {children}
    </div>
  </dialog>
}
