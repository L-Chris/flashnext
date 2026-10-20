import { useEffect, useState } from 'react'

export function useAnswerCountdown(delayMs: number | null, enabled: boolean, onElapsed: () => void) {
  const [seconds, setSeconds] = useState<number | null>(delayMs === null ? null : Math.ceil(delayMs / 1000))
  useEffect(() => {
    if (!enabled || delayMs === null || delayMs <= 0) return
    let remaining = delayMs, started = 0, running = false
    let deadlineTimer: number | undefined, tickTimer: number | undefined
    const clear = () => { window.clearTimeout(deadlineTimer); window.clearInterval(tickTimer) }
    const pause = () => {
      if (running) remaining = Math.max(0, remaining - (performance.now() - started))
      running = false; clear()
    }
    const resume = () => {
      if (running || document.hidden) return
      started = performance.now(); running = true
      setSeconds(Math.ceil(remaining / 1000))
      deadlineTimer = window.setTimeout(() => {
        if (document.hidden) { pause(); return }
        running = false; clear(); setSeconds(0); onElapsed()
      }, remaining)
      tickTimer = window.setInterval(() => setSeconds(Math.max(0, Math.ceil((remaining - (performance.now() - started)) / 1000))), 250)
    }
    const visibility = () => { if (document.hidden) pause(); else resume() }
    document.addEventListener('visibilitychange', visibility)
    resume()
    return () => { clear(); document.removeEventListener('visibilitychange', visibility) }
  }, [delayMs, enabled, onElapsed])
  return enabled ? seconds : null
}
