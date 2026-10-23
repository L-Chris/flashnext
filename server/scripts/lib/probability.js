const crypto = require('node:crypto')
const katex = require('katex')
const { ensureDeckConfig } = require('./deck-config')

const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
const keyOf = id => `math:probability:${id}`
const requireValue = (condition, message) => { if (!condition) throw new Error(message) }

function checkMath(text) {
  const remaining = text.replace(/\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g, (_raw, inline, block, dollars) => {
    katex.renderToString(inline ?? block ?? dollars, { throwOnError: true, strict: 'error', trust: false, maxExpand: 1000 })
    return ''
  })
  requireValue(!/\\[()[\]]|\$\$/.test(remaining), 'Unclosed formula delimiter')
}

function prepare(resource) {
  requireValue(resource.id === 'probability-high-school' && resource.version === 1, 'Unknown probability resource version')
  requireValue(resource.subject === 'probability' && resource.language === 'zh' && resource.name === '概率论', 'Invalid probability deck identity')
  requireValue(resource.stage?.key === 'high-school' && resource.stage.label === '高中', 'Only the 高中 stage is supported')
  requireValue(Array.isArray(resource.cards) && resource.cards.length > 0, 'Empty curriculum')
  const topics = new Map(resource.topics.map(topic => [topic.key, topic]))
  const sources = new Map(resource.sources.map(source => [source.id, source]))
  requireValue(topics.size === resource.topics.length && sources.size === resource.sources.length, 'Duplicate topic/source')
  for (const source of sources.values()) requireValue(new URL(source.url).protocol === 'https:' && source.title, 'Invalid source')
  const byId = new Map(), positions = new Set()
  for (const card of resource.cards) {
    requireValue(/^[a-z][a-z0-9-]*$/.test(card.id) && !byId.has(card.id), 'Duplicate or invalid knowledge ID')
    requireValue(Number.isSafeInteger(card.position) && card.position > 0 && !positions.has(card.position), 'Duplicate or invalid position')
    requireValue(card.type === 'knowledge' && topics.has(card.topic), 'Only knowledge cards with a known topic are allowed')
    requireValue([card.title, card.front, card.back].every(value => typeof value === 'string' && value.trim() && value.length <= 100000), 'Missing card content')
    requireValue(Array.isArray(card.prerequisiteIds) && new Set(card.prerequisiteIds).size === card.prerequisiteIds.length, 'Invalid prerequisites')
    requireValue(Array.isArray(card.sourceIds) && card.sourceIds.length && card.sourceIds.every(id => sources.has(id)), 'Missing card source')
    checkMath(card.front); checkMath(card.back)
    byId.set(card.id, card); positions.add(card.position)
  }
  for (const card of resource.cards) for (const prerequisite of card.prerequisiteIds) {
    requireValue(prerequisite !== card.id && byId.has(prerequisite), `Missing/self prerequisite: ${card.id} -> ${prerequisite}`)
  }
  // Kahn ordering, using authored positions for unrelated nodes. Never use DB IDs
  // to resolve prerequisites, and never infer mastery from this ordering.
  const ordered = [], done = new Set()
  while (ordered.length < byId.size) {
    const ready = [...byId.values()].filter(card => !done.has(card.id) && card.prerequisiteIds.every(id => done.has(id)))
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
    requireValue(ready.length, 'Cyclic prerequisites')
    ordered.push(ready[0]); done.add(ready[0].id)
  }
  const sourceHash = digest(resource)
  const cards = ordered.map((card, index) => ({ ...card, key: keyOf(card.id), learningOrder: (index + 1) * 10,
    tags: [{ scheme: 'education-stage', key: 'high-school', label: '高中' },
      { scheme: 'probability-topic', key: card.topic, label: topics.get(card.topic).label }],
    metadata: JSON.stringify({ datasetId: resource.id, version: resource.version, sourceHash, type: card.type,
      prerequisites: card.prerequisiteIds.map(id => ({ key: keyOf(id), title: byId.get(id).title })),
      sources: card.sourceIds.map(id => ({ title: sources.get(id).title, url: sources.get(id).url })) }),
  }))
  return { resource, sourceHash, cards }
}

async function importPlan(prisma, plan, apply = false) {
  const { resource, cards, sourceHash } = plan
  return prisma.$transaction(async tx => {
    const decks = await tx.deck.findMany({ where: { OR: [{ name: resource.name }, { subject: resource.subject }] } })
    requireValue(decks.length <= 1, 'Ambiguous probability deck; inspect existing decks')
    let deck = decks[0]
    if (deck) requireValue(deck.subject === resource.subject && deck.language === resource.language, 'Existing deck identity conflicts')
    const records = []
    // Check every identity/content before the first write; failed imports are atomic.
    for (const item of cards) {
      const entity = await tx.knowledgeEntity.findUnique({ where: { canonicalKey: item.key }, include: { tags: true, cards: true } })
      if (entity) {
        requireValue(entity.kind === 'math_concept' && entity.title === item.title && entity.summary === item.back && entity.metadata === item.metadata, `Changed knowledge content: ${item.id}`)
        const tags = rows => rows.map(({ scheme, key, label }) => JSON.stringify([scheme, key, label])).sort()
        requireValue(JSON.stringify(tags(entity.tags)) === JSON.stringify(tags(item.tags)), `Changed knowledge tags: ${item.id}`)
        requireValue(entity.cards.length <= 1, `Duplicate cards for ${item.id}`)
        for (const card of entity.cards) requireValue(deck && card.deckId === deck.id && card.wordId === null &&
          card.front === item.front && card.back === item.back && card.contentFormat === 'markdown_math' && card.learningOrder === item.learningOrder,
          `Changed card content/order: ${item.id}`)
      }
      records.push({ item, entity, card: entity?.cards[0] })
    }
    const report = { applied: apply, datasetId: resource.id, version: resource.version, sourceHash,
      newDeck: !deck, newEntities: records.filter(row => !row.entity).length,
      newCards: records.filter(row => !row.card).length, existingCards: records.filter(row => row.card).length,
      deckId: deck?.id ?? null, cardIds: records.filter(row => row.card).map(row => row.card.id),
      entityKeys: cards.map(card => card.key) }
    if (!apply) return report
    if (!deck) {
      deck = await tx.deck.create({ data: { name: resource.name, description: resource.description,
        subject: resource.subject, language: resource.language } })
      await ensureDeckConfig(tx, deck.id)
      await tx.deckSetting.update({ where: { deckId: deck.id }, data: { newPerDay: 3, audioAutoplay: false,
        showNewCardAnswerImmediately: false, autoRevealAnswerSeconds: null } })
    }
    report.deckId = deck.id
    report.cardIds = []
    for (const row of records) {
      const { item } = row
      const entity = row.entity || await tx.knowledgeEntity.create({ data: {
        kind: 'math_concept', canonicalKey: item.key, title: item.title, summary: item.back, metadata: item.metadata,
        tags: { create: item.tags },
      } })
      const card = row.card || await tx.card.create({ data: { deckId: deck.id, knowledgeEntityId: entity.id,
        learningOrder: item.learningOrder, front: item.front, back: item.back, contentFormat: 'markdown_math' } })
      report.cardIds.push(card.id)
    }
    return report
  }, { timeout: 120000, maxWait: 20000 })
}

module.exports = { prepare, importPlan, digest }
