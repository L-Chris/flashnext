import { Service } from 'typedi'
import { prisma } from 'app/shared/prisma'
import { NEW_CARDS_PER_DAY, REVIEWS_PER_DAY } from 'configs/constants'

export interface DailyLimits {
  newPerDay: number
  reviewPerDay: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)))

@Service()
export class SettingsService {
  private cache: DailyLimits | null = null

  /** 首次访问时以环境变量值落库，之后以库为准 */
  async get(): Promise<DailyLimits> {
    if (this.cache) return this.cache
    const row = await prisma.appSetting.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1, newPerDay: NEW_CARDS_PER_DAY, reviewPerDay: REVIEWS_PER_DAY },
    })
    this.cache = { newPerDay: row.newPerDay, reviewPerDay: row.reviewPerDay }
    return this.cache
  }

  async save(data: Partial<DailyLimits>): Promise<DailyLimits> {
    const current = await this.get()
    const row = await prisma.appSetting.update({
      where: { id: 1 },
      data: {
        newPerDay: clamp(data.newPerDay ?? current.newPerDay, 0, 100000),
        reviewPerDay: clamp(data.reviewPerDay ?? current.reviewPerDay, 0, 100000),
      },
    })
    this.cache = { newPerDay: row.newPerDay, reviewPerDay: row.reviewPerDay }
    return this.cache
  }
}
