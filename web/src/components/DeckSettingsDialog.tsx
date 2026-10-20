import { useEffect, useRef } from 'react'
import type { Deck } from '../types'
import FsrsPanel from './FsrsPanel'

export default function DeckSettingsDialog({ deck, onClose, onSaved }: {
  deck: Deck; onClose: () => void; onSaved: () => Promise<void>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { element.close(); document.body.style.overflow = previousOverflow }
  }, [])
  return (
    <dialog ref={dialog} aria-labelledby="deck-settings-title" onCancel={onClose}
      onClick={event => { if (event.target === dialog.current) {
        const rect = dialog.current!.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
      } }}
      className="m-auto max-h-[85vh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5 text-zinc-900 shadow-xl backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
      <h2 id="deck-settings-title" className="mb-4 text-base font-semibold">{deck.name} · 设置</h2>
      <FsrsPanel deck={deck} onSaved={onSaved} />
    </dialog>
  )
}
