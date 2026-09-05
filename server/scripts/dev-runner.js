const { spawn, spawnSync } = require('child_process')
const path = require('path')

const root = path.resolve(__dirname, '..')
const entry = path.join(root, 'dist', 'app.js')

const tsc = path.join(path.dirname(require.resolve('typescript/package.json')), 'bin', 'tsc')
const nodePath = [path.join(root, 'dist'), process.env.NODE_PATH]
  .filter(Boolean)
  .join(path.delimiter)
const env = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || 'development',
  NODE_PATH: nodePath,
}

const initial = spawnSync(process.execPath, [tsc], {
  cwd: root,
  env,
  stdio: 'inherit',
})
if (initial.status !== 0) process.exit(initial.status || 1)

const compiler = spawn(
  process.execPath,
  [tsc, '--watch', '--preserveWatchOutput'],
  { cwd: root, env, stdio: 'inherit' },
)
const server = spawn(
  process.execPath,
  ['--watch', '--enable-source-maps', entry],
  { cwd: root, env, stdio: 'inherit' },
)

let stopping = false
const stop = exitCode => {
  if (stopping) return
  stopping = true
  compiler.kill()
  server.kill()
  process.exit(exitCode)
}

compiler.once('exit', code => {
  if (!stopping) stop(code || 1)
})
server.once('exit', code => {
  if (!stopping) stop(code || 1)
})
process.once('SIGINT', () => stop(0))
process.once('SIGTERM', () => stop(0))
