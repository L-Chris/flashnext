import { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { DailyLimits, Deck, FsrsStatus, OptimizeJob, RebuildJob } from '../types'

const SOURCE_LABEL: Record<string, string> = {
  default: 'FSRS-6 官方默认', manual: '手工写入',
  'official-fsrs-rs': 'fsrs-rs 训练', 'official-forced': 'fsrs-rs 训练（强制）',
  legacy: '旧版自研优化（已废弃）',
}

export default function FsrsPanel({ deck, onSaved }: { deck: Deck; onSaved: () => Promise<void> }) {
  const [status, setStatus] = useState<FsrsStatus | null>(null)
  const [settings, setSettings] = useState<DailyLimits | null>(null)
  const [draft, setDraft] = useState<DailyLimits | null>(null)
  const [train, setTrain] = useState<OptimizeJob | null>(null)
  const [rebuild, setRebuild] = useState<RebuildJob | null>(null)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    Promise.all([api.getSettings(deck.id), api.getFsrsStatus(deck.id), api.optimizeFsrsStatus(deck.id), api.rebuildFsrsStatus(deck.id)])
      .then(([s, f, t, r]) => { if (mounted.current) { setSettings(s); setDraft(s); setStatus(f); setTrain(t); setRebuild(r) } })
      .catch(e => { if (mounted.current) setError(e.message) })
    return () => { mounted.current = false }
  }, [deck.id])

  useEffect(() => {
    if (!train?.running && !rebuild?.running) return
    let cancelled = false
    let timer: number
    const poll = async () => {
      try {
        const [t, r] = await Promise.all([api.optimizeFsrsStatus(deck.id), api.rebuildFsrsStatus(deck.id)])
        if (cancelled) return
        setTrain(t); setRebuild(r)
        if (!t.running && !r.running) {
          const next = await api.getFsrsStatus(deck.id)
          if (!cancelled) { setStatus(next); await onSaved() }
        } else timer = window.setTimeout(poll, 1200)
      } catch (e: any) {
        if (!cancelled) { setError(e.message); timer = window.setTimeout(poll, 3000) }
      }
    }
    timer = window.setTimeout(poll, 1000)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [deck.id, train?.running, rebuild?.running, onSaved])

  const save = async () => {
    if (!draft) return
    setPending(true); setError(''); setMessage('')
    try {
      const next = await api.saveSettings(deck.id, {
        newPerDay: draft.newPerDay, reviewPerDay: draft.reviewPerDay,
        rolloverHour: draft.rolloverHour,
        audioAutoplay: draft.audioAutoplay, showNewCardAnswerImmediately: draft.showNewCardAnswerImmediately,
        autoRevealAnswerSeconds: draft.autoRevealAnswerSeconds,
      })
      if (!mounted.current) return
      setSettings(next); setDraft(next); setMessage('本牌组设置已保存')
      setStatus(await api.getFsrsStatus(deck.id))
      await onSaved()
    } catch (e: any) { if (mounted.current) setError(e.message) }
    finally { if (mounted.current) setPending(false) }
  }
  const startTrain = async (force = false) => {
    setPending(true); setError(''); setMessage('')
    try {
      const next = await api.optimizeFsrs(deck.id, force)
      if (mounted.current) setTrain(next.job)
    } catch (e: any) { if (mounted.current) setError(e.message) }
    finally { if (mounted.current) setPending(false) }
  }
  const startRebuild = async (dryRun: boolean) => {
    setPending(true); setError(''); setMessage('')
    try {
      const next = await api.rebuildFsrs(deck.id, dryRun)
      if (mounted.current) setRebuild(next.job)
    } catch (e: any) { if (mounted.current) setError(e.message) }
    finally { if (mounted.current) setPending(false) }
  }
  const busy = pending || Boolean(train?.running || rebuild?.running)
  const changed = draft && settings && ['newPerDay', 'reviewPerDay', 'rolloverHour', 'audioAutoplay', 'showNewCardAnswerImmediately', 'autoRevealAnswerSeconds'].some(k => draft[k as keyof DailyLimits] !== settings[k as keyof DailyLimits])
  const inputClass = 'rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900'
  const buttonClass = 'rounded-md border border-zinc-300 px-3 py-1.5 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800'
  const result = train?.result
  return (
    <div className="space-y-4 text-sm">
      {error && <p role="alert" className="text-red-600">{error}</p>}
      {!status || !draft || !settings ? <p className="text-zinc-500">正在加载设置…</p> : <>
        <div className="space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <h3 className="font-medium">每日限额</h3>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1">新卡
              <input aria-label="每日新卡" type="number" min={0} max={100000} step={1} value={draft.newPerDay}
                onChange={e => setDraft({ ...draft, newPerDay: Number(e.target.value) })} className={`w-20 ${inputClass}`} />张/天
            </label>
            <label className="flex items-center gap-1">复习
              <input aria-label="每日复习" type="number" min={0} max={100000} step={1} value={draft.reviewPerDay}
                onChange={e => setDraft({ ...draft, reviewPerDay: Number(e.target.value) })} className={`w-20 ${inputClass}`} />张/天
            </label>
          </div>
          <div className="space-y-3 border-t border-zinc-200 pt-3 text-xs dark:border-zinc-800">
            <h3 className="text-sm font-medium">复习展示</h3>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.audioAutoplay} onChange={e => setDraft({ ...draft, audioAutoplay: e.target.checked })} className="accent-indigo-600" />
              自动播放卡片音频
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.showNewCardAnswerImmediately} onChange={e => setDraft({ ...draft, showNewCardAnswerImmediately: e.target.checked })} className="accent-indigo-600" />
              未学习的新卡直接显示答案
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.autoRevealAnswerSeconds !== null} onChange={e => setDraft({ ...draft, autoRevealAnswerSeconds: e.target.checked ? 10 : null })} className="accent-indigo-600" />
                自动显示答案
              </label>
              {draft.autoRevealAnswerSeconds !== null && <label className="flex items-center gap-1">
                等待 <input aria-label="自动显示答案等待秒数" type="number" min={1} max={3600} step={1} value={draft.autoRevealAnswerSeconds}
                  onChange={e => setDraft({ ...draft, autoRevealAnswerSeconds: Number(e.target.value) })} className={`w-20 ${inputClass}`} /> 秒
              </label>}
            </div>
            <p className="text-zinc-500">新卡直接显示优先于倒计时；显示答案后仍需手动评分。</p>
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-zinc-500">高级：日切点</summary>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1">日切点
                <select aria-label="日切点" value={draft.rolloverHour} onChange={e => setDraft({ ...draft, rolloverHour: Number(e.target.value) })} className={inputClass}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
                </select>
              </label>
            </div>
            <p className="mt-2 text-zinc-500">用于本牌组每日计数和后续调度。保存后已有到期时间保持原值。</p>
          </details>
          <div className="flex items-center justify-end gap-3 text-xs">
            <button disabled={pending || !changed} onClick={save} className={buttonClass}>{pending ? '处理中…' : '保存'}</button>
          </div>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="text-xs text-zinc-500">
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">FSRS 记忆参数</h3>
            <p className="mt-1">当前来源：{SOURCE_LABEL[status.source] || status.source} · {status.w.length} 维</p>
            {status.updatedAt && <p className="mt-1">更新于 {new Date(status.updatedAt).toLocaleString()}</p>}
            <p className="mt-1">日切点 {String(status.rolloverHour).padStart(2, '0')}:00（{status.timezone}）</p>
            <p className="mt-1">本牌组复习日志 {status.reviewCount} 条{status.reviewCount < status.minReviews && `（满 ${status.minReviews} 条后可训练）`}</p>
          </div>
          <button disabled={busy || status.reviewCount < status.minReviews || !status.revlogMigratedAt} onClick={() => startTrain()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
            {train?.running ? '训练中…' : '训练本牌组'}
          </button>
        </div>
        {!status.revlogMigratedAt && <p className="text-xs text-amber-700">历史日志缺少记忆状态，请在下方预览并重建后再训练。</p>}
        {train?.error && <p role="alert" className="text-xs text-red-600">训练失败：{train.error}</p>}
        {result && !train?.running && <div className="space-y-2 text-xs text-zinc-500">
          <p>{result.saved ? '已保存本牌组训练参数' : `训练结果未写入：${result.audit.reasons.join('；')}`} · {result.audit.items} 个样本</p>
          {!result.saved && <button disabled={busy} onClick={() => startTrain(true)} className={buttonClass}>重新训练并强制采用</button>}
        </div>}
        <details className="border-t border-zinc-200 pt-3 text-xs dark:border-zinc-800">
          <summary className="cursor-pointer text-zinc-500">高级：重建本牌组记忆状态</summary>
          <p className="my-3 text-zinc-500">根据本牌组复习历史和当前参数重新计算记忆状态与到期时间。先预览，再应用。</p>
          <button disabled={busy || Boolean(changed)} onClick={() => startRebuild(true)} className={buttonClass}>预览重建</button>
          {changed && <p className="mt-2 text-zinc-500">请先保存设置，再预览重建。</p>}
          {rebuild?.running && <p className="mt-2">{rebuild.dryRun ? '预览' : '重建'}进度：{rebuild.progress.cards}/{rebuild.progress.totalCards} 张卡 · {rebuild.progress.logs}/{rebuild.progress.totalLogs} 条日志</p>}
          {rebuild?.error && <p role="alert" className="mt-2 text-red-600">重建失败：{rebuild.error}</p>}
          {rebuild?.result && !rebuild.running && <div className="mt-3 space-y-2">
            <p>{rebuild.result.dryRun ? '预览' : '已重建'}：{rebuild.result.cards} 张卡 · {rebuild.result.logs} 条日志 · 今日到期 {rebuild.result.dueTodayBefore} → {rebuild.result.dueTodayAfter}</p>
            <p>复习间隔中位数 {rebuild.result.intervalPercentiles.p50} 天 · 最远到期 {new Date(rebuild.result.maxDue).toLocaleDateString()}</p>
            {rebuild.result.dryRun && !rebuild.error && <button disabled={busy || Boolean(changed)} onClick={() => startRebuild(false)} className={buttonClass}>应用以上预览到本牌组</button>}
          </div>}
        </details>
      </>}
      {message && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400">{message}</p>}
    </div>
  )
}
