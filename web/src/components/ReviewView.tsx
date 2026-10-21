import { pronunciationNotesCoverMeanings, reviewWordBack } from '../utils/word-card'
import Pronunciations from './Pronunciations'
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import type { Card, Deck, DueCounts, DueUsage, Rating } from '../types'
import { useContentPreview } from '../hooks/useContentPreview'
import { useAnswerCountdown } from '../hooks/useAnswerCountdown'
import CardContent from './CardContent'
import CardAudio from './CardAudio'
import SenseExamples from './SenseExamples'
import IeltsUsages from './IeltsUsages'

interface Props { deck: Deck; onExit: () => void }
const RATING_BUTTONS: Array<{ rating: Rating; label: string; className: string }> = [
  { rating: 1, label: '忘记', className: 'bg-red-600 hover:bg-red-500' },
  { rating: 2, label: '困难', className: 'bg-amber-600 hover:bg-amber-500' },
  { rating: 3, label: '良好', className: 'bg-emerald-600 hover:bg-emerald-500' },
  { rating: 4, label: '简单', className: 'bg-sky-600 hover:bg-sky-500' },
]

function WordAnswer({ card }: { card: Card }) {
  const { phonetic, meanings, isWordBack, reading, pos } = reviewWordBack(card.back, card.word)
  const hideDuplicateMeanings = isWordBack && card.word?.language !== 'ja' && pronunciationNotesCoverMeanings(meanings, card.word?.pronunciations)
  return <div className="mt-4 text-xl text-emerald-700 dark:text-emerald-400">
    {card.word?.language !== 'ja' && (phonetic || card.word?.pronunciations?.length) && <div className="text-center"><Pronunciations items={isWordBack ? card.word?.pronunciations : undefined} fallback={phonetic} /></div>}
    {reading && <p lang="ja" className="mb-2 text-center">{reading}</p>}
    {pos && <p className="mb-2 text-center text-sm text-zinc-500">{pos}</p>}
    {reading && card.word?.romaji && <details className="mb-2 text-center text-xs text-zinc-500"><summary className="cursor-pointer">罗马音</summary>{card.word.romaji}</details>}
    {meanings && !hideDuplicateMeanings && <div data-testid="word-meanings" className={`grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-left ${phonetic ? 'mt-5' : ''}`}>
      {meanings.split('\n').map((line, index) => {
        const match = line.match(/^([a-z&]+\.\s*)(.*)$/)
        return match ? <Fragment key={index}><span className="text-emerald-600/80 dark:text-emerald-500/80">{match[1].trim()}</span><span>{match[2]}</span></Fragment> : <span key={index} className="col-span-2 whitespace-pre-wrap">{line}</span>
      })}
    </div>}
  </div>
}

function ReviewCard({ card, language, grading, onGrade }: {
  card: Card; language?: string; grading: boolean; onGrade: (rating: Rating, elapsed: number) => void
}) {
  const delay = card.presentation?.answerRevealAfterMs ?? null
  const [revealed, setRevealed] = useState(delay === 0)
  const shownAt = useRef<number | null>(null)
  const content = useContentPreview(card.front, card.back, card.contentFormat)
  const ready = !content.pending && !content.error && content.preview?.valid !== false
  const reveal = useCallback(() => setRevealed(true), [])
  const seconds = useAnswerCountdown(delay, ready && !revealed && !grading, reveal)
  useEffect(() => { if (ready && shownAt.current === null) shownAt.current = performance.now() }, [ready])
  const autoplay = Boolean(card.presentation?.audioAutoplay) && ready
  return <>
    <div data-testid="review-card" data-card-id={card.id} className="mb-4 flex min-h-52 min-w-0 flex-col items-center justify-center rounded-xl border border-zinc-200 bg-white p-5 text-center dark:border-zinc-800 dark:bg-zinc-900 md:p-8">
      <div lang={card.word?.language || language} className="w-full min-w-0 text-2xl font-medium">
        {content.pending ? <p className="text-sm text-zinc-500">正在加载卡片…</p> : <CardContent text={card.front} rendered={content.preview?.front} />}
      </div>
      <CardAudio items={(card.media || []).filter(item => item.side === 'front')} autoplay={autoplay && !revealed} playbackKey={`${card.id}:front:${revealed}`} />
      {revealed && <div data-testid="card-answer" className="flex w-full min-w-0 flex-col items-center">
        {!content.pending && (card.contentFormat === 'markdown_math'
          ? <CardContent text={card.back} rendered={content.preview?.back} className="mt-5 w-full text-left text-xl text-emerald-700 dark:text-emerald-400" />
          : <WordAnswer card={card} />)}
        <CardAudio items={(card.media || []).filter(item => item.side === 'back')} autoplay={autoplay} playbackKey={`${card.id}:back`} />
        <IeltsUsages usages={card.word?.ieltsUsages} /><SenseExamples senses={card.word?.senses} />
      </div>}
      {content.error && <p role="alert" className="mt-3 text-xs text-red-600">公式加载失败，已显示原文。{content.error} <button onClick={content.retry} className="underline">重试</button></p>}
      {content.preview?.valid === false && <p role="alert" className="mt-3 text-xs text-red-600">卡片公式存在错误，请在牌组中编辑修正。</p>}
    </div>
    {!revealed ? <div>
      <button disabled={grading || content.pending} onClick={reveal} className="w-full rounded-lg bg-indigo-600 py-3 font-medium text-white hover:bg-indigo-500 disabled:opacity-50">显示答案</button>
      {seconds !== null && <p aria-live="off" className="mt-2 text-center text-xs text-zinc-500">{seconds} 秒后显示答案</p>}
    </div> : <div className="flex gap-2">
      {RATING_BUTTONS.map(({ rating, label, className }) => <button key={rating} disabled={grading || content.pending} onClick={() => onGrade(rating, Math.max(0, Math.round(performance.now() - (shownAt.current ?? performance.now()))))}
        className={`flex-1 rounded-lg py-3 text-sm font-medium text-white disabled:opacity-50 ${className}`}>{label}</button>)}
    </div>}
  </>
}

