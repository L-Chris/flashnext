import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import SettingsDialog from './SettingsDialog'

export default function GlobalSettingsDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [saved, setSaved] = useState<string | null>(null)
  const [timezone, setTimezone] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    api.getGlobalSettings().then(value => { if (mounted.current) { setSaved(value.timezone); setTimezone(value.timezone) } })
      .catch(e => { if (mounted.current) setError(e.message) })
    return () => { mounted.current = false }
  }, [])
  const save = async () => {
    setPending(true); setError(''); setMessage('')
    try {
      const value = await api.saveGlobalSettings(timezone)
      await onSaved()
      if (mounted.current) { setSaved(value.timezone); setTimezone(value.timezone); setMessage('设置已保存') }
    } catch (e: any) { if (mounted.current) setError(e.message) }
    finally { if (mounted.current) setPending(false) }
  }
  return <SettingsDialog title="设置" onClose={onClose}>
    <div className="space-y-4 text-sm">
      {error && <p role="alert" className="text-red-600">{error}</p>}
      {saved === null ? !error && <p className="text-zinc-500">正在加载设置…</p> : <>
        <label className="flex flex-wrap items-center gap-3">时区
          <input aria-label="时区" value={timezone} onChange={e => { setTimezone(e.target.value); setMessage('') }} placeholder="Asia/Shanghai"
            className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900" />
        </label>
        <div className="flex justify-end">
          <button disabled={pending || timezone.trim() === saved || !timezone.trim()} onClick={save}
            className="rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800">{pending ? '保存中…' : '保存'}</button>
        </div>
      </>}
      {message && <p role="status" className="text-emerald-700 dark:text-emerald-400">{message}</p>}
    </div>
  </SettingsDialog>
}
