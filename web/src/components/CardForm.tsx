import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { useContentPreview } from '../hooks/useContentPreview'
import type { Card, CardSide, ContentFormat, MediaAsset } from '../types'
import CardContent from './CardContent'

interface Props { deckId: number; card?: Card; onClose: () => void; onSaved: () => void }
interface AudioDraft { key: string; side: CardSide; asset?: MediaAsset; file?: File; localUrl?: string }
const inputClass = 'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900'
const buttonClass = 'rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800'
const sideName = (side: CardSide) => side === 'front' ? '正面' : '背面'

export default function CardForm({ deckId, card, onClose, onSaved }: Props) {
  const [front, setFront] = useState(card?.front || '')
  const [back, setBack] = useState(card?.back || '')
  const [format, setFormat] = useState<ContentFormat>(card?.contentFormat || 'plain')
  const [audio, setAudio] = useState<AudioDraft[]>(() => (card?.media || []).map(m => ({ key: crypto.randomUUID(), side: m.side, asset: m })))
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const frontInput = useRef<HTMLTextAreaElement>(null)
  const backInput = useRef<HTMLTextAreaElement>(null)
  const urls = useRef(new Set<string>())
  const mounted = useRef(true)
  const preview = useContentPreview(front, back, format, 350)

  useEffect(() => {
    mounted.current = true
    const element = dialog.current!
    document.querySelectorAll<HTMLAudioElement>('audio[data-card-audio]').forEach(player => player.pause())
    element.showModal()
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      mounted.current = false
      element.querySelectorAll('audio').forEach(player => player.pause())
      element.close()
      document.body.style.overflow = oldOverflow
      urls.current.forEach(url => URL.revokeObjectURL(url))
      urls.current.clear()
    }
  }, [])

  const addFiles = (files: FileList | null, side: CardSide) => {
    if (!files?.length) return
    if (audio.length + files.length > 20) { setError('一张卡片最多关联 20 个音频'); return }
    if ([...files].some(file => file.size > 20 * 1024 * 1024 || file.size === 0)) { setError('请选择非空音频，单个文件不能超过 20 MiB'); return }
    setError('')
    // Snapshot FileList before clearing the input; React may defer the state update.
    const additions = [...files].map(file => {
      const localUrl = URL.createObjectURL(file); urls.current.add(localUrl)
      return { key: crypto.randomUUID(), side, file, localUrl }
    })
    setAudio(previous => [...previous, ...additions])
  }
  const remove = (item: AudioDraft) => {
    if (item.localUrl) { URL.revokeObjectURL(item.localUrl); urls.current.delete(item.localUrl) }
    setAudio(items => items.filter(entry => entry.key !== item.key))
  }
  const move = (key: string, step: number) => setAudio(items => {
    const index = items.findIndex(item => item.key === key)
    const side = items[index].side
    const siblings = items.map((item, i) => item.side === side ? i : -1).filter(i => i >= 0)
    const target = siblings[siblings.indexOf(index) + step]
    if (target === undefined) return items
    const next = [...items]; [next[index], next[target]] = [next[target], next[index]]; return next
  })
  const insertMath = (side: CardSide) => {
    const element = (side === 'front' ? frontInput : backInput).current!
    const value = side === 'front' ? front : back
    const start = element.selectionStart, end = element.selectionEnd
    const formula = `\\(${value.slice(start, end) || 'x^2'}\\)`
    const next = value.slice(0, start) + formula + value.slice(end)
    if (side === 'front') setFront(next); else setBack(next)
    setFormat('markdown_math')
    requestAnimationFrame(() => { element.focus(); element.setSelectionRange(start + 2, start + formula.length - 2) })
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy || !front.trim() || !back.trim() || preview.pending || preview.error || preview.preview?.valid === false) return
    setBusy(true); setError('')
    try {
      const uploaded: AudioDraft[] = []
      let completed = 0
      const files = audio.filter(item => !item.asset && item.file)
      for (const item of audio) {
        let asset = item.asset
        if (!asset && item.file) {
          setProgress(`上传音频 ${++completed}/${files.length}…`)
          asset = await api.uploadAudio(item.file)
          if (!mounted.current) return
          setAudio(items => items.map(entry => entry.key === item.key ? { ...entry, asset } : entry))
        }
        uploaded.push({ ...item, asset })
      }
      const positions = { front: 0, back: 0 }, unique = new Set<string>()
      const media = uploaded.map(item => {
        const mediaId = item.asset!.id, id = `${item.side}:${mediaId}`
        if (unique.has(id)) throw new Error(`${sideName(item.side)}包含重复音频，请移除其中一个`)
        unique.add(id)
        return { mediaId, side: item.side, position: positions[item.side]++ }
      })
      setProgress('保存卡片…')
      const payload = { front, back, contentFormat: format, media }
      if (card) await api.editCard(card.id, payload); else await api.createCard(deckId, payload)
      if (mounted.current) onSaved()
    } catch (e: unknown) { if (mounted.current) setError(e instanceof Error ? e.message : '保存失败，请重试') }
    finally { if (mounted.current) { setBusy(false); setProgress('') } }
  }
  const renderAudio = (side: CardSide) => {
    const list = audio.filter(item => item.side === side)
    return <div className="mt-3 space-y-2">
      <label className="block text-xs text-zinc-500">{sideName(side)}音频
        <input aria-label={`${sideName(side)}音频`} type="file" multiple disabled={busy}
          accept=".mp3,.m4a,.wav,.ogg,.opus,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/ogg,audio/opus"
          onChange={e => { addFiles(e.target.files, side); e.target.value = '' }} className="mt-1 block w-full text-xs file:mr-2 file:rounded file:border file:border-zinc-300 file:bg-transparent file:px-2 file:py-1 dark:file:border-zinc-700" />
      </label>
      {list.map((item, index) => <div key={item.key} className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-800">
        <p className="truncate text-xs" title={item.asset?.originalName || item.file?.name}>{index + 1}. {item.asset?.originalName || item.file?.name}</p>
        <audio data-card-audio="true" aria-label={`${sideName(side)}音频试听 ${index + 1}`} controls preload="none" src={item.localUrl || item.asset?.url} className="my-2 h-9 w-full max-w-full" onPlay={e => {
          document.querySelectorAll<HTMLAudioElement>('audio[data-card-audio]').forEach(player => { if (player !== e.currentTarget) player.pause() })
        }} />
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label={`${sideName(side)}音频 ${index + 1} 所在面`} value={item.side} disabled={busy} onChange={e => setAudio(items => items.map(entry => entry.key === item.key ? { ...entry, side: e.target.value as CardSide } : entry))} className="rounded border border-zinc-300 bg-transparent p-1 text-xs dark:border-zinc-700">
            <option value="front">正面</option><option value="back">背面</option>
          </select>
          <button type="button" disabled={busy || index === 0} onClick={() => move(item.key, -1)} className={buttonClass} aria-label={`上移${sideName(side)}音频 ${index + 1}`}>上移</button>
          <button type="button" disabled={busy || index === list.length - 1} onClick={() => move(item.key, 1)} className={buttonClass} aria-label={`下移${sideName(side)}音频 ${index + 1}`}>下移</button>
          <button type="button" disabled={busy} onClick={() => remove(item)} className={buttonClass} aria-label={`移除${sideName(side)}音频 ${index + 1}`}>移除</button>
        </div>
      </div>)}
    </div>
  }

  return <dialog ref={dialog} aria-labelledby="card-editor-title" onCancel={event => { if (busy) event.preventDefault(); else onClose() }}
    onClick={event => { if (event.target === dialog.current && !busy) {
      const rect = dialog.current!.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
    } }}
    className="m-auto max-h-[90vh] w-[calc(100%-2rem)] max-w-4xl overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5 text-zinc-900 shadow-xl backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100">
    <form onSubmit={save}>
      <h2 id="card-editor-title" className="mb-4 font-semibold">{card ? '编辑卡片' : '添加卡片'}</h2>
      <label className="mb-2 flex items-center gap-2 text-sm">内容格式
        <select aria-label="内容格式" value={format} disabled={busy} onChange={e => setFormat(e.target.value as ContentFormat)} className="rounded border border-zinc-300 bg-transparent px-2 py-1 dark:border-zinc-700">
          <option value="plain">纯文本</option><option value="markdown_math">Markdown / 数学公式</option>
        </select>
      </label>
      {format === 'markdown_math' && <p className="mb-4 text-xs text-zinc-500">{'行内公式：\\(x^2\\)；独立公式：$$x^2$$。代码块保留原文。'}</p>}
      <div className="grid gap-5 md:grid-cols-2">
        {(['front', 'back'] as const).map(side => <section key={side} className="min-w-0">
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor={`card-${side}`} className="text-sm font-medium">{sideName(side)}（{side === 'front' ? '问题' : '答案'}）</label>
            <button type="button" disabled={busy} onClick={() => insertMath(side)} className={buttonClass} aria-label={`${sideName(side)}插入公式`}>插入公式</button>
          </div>
          <textarea id={`card-${side}`} ref={side === 'front' ? frontInput : backInput} value={side === 'front' ? front : back} required maxLength={100000} rows={5} disabled={busy}
            onChange={e => side === 'front' ? setFront(e.target.value) : setBack(e.target.value)} className={`${inputClass} resize-y`} />
          <div className="mt-2 min-h-24 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-950" aria-label={`${sideName(side)}预览`}>
            <p className="mb-2 text-xs text-zinc-500">预览{preview.pending ? ' · 更新中…' : ''}</p>
            <CardContent text={side === 'front' ? front : back} rendered={preview.preview?.[side]} className="text-sm" />
          </div>
          {preview.preview?.[side].errors.map((issue, index) => <p key={index} role="alert" className="mt-1 break-words text-xs text-red-600">第 {issue.line} 行第 {issue.column} 列：{issue.message}</p>)}
          {renderAudio(side)}
        </section>)}
      </div>
      <p className="mt-3 text-xs text-zinc-500">支持 MP3、M4A、WAV、OGG，单个音频最大 20 MiB。</p>
      {preview.error && <p role="alert" className="mt-3 text-sm text-red-600">预览失败：{preview.error} <button type="button" onClick={preview.retry} className="underline">重试</button></p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm disabled:opacity-50 dark:border-zinc-700">取消</button>
        <button type="submit" disabled={busy || !front.trim() || !back.trim() || preview.pending || Boolean(preview.error) || preview.preview?.valid === false} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">{busy ? progress || '处理中…' : card ? '保存' : '添加'}</button>
      </div>
    </form>
  </dialog>
}