export default function ReviewView({ deck, onExit }: Props) {
  const [queue, setQueue] = useState<Card[]>([])
  const [loading, setLoading] = useState(true)
  const [grading, setGrading] = useState(false)
  const [usage, setUsage] = useState<DueUsage | null>(null)
  const [counts, setCounts] = useState<DueCounts | null>(null)
  const [graded, setGraded] = useState<number[]>([])
  const [visit, setVisit] = useState(0)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const mounted = useRef(true)
  const mutation = useRef(false)
  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    setLoading(true); setError('')
    api.listDue(deck.id, controller.signal).then(data => {
      if (controller.signal.aborted) return
      setQueue(data.cards); setUsage(data.usage); setCounts(data.counts); setLoading(false)
    }).catch(e => { if (!controller.signal.aborted) { setError(e.message || '加载复习队列失败'); setLoading(false) } })
    return () => { mounted.current = false; controller.abort() }
  }, [deck.id, attempt])
  const current = queue[0]
  const handleGrade = async (rating: Rating, elapsed: number) => {
    if (!current || mutation.current) return
    mutation.current = true; setGrading(true); setError('')
    try {
      await api.reviewCard(current.id, rating, elapsed)
      if (!mounted.current) return
      setGraded(previous => [current.id, ...previous]); setQueue(previous => previous.slice(1)); setVisit(value => value + 1)
      setUsage(previous => previous ? { ...previous,
        newCount: previous.newCount + (current.state === 0 ? 1 : 0),
        reviewCount: previous.reviewCount + ([2, 3].includes(current.state) ? 1 : 0) } : previous)
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '评分失败，请重试') }
    finally { mutation.current = false; if (mounted.current) setGrading(false) }
  }
  const handleUndo = async () => {
    const id = graded[0]
    if (!id || mutation.current) return
    mutation.current = true; setGrading(true); setError('')
    try {
      const card = await api.undoCard(id)
      if (!mounted.current) return
      setGraded(previous => previous.slice(1)); setQueue(previous => [card, ...previous]); setVisit(value => value + 1)
      setUsage(previous => previous ? { ...previous,
        newCount: Math.max(0, previous.newCount - (card.state === 0 ? 1 : 0)),
        reviewCount: Math.max(0, previous.reviewCount - ([2, 3].includes(card.state) ? 1 : 0)) } : previous)
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : '撤销失败，请重试') }
    finally { mutation.current = false; if (mounted.current) setGrading(false) }
  }
  return <div>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-500">
      <span>剩余 {queue.length} 张{usage && <span className="ml-2 text-xs">今日已复习 {usage.reviewCount}/{usage.reviewLimit} · 新卡 {usage.newCount}/{usage.newLimit}</span>}</span>
      <span className="flex items-center gap-3">
        {graded.length > 0 && <button disabled={grading} onClick={handleUndo} className="rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800">撤销上次评分</button>}
        <button onClick={onExit} className="hover:text-zinc-800 dark:hover:text-zinc-200">退出复习</button>
      </span>
    </div>
    {error && <p role="alert" className="mb-4 text-sm text-red-600">{error}{!queue.length && !graded.length && <button onClick={() => setAttempt(value => value + 1)} className="ml-2 underline">重试</button>}</p>}
    {loading ? <p className="text-center text-zinc-500">加载中…</p> : current ? <ReviewCard key={`${current.id}:${visit}`} card={current} language={deck.language} grading={grading} onGrade={handleGrade} />
      : !error && <div className="rounded-lg border border-zinc-200 bg-white p-10 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-zinc-500">{(counts?.hiddenByLimit || 0) > 0 ? '今日限额已用完，剩余卡片将在后续学习中显示。' : '本次复习队列已完成。'}</p>
        <button onClick={onExit} className="mt-5 rounded-lg bg-zinc-200 px-6 py-2 text-sm dark:bg-zinc-800">返回牌组</button>
      </div>}
  </div>
}
