import { Service } from 'typedi'
import { HttpError } from 'routing-controllers'

@Service()
export class DeckWorkLock {
  private owner: { deckId: number; kind: string } | null = null
  acquire(deckId: number, kind: string) {
    if (this.owner) throw new HttpError(409, this.owner.deckId === deckId ? '本牌组已有训练或重建任务' : '另一个牌组正在训练或重建，请稍后再试')
    this.owner = { deckId, kind }
  }
  release(deckId: number) { if (this.owner?.deckId === deckId) this.owner = null }
}
