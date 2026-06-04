import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const node = process.execPath

function runStep(name, command, args, options = {}) {
  console.log(`\n== ${name} ==`)
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: 'inherit',
    encoding: 'utf8',
  })
  if (result.status !== 0) {
    throw new Error(`${name} failed with exit code ${result.status ?? 'unknown'}`)
  }
}

function commandExists(command) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' })
  return result.status === 0
}

function localBin(...segments) {
  return join(root, 'node_modules', ...segments)
}

const requiredBins = [
  localBin('typescript', 'bin', 'tsc'),
  localBin('eslint', 'bin', 'eslint.js'),
  localBin('vitest', 'vitest.mjs'),
  localBin('vite', 'bin', 'vite.js'),
]

for (const bin of requiredBins) {
  if (!existsSync(bin)) {
    throw new Error(`Missing local dependency: ${bin}. Run npm ci in app/.`)
  }
}

runStep('Doctor', node, [join(root, 'scripts', 'doctor.mjs')])
runStep('TypeScript', node, [localBin('typescript', 'bin', 'tsc'), '-b'])
runStep('ESLint', node, [localBin('eslint', 'bin', 'eslint.js'), '.', '--max-warnings', '0'])
runStep('Vitest', node, [localBin('vitest', 'vitest.mjs'), 'run'])
runStep('Vite build', node, [localBin('vite', 'bin', 'vite.js'), 'build'])
runStep('Build budgets', node, [join(root, 'scripts', 'check-budgets.mjs')])

if (commandExists('cargo')) {
  runStep('Rust cargo check', 'cargo', ['check'], { cwd: join(root, 'src-tauri') })
} else {
  console.log('\n== Rust cargo check ==')
  console.log('Skipped: cargo is not available in PATH.')
}

console.log('\nDesktop smoke completed.')
