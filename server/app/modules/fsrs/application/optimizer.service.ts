import { Service } from 'typedi'
import { FsrsRepository, ReviewSeq } from '../infrastructure/fsrs.repository'
import type { Card as FSRSCard } from 'ts-fsrs' with { 'resolution-mode': 'import' }
import type * as FSRS from 'ts-fsrs' with { 'resolution-mode': 'import' }

export const MIN_TRAINING_REVIEWS = 1000

const REVIEW_STATE = 2

type FSRSModule = typeof FSRS

let modulePromise: Promise<FSRSModule> | null = null

const loadFSRS = (): Promise<FSRSModule> => {
  if (!modulePromise) modulePromise = import('ts-fsrs')
  return modulePromise
}

const clampProb = (p: number) => Math.min(1 - 1e-4, Math.max(1e-4, p))

@Service()
export class OptimizerService {
  constructor(private fsrsRepository: FsrsRepository) {}

  async getCurrentW(): Promise<number[]> {
    const row = await this.fsrsRepository.getParamRow()
    if (row) return JSON.parse(row.w) as number[]
    const { default_w } = await loadFSRS()
    return [...default_w]
  }

  async getStatus() {
    const row = await this.fsrsRepository.getParamRow()
    const reviewCount = await this.fsrsRepository.countLogs()
    return {
      w: row ? (JSON.parse(row.w) as number[]) : await this.getCurrentW(),
      updatedAt: row?.updatedAt ?? null,
      reviewCount,
      minReviews: MIN_TRAINING_REVIEWS,
    }
  }

  async optimize() {
    const reviewCount = await this.fsrsRepository.countLogs()
    if (reviewCount < MIN_TRAINING_REVIEWS) {
      throw new Error(`review logs insufficient: ${reviewCount} < ${MIN_TRAINING_REVIEWS}`)
    }

    const mod = await loadFSRS()
    const sequences = await this.fsrsRepository.collectSequences()
    const defaults = [...mod.default_w]

    const loss = (w: number[]) => this.computeLoss(mod, w, sequences, defaults)

    let w = await this.getCurrentW()
    if (w.length !== defaults.length) w = [...defaults]
    let best = loss(w)
    const lossBefore = best

    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < w.length; i++) {
        for (const factor of [0.75, 0.9, 1.1, 1.25]) {
          const candidate = [...w]
          candidate[i] = candidate[i] * factor
          const clipped = mod.clipParameters(
            candidate,
            mod.default_relearning_steps.length,
            true,
          )
          const value = loss(clipped)
          if (value < best - 1e-7) {
            best = value
            w = clipped
          }
        }
      }
    }

    await this.fsrsRepository.saveParams(w)

    return {
      w,
      lossBefore,
      lossAfter: best,
      trainingReviews: reviewCount,
      cards: sequences.length,
    }
  }

  private computeLoss(
    mod: FSRSModule,
    w: number[],
    sequences: ReviewSeq[],
    defaults: number[],
  ): number {
    const scheduler = mod.fsrs(mod.generatorParameters({ w }))
    let total = 0
    let count = 0

    for (const seq of sequences) {
      let card: FSRSCard = mod.createEmptyCard(seq.times[0])
      for (let i = 0; i < seq.ratings.length; i++) {
        const prevState = card.state
        const prevStability = card.stability
        const prevTime = i === 0 ? seq.times[0] : seq.times[i - 1]
        const rating = seq.ratings[i] as 1 | 2 | 3 | 4
        const preview = scheduler.repeat(card, seq.times[i])
        card = preview[rating].card

        if (prevState === REVIEW_STATE) {
          const elapsed = (seq.times[i].getTime() - prevTime.getTime()) / 86400000
          const p = clampProb(mod.forgetting_curve(w, Math.max(elapsed, 0), prevStability))
          const y = rating === 1 ? 0 : 1
          total += -(y * Math.log(p) + (1 - y) * Math.log(1 - p))
          count++
        }
      }
    }

    if (count === 0) return Infinity

    let reg = 0
    for (let i = 0; i < w.length; i++) {
      reg += Math.pow((w[i] - defaults[i]) / defaults[i], 2)
    }

    return total / count + (0.005 * reg) / w.length
  }
}
