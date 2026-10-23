// Host CLI: preview by default; application requires an independent SQLite backup.
const fs = require('node:fs')
const path = require('node:path')
const { parseArgs } = require('node:util')
const { execFileSync } = require('node:child_process')
const { PrismaClient } = require('@prisma/client')
const { prepare, importPlan } = require('./lib/probability')

async function main() {
  const { values } = parseArgs({ options: { db: { type: 'string' }, report: { type: 'string' },
    input: { type: 'string', default: path.join(__dirname, 'resources/probability-high-school.json') },
    apply: { type: 'boolean', default: false }, backup: { type: 'string' } } })
  if (!values.db || !values.report) throw Error('--db and --report are required')
  const db = path.resolve(values.db)
  if (!fs.existsSync(db)) throw Error('Database must exist and have the current Prisma schema')
  const plan = prepare(JSON.parse(fs.readFileSync(values.input, 'utf8')))
  if (values.apply) {
    if (!values.backup || path.resolve(values.backup) === db) throw Error('--apply requires a new, separate --backup path')
    const backup = path.resolve(values.backup)
    fs.mkdirSync(path.dirname(backup), { recursive: true })
    fs.closeSync(fs.openSync(backup, 'wx'))
    execFileSync('python3', ['-c', 'import sqlite3,sys; a=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True); b=sqlite3.connect(sys.argv[2]); a.backup(b); b.close(); a.close()', db, backup])
  }
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${db}` } } })
  try {
    const report = await importPlan(prisma, plan, values.apply)
    if (values.apply) report.backup = path.resolve(values.backup)
    fs.mkdirSync(path.dirname(path.resolve(values.report)), { recursive: true })
    fs.writeFileSync(values.report, JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report))
  } finally { await prisma.$disconnect() }
}
main().catch(error => { console.error(error.message); process.exitCode = 1 })
