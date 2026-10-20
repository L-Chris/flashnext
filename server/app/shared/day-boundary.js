// 日界（day boundary / cutoff）计算 —— 与 Anki / fsrs-rs 的语义完全一致。
//
// 对应 fsrs-rs `convert.rs::convert_to_date`：
//   date = (unix_ms + tz_offset_minutes - next_day_starts_at * 3600_000) 所在的 UTC 自然日
// 因此 delta_t / due 的“天”边界 = 本地时区每天 ROLLOVER_HOUR 点，而不是本地/UTC 午夜。
//
// 该文件刻意写成纯 CJS + JSDoc：后端 app（TS，allowJs）与 scripts/*.js 共用同一份实现，
// 避免出现两套时间语义。

const DAY_MS = 86400000

/** @type {Map<string, Intl.DateTimeFormat>} */
const formatters = new Map()

const readEnvInt = (name, fallback) => {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

/** 时区名，默认 Asia/Shanghai（与宿主一致） */
const TZ_NAME = process.env.FLASHNEXT_TZ || 'Asia/Shanghai'

/** 日切点小时，Anki 默认 4 点 */
const ROLLOVER_HOUR = readEnvInt('FLASHNEXT_ROLLOVER_HOUR', 4)

/** 学习卡提前展示窗口（分钟），Anki 默认 20 */
const LEARN_AHEAD_MINUTES = readEnvInt('FLASHNEXT_LEARN_AHEAD_MINUTES', 20)

/** @param {string} tz @param {number} ms @returns {number} offset in minutes */
const timezoneOffsetMinutes = (tz, ms) => {
  let formatter = formatters.get(tz)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('ia', { timeZone: tz, timeZoneName: 'shortOffset' })
    formatters.set(tz, formatter)
  }
  const part = formatter.formatToParts(ms).find(p => p.type === 'timeZoneName')
  const name = part && part.value
  if (!name || name === 'GMT' || name === 'UTC') return 0
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name)
  if (!m || !m[1] || !m[2]) throw new Error(`unsupported timezone offset: ${name}`)
  const total = Number(m[2]) * 60 + Number(m[3] || '0')
  return m[1] === '+' ? total : -total
}

/** 供 fsrs-rs convertCsvToFsrsItems 使用的 offsetProvider */
const fsrsOffsetProvider = (ms, tz) => timezoneOffsetMinutes(tz, ms)

/** @typedef {{ timezone: string, rolloverHour: number }} DayClock */
/** @type {DayClock} */
const DEFAULT_CLOCK = { timezone: TZ_NAME, rolloverHour: ROLLOVER_HOUR }

/** @param {number|Date} at @param {DayClock} [clock] */
const dayIndexOf = (at, clock = DEFAULT_CLOCK) => {
  const ms = at instanceof Date ? at.getTime() : at
  const localDay = Math.floor((ms + timezoneOffsetMinutes(clock.timezone, ms) * 60000) / DAY_MS)
  return ms < cutStartOfIndex(localDay, clock) ? localDay - 1 : localDay
}

/** @type {Map<string, number>} */
const cutoffs = new Map()

/** Resolve a local cutoff; first occurrence in a DST fold, roll forward in a gap.
 * @param {number} index @param {DayClock} [clock]
 */
const cutStartOfIndex = (index, clock = DEFAULT_CLOCK) => {
  const key = `${clock.timezone}:${clock.rolloverHour}:${index}`
  if (cutoffs.has(key)) return cutoffs.get(key)
  const target = index * DAY_MS + clock.rolloverHour * 3600000
  const offsets = new Set([-2, -1, 0, 1, 2].map(d => timezoneOffsetMinutes(clock.timezone, target + d * DAY_MS)))
  const candidates = [...offsets].map(offset => target - offset * 60000)
  const exact = candidates.filter(ms => ms + timezoneOffsetMinutes(clock.timezone, ms) * 60000 === target)
  const after = candidates.filter(ms => ms + timezoneOffsetMinutes(clock.timezone, ms) * 60000 > target)
  const resolved = exact.length ? Math.min(...exact) : Math.min(...after)
  if (!Number.isFinite(resolved)) throw new Error('Cannot resolve local day cutoff')
  if (cutoffs.size > 4096) cutoffs.delete(cutoffs.keys().next().value)
  cutoffs.set(key, resolved)
  return resolved
}

/** @param {number|Date} at @param {DayClock} [clock] */
const cutStartOf = (at, clock = DEFAULT_CLOCK) => cutStartOfIndex(dayIndexOf(at, clock), clock)
/** @param {number|Date} at @param {DayClock} [clock] */
const nextCutStartOf = (at, clock = DEFAULT_CLOCK) => cutStartOfIndex(dayIndexOf(at, clock) + 1, clock)
/** @param {number|Date} from @param {number|Date} to @param {DayClock} [clock] */
const elapsedDaysBetween = (from, to, clock = DEFAULT_CLOCK) => dayIndexOf(to, clock) - dayIndexOf(from, clock)
/** @param {number|Date} [at] @param {DayClock} [clock] */
const dueWindowOf = (at, clock = DEFAULT_CLOCK) => {
  const ms = at instanceof Date ? at.getTime() : at === undefined ? Date.now() : at
  return { cutStartMs: cutStartOf(ms, clock), dayEndMs: nextCutStartOf(ms, clock), learnAheadMs: ms + LEARN_AHEAD_MINUTES * 60000 }
}

module.exports = {
  DAY_MS, TZ_NAME, ROLLOVER_HOUR, LEARN_AHEAD_MINUTES, DEFAULT_CLOCK,
  timezoneOffsetMinutes, fsrsOffsetProvider, dayIndexOf, cutStartOfIndex, cutStartOf,
  nextCutStartOf, elapsedDaysBetween, dueWindowOf,
}
