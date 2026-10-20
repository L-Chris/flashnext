import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { ContentFormat, ContentPreview } from '../types'

// A bounded cache avoids rendering the same card again on undo or table expansion.
const cache = new Map<string, ContentPreview>()
export function useContentPreview(front: string, back: string, format: ContentFormat = 'plain', debounceMs = 0) {
  const key = JSON.stringify([front, back, format])
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ key: string; preview?: ContentPreview; error?: string }>({ key: '' })
  useEffect(() => {
    if (format !== 'markdown_math') return
    const controller = new AbortController()
    const cached = cache.get(key)
    if (cached) { setState({ key, preview: cached }); return }
    const timer = window.setTimeout(() => {
      api.previewContent(front, back, format, controller.signal).then(preview => {
        if (controller.signal.aborted) return
        const size = preview.front.html.length + preview.back.html.length
        let bytes = [...cache.values()].reduce((sum, item) => sum + item.front.html.length + item.back.html.length, 0)
        while (cache.size && (cache.size >= 64 || bytes + size > 8 * 1024 * 1024)) {
          const oldest = cache.keys().next().value!
          const removed = cache.get(oldest)!
          bytes -= removed.front.html.length + removed.back.html.length
          cache.delete(oldest)
        }
        cache.set(key, preview)
        setState({ key, preview })
      }).catch(error => { if (!controller.signal.aborted) setState({ key, error: error.message || '内容加载失败' }) })
    }, debounceMs)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [key, front, back, format, debounceMs, attempt])
  const current = state.key === key ? state : undefined
  return { preview: current?.preview, error: current?.error,
    pending: format === 'markdown_math' && !current?.preview && !current?.error,
    retry: () => { setState({ key: '' }); setAttempt(value => value + 1) } }
}
