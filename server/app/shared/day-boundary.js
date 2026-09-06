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

/**
 * 时间戳所属的“复习日”序号（Anki 的 day offset）。
 * @param {number|Date} at
 * @returns {number}
 */
const dayIndexOf = at => {
  const ms = at instanceof Date ? at.getTime() : at
  const shifted = ms + timezoneOffsetMinutes(TZ_NAME, ms) * 60000 - ROLLOVER_HOUR * 3600000
  return Math.floor(shifted / DAY_MS)
}

/**
 * dayIndex 对应的日切点绝对时间戳（本地 ROLLOVER_HOUR 点）。
 * DST 安全：迭代两次收敛（无 DST 时一次即收敛）。
 * @param {number} index
 * @returns {number}
 */
const cutStartOfIndex = index => {
  let guess = index * DAY_MS + ROLLOVER_HOUR * 3600000
  for (let i = 0; i < 3; i += 1) {
    const next =
      index * DAY_MS +
      ROLLOVER_HOUR * 3600000 -
      timezoneOffsetMinutes(TZ_NAME, guess) * 60000
    if (next === guess) break
    guess = next
  }
  return guess
}

/** @param {number|Date} at @returns {number} at 所属复习日的 cutStart 时间戳 */
const cutStartOf = at => cutStartOfIndex(dayIndexOf(at))

/** @param {number|Date} at @returns {number} 下一个日切点（= 当天可见队列的开区间上界） */
const nextCutStartOf = at => cutStartOfIndex(dayIndexOf(at) + 1)

/**
 * Anki 语义的 elapsed_days（替代 ts-fsrs 的 dateDiffInDays，后者按 UTC 自然日）。
 * @param {number|Date} from
 * @param {number|Date} to
 * @returns {number}
 */
const elapsedDaysBetween = (from, to) => dayIndexOf(to) - dayIndexOf(from)

/**
 * 队列可见性窗口（对应 Anki 的“当天到期全部可见” + learn ahead）。
 * @param {number|Date} [at]
 * @returns {{ dayEndMs: number, learnAheadMs: number, cutStartMs: number }}
 */
const dueWindowOf = at => {
  const ms = at instanceof Date ? at.getTime() : at === undefined ? Date.now() : at
  return {
    cutStartMs: cutStartOf(ms),
    dayEndMs: nextCutStartOf(ms),
    learnAheadMs: ms + LEARN_AHEAD_MINUTES * 60000,
  }
}

module.exports = {
  DAY_MS,
  TZ_NAME,
  ROLLOVER_HOUR,
  LEARN_AHEAD_MINUTES,
  timezoneOffsetMinutes,
  fsrsOffsetProvider,
  dayIndexOf,
  cutStartOfIndex,
  cutStartOf,
  nextCutStartOf,
  elapsedDaysBetween,
  dueWindowOf,
}
