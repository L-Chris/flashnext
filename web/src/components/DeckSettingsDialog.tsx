import type { Deck } from '../types'
import FsrsPanel from './FsrsPanel'
import SettingsDialog from './SettingsDialog'

export default function DeckSettingsDialog({ deck, onClose, onSaved }: {
  deck: Deck; onClose: () => void; onSaved: () => Promise<void>
}) {
  return (
    <SettingsDialog title={`${deck.name} · 设置`} onClose={onClose}>
      <FsrsPanel deck={deck} onSaved={onSaved} />
    </SettingsDialog>
  )
}
