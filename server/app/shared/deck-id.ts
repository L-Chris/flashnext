import { HttpError } from 'routing-controllers'

export const deckIdOf = (value: string): number => {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError(400, '无效牌组 ID')
  return id
}
