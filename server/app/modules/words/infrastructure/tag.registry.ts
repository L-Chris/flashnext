export interface TagLevel {
  level: number
  label: string
  description?: string
}

export interface TagScheme {
  scheme: string
  name: string
  levels: TagLevel[]
}

export const SINGLE_DECK_NAME = '英语单词'

export const TAG_SCHEMES: TagScheme[] = [
  {
    scheme: 'coca',
    name: 'COCA',
    levels: [
      { level: 1, label: 'L1 核心高频', description: '覆盖日常文本约 75%' },
      { level: 2, label: 'L2 常用', description: '累计覆盖约 85%' },
      { level: 3, label: 'L3 进阶', description: '累计覆盖约 90%' },
      { level: 4, label: 'L4 扩展', description: '六级/雅思水平' },
      { level: 5, label: 'L5 学术', description: '托福/GRE 方向' },
    ],
  },
  {
    scheme: 'cet',
    name: 'CET',
    levels: [
      { level: 4, label: 'CET-4', description: '大学英语四级' },
      { level: 6, label: 'CET-6', description: '大学英语六级' },
    ],
  },
]

export const cocaLevelOfRank = (rank: number | null): number | null => {
  if (rank === null) return null
  if (rank <= 1000) return 1
  if (rank <= 3000) return 2
  if (rank <= 5000) return 3
  if (rank <= 10000) return 4
  return 5
}
