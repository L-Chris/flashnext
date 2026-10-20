import { useEffect, useRef, useState } from 'react'
import type { CardMedia } from '../types'

export default function CardAudio({ items, autoplay = false, playbackKey }: {
  items: CardMedia[]; autoplay?: boolean; playbackKey: string
}) {
  const players = useRef<Array<HTMLAudioElement | null>>([])
  const sequence = useRef(false)
  const generation = useRef(0)
  const [message, setMessage] = useState('')
  const playlist = items.map(item => `${item.mediaId}:${item.position}`).join(',')
  useEffect(() => {
    const elements = players.current.filter((player): player is HTMLAudioElement => Boolean(player))
    const token = ++generation.current
    setMessage('')
    sequence.current = autoplay
    const stop = () => {
      sequence.current = false
      elements.forEach(player => { player.pause(); player.currentTime = 0 })
    }
    if (autoplay && !document.hidden && players.current[0]) {
      void players.current[0].play().catch(error => {
        if (token !== generation.current) return
        sequence.current = false
        setMessage(error.name === 'NotAllowedError' ? '浏览器未允许自动播放，请点击播放器播放。' : '音频未能播放，请点击播放器重试。')
      })
    }
    const onVisibility = () => { if (document.hidden) stop() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => { generation.current++; stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [autoplay, playbackKey, playlist])
  if (!items.length) return null
  const next = (index: number) => {
    if (!sequence.current || document.hidden) return
    const player = players.current[index + 1]
    if (!player) { sequence.current = false; return }
    const token = generation.current
    void player.play().catch(error => {
      if (generation.current !== token) return
      sequence.current = false
      setMessage(error.name === 'NotAllowedError' ? '请点击播放器继续播放。' : '音频未能播放，请点击播放器重试。')
    })
  }
  return <div className="mt-3 w-full max-w-lg space-y-2 text-left">
    {items.map((item, index) => <div key={`${item.side}:${item.mediaId}`}>
      <p className="mb-1 truncate text-xs text-zinc-500" title={item.originalName}>{items.length > 1 ? `${index + 1}. ` : ''}{item.originalName}</p>
      <audio ref={element => { players.current[index] = element }} data-card-audio="true" aria-label={`${item.side === 'front' ? '正面' : '背面'}音频 ${index + 1}`} controls preload="none" src={item.url}
        className="h-10 w-full max-w-full" onPlay={event => {
          if (document.hidden) { event.currentTarget.pause(); return }
          document.querySelectorAll<HTMLAudioElement>('audio[data-card-audio]').forEach(player => { if (player !== event.currentTarget) player.pause() })
          sequence.current = autoplay; setMessage('')
        }} onEnded={() => next(index)} onError={() => setMessage('音频无法加载，请检查网络或点击播放器重试。')} />
    </div>)}
    {message && <p role="status" className="text-xs text-amber-700 dark:text-amber-400">{message}</p>}
  </div>
}
