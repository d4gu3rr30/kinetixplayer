import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ios = path.join(root, 'ios')
const project = path.join(ios, 'Kinetix.xcodeproj')
const web = path.join(ios, 'Kinetix', 'www')
const build = path.join(ios, 'build')
const archive = path.join(build, 'Kinetix.xcarchive')
const archiveIpa = process.argv.includes('--archive')
const unsignedIpa = process.argv.includes('--unsigned')
const archiveMode = archiveIpa || unsignedIpa

const appVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '0.1.0'
const bundleId = process.env.IOS_BUNDLE_ID || 'app.kinetix.player'
const exportMethod = process.env.IOS_EXPORT_METHOD || 'development'
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { stdio: 'inherit', cwd, shell: process.platform === 'win32' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Команда завершилась с кодом ${result.status}: ${command} ${args.join(' ')}`)
}

console.log('› Сборка веб-приложения')
run(npm, ['run', 'build'])

console.log('› Копирование ассетов в iOS-проект')
fs.rmSync(web, { recursive: true, force: true })
fs.cpSync(path.join(root, 'dist'), web, { recursive: true })
if (!fs.existsSync(path.join(web, 'index.html'))) throw new Error('dist/index.html не собран')

if (process.platform !== 'darwin') {
  console.log('')
  console.log('Xcode работает только на macOS. Проект и веб-ассеты готовы:')
  console.log(`  ${project}`)
  console.log('Перенесите папку ios на Mac, откройте Kinetix.xcodeproj, выберите свою команду разработчика и запустите на iPhone.')
  process.exit(0)
}

const shared = [
  '-project', project,
  '-scheme', 'Kinetix',
  '-configuration', archiveMode ? 'Release' : 'Debug',
  `MARKETING_VERSION=${appVersion}`,
  `PRODUCT_BUNDLE_IDENTIFIER=${bundleId}`
]

if (!archiveMode) {
  console.log('› Сборка для симулятора')
  run('xcodebuild', [
    ...shared,
    '-sdk', 'iphonesimulator',
    '-derivedDataPath', build,
    'CODE_SIGNING_ALLOWED=NO',
    'build'
  ])
  console.log('')
  console.log(`Готово: ${path.join(build, 'Build', 'Products', 'Debug-iphonesimulator', 'Kinetix.app')}`)
  console.log('Открыть в симуляторе: xcrun simctl install booted <путь к Kinetix.app>')
  process.exit(0)
}

if (unsignedIpa) {
  console.log('› Сборка архива без подписи (для SideStore)')
  fs.mkdirSync(build, { recursive: true })
  fs.rmSync(archive, { recursive: true, force: true })
  run('xcodebuild', [
    ...shared,
    '-destination', 'generic/platform=iOS',
    '-archivePath', archive,
    'CODE_SIGNING_ALLOWED=NO',
    'CODE_SIGNING_REQUIRED=NO',
    'CODE_SIGN_IDENTITY=',
    'archive'
  ])
  const app = path.join(archive, 'Products', 'Applications', 'Kinetix.app')
  if (!fs.existsSync(app)) throw new Error('Xcode не собрал Kinetix.app')
  const payload = path.join(build, 'Payload')
  fs.rmSync(payload, { recursive: true, force: true })
  fs.mkdirSync(payload, { recursive: true })
  fs.cpSync(app, path.join(payload, 'Kinetix.app'), { recursive: true })
  const output = path.join(root, 'release', 'ios')
  fs.mkdirSync(output, { recursive: true })
  const ipa = path.join(output, 'Kinetix-unsigned.ipa')
  fs.rmSync(ipa, { force: true })
  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', payload, ipa])
  console.log('')
  console.log(`Готово: ${ipa}`)
  console.log('Отправьте .ipa на iPhone и установите через SideStore — подпись выполнит он сам.')
  process.exit(0)
}

const team = process.env.APPLE_TEAM_ID
if (!team) throw new Error('Задайте APPLE_TEAM_ID — идентификатор вашей команды Apple Developer. Без него .ipa не подписать.')

console.log('› Сборка архива для iPhone')
fs.mkdirSync(build, { recursive: true })
fs.rmSync(archive, { recursive: true, force: true })
run('xcodebuild', [
  ...shared,
  '-destination', 'generic/platform=iOS',
  '-archivePath', archive,
  `DEVELOPMENT_TEAM=${team}`,
  'archive'
])

const exportOptions = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>${exportMethod}</string>
  <key>teamID</key>
  <string>${team}</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>stripSwiftSymbols</key>
  <true/>
  <key>compileBitcode</key>
  <false/>
</dict>
</plist>
`
const exportOptionsPath = path.join(build, 'ExportOptions.plist')
fs.writeFileSync(exportOptionsPath, exportOptions)

const output = path.join(root, 'release', 'ios')
fs.rmSync(output, { recursive: true, force: true })
fs.mkdirSync(output, { recursive: true })

console.log('› Экспорт .ipa')
run('xcodebuild', [
  '-exportArchive',
  '-archivePath', archive,
  '-exportPath', output,
  '-exportOptionsPlist', exportOptionsPath
])

const files = fs.readdirSync(output).filter(name => name.endsWith('.ipa'))
if (!files.length) throw new Error('Xcode не создал .ipa — проверьте подпись и профиль устройства.')
console.log('')
console.log(`Готово: ${path.join(output, files[0])}`)
