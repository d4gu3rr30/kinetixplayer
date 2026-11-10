import { spawn } from 'node:child_process'

const commands = [
  ['node', ['--watch', '--env-file-if-exists=.env', 'server/index.mjs']],
  [process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'dev:ui']],
]
const children = commands.map(([command, args]) => spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' }))
function stop() { for (const child of children) child.kill() }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const child of children) child.on('exit', code => { if (code) { stop(); process.exitCode = code } })
