const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const esbuild = require('esbuild')
const { nodeExternalsPlugin } = require('esbuild-node-externals')

const projectRoot = __dirname
const compiledRoot = path.join(projectRoot, '.build-ts')

const compiledPathAliasPlugin = {
  name: 'compiled-path-aliases',
  setup(build) {
    build.onResolve({ filter: /^(app|configs)\// }, args => {
      const basePath = path.join(compiledRoot, args.path)
      const filePath = `${basePath}.js`
      const indexPath = path.join(basePath, 'index.js')
      if (fs.existsSync(filePath)) return { path: filePath }
      if (fs.existsSync(indexPath)) return { path: indexPath }
      return null
    })
  },
}

const build = async () => {
  fs.rmSync(compiledRoot, { recursive: true, force: true })
  execFileSync(
    process.execPath,
    [
      path.join(projectRoot, 'node_modules/typescript/bin/tsc'),
      '--outDir',
      compiledRoot,
      '--sourceMap',
      'false',
      '--declaration',
      'false',
    ],
    { cwd: projectRoot, stdio: 'inherit' },
  )

  try {
    await esbuild.build({
      entryPoints: {
        index: path.join(compiledRoot, 'app.js'),
      },
      bundle: true,
      outdir: path.join(projectRoot, 'dist'),
      platform: 'node',
      sourcemap: true,
      sourcesContent: false,
      plugins: [compiledPathAliasPlugin, nodeExternalsPlugin()],
    })
  } finally {
    fs.rmSync(compiledRoot, { recursive: true, force: true })
  }
}

build().catch(error => {
  console.error(error)
  process.exit(1)
})
