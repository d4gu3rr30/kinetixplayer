import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const android = path.join(root, 'android')
const build = path.join(android, 'build')
const web = path.join(android, 'assets', 'www')
const release = path.join(root, 'release')

const q = value => `"${value}"`
function run(command, options = {}) {
  const result = spawnSync(command, { shell: true, stdio: 'inherit', cwd: options.cwd || root })
  if (result.status !== 0) throw new Error(`Команда завершилась с кодом ${result.status}: ${command}`)
}
function probe(command) {
  const result = spawnSync(command, { shell: true, stdio: 'ignore', cwd: root })
  return result.status === 0
}

function sdkRoot() {
  for (const candidate of [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, path.join(root, 'android-sdk')]) {
    if (candidate && fs.existsSync(candidate)) return candidate
  }
  throw new Error('Android SDK не найден. Установите SDK или задайте ANDROID_HOME.')
}

function jdkRoot() {
  if (process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) return process.env.JAVA_HOME
  const base = 'C:\\Program Files\\Eclipse Adoptium'
  if (fs.existsSync(base)) {
    const entries = fs.readdirSync(base).filter(name => name.toLowerCase().startsWith('jdk-')).sort().reverse()
    if (entries.length) return path.join(base, entries[0])
  }
  throw new Error('JDK 17 не найден. Задайте JAVA_HOME.')
}

function sevenZip() {
  for (const candidate of [process.env.SEVEN_ZIP, 'C:\\Program Files\\7-Zip\\7z.exe', '7z']) {
    if (!candidate) continue
    if (candidate === '7z' ? probe('7z') : fs.existsSync(candidate)) return candidate
  }
  throw new Error('7-Zip не найден. Установите 7-Zip.')
}

const sdk = sdkRoot()
const buildTools = path.join(sdk, 'build-tools', '35.0.0')
const platform = path.join(sdk, 'platforms', 'android-35', 'android.jar')
const adb = path.join(sdk, 'platform-tools', 'adb.exe')
const jdk = jdkRoot()
const apksigner = path.join(buildTools, 'apksigner.bat')
const aapt2 = path.join(buildTools, 'aapt2.exe')
const zipalign = path.join(buildTools, 'zipalign.exe')
const d8 = path.join(buildTools, 'd8.bat')
const keytool = path.join(jdk, 'bin', 'keytool.exe')
const javac = path.join(jdk, 'bin', 'javac.exe')
const archive = sevenZip()

for (const [label, target] of [['build-tools 35.0.0', buildTools], ['android.jar', platform], ['aapt2', aapt2], ['apksigner', apksigner], ['zipalign', zipalign], ['d8', d8], ['javac', javac]]) {
  if (!fs.existsSync(target)) throw new Error(`Не найдено: ${label} (${target})`)
}

const appVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || '1.0'
const apkName = `Kinetix-${appVersion.replace(/\.0$/, '')}-android.apk`

console.log('› Сборка веб-приложения')
run('npm run build')

console.log('› Копирование ассетов в APK')
fs.rmSync(web, { recursive: true, force: true })
fs.cpSync(path.join(root, 'dist'), web, { recursive: true })
if (!fs.existsSync(path.join(web, 'index.html'))) throw new Error('dist/index.html не собран')

fs.rmSync(build, { recursive: true, force: true })
fs.mkdirSync(build, { recursive: true })

console.log('› Компиляция ресурсов')
run(`${q(aapt2)} compile --dir ${q(path.join(android, 'res'))} -o ${q(path.join(build, 'res.zip'))}`)

console.log('› Линковка APK')
run([
  q(aapt2), 'link',
  '-o', q(path.join(build, 'base.apk')),
  '-I', q(platform),
  '--manifest', q(path.join(android, 'AndroidManifest.xml')),
  '-A', q(path.join(android, 'assets')),
  '--java', q(path.join(build, 'gen')),
  '--min-sdk-version', '26',
  '--target-sdk-version', '34',
  '--version-code', '1',
  '--version-name', appVersion,
  q(path.join(build, 'res.zip')),
].join(' '))

normalizeZipNames(path.join(build, 'base.apk'))

// aapt2 на Windows пишет имена assets с обратными слэшами, и AssetManager их не находит.
function normalizeZipNames(file) {
  const buffer = fs.readFileSync(file)
  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0 || eocd + 22 > buffer.length) throw new Error('APK: не найдено оглавление ZIP')
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  if (offset === 0xffffffff) throw new Error('APK: ZIP64 не поддерживается')
  const patch = (start, length) => {
    for (let index = 0; index < length; index++) {
      if (buffer[start + index] === 0x5c) buffer[start + index] = 0x2f
    }
  }
  for (let index = 0; index < count; index++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('APK: повреждён центральный каталог')
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    patch(offset + 46, nameLength)
    if (buffer.readUInt32LE(localOffset) === 0x04034b50) {
      patch(localOffset + 30, buffer.readUInt16LE(localOffset + 26))
    }
    offset += 46 + nameLength + extraLength + commentLength
  }
  fs.writeFileSync(file, buffer)
}

function javaSources(dir) {
  const result = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) result.push(...javaSources(full))
    else if (entry.name.endsWith('.java')) result.push(full)
  }
  return result
}

const sources = [...javaSources(path.join(android, 'src')), ...javaSources(path.join(build, 'gen'))]
console.log(`› Компиляция Java (${sources.length} файлов)`)
fs.mkdirSync(path.join(build, 'classes'), { recursive: true })
run(`${q(javac)} -encoding UTF-8 -source 11 -target 11 -classpath ${q(platform)} -d ${q(path.join(build, 'classes'))} ${sources.map(q).join(' ')}`)

function classFiles(dir) {
  const result = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) result.push(...classFiles(full))
    else if (entry.name.endsWith('.class')) result.push(full)
  }
  return result
}

console.log('› Dex-сборка')
const classes = classFiles(path.join(build, 'classes'))
const dexOut = path.join(build, 'dex')
fs.mkdirSync(dexOut, { recursive: true })
run(`${q(d8)} --min-api 26 --lib ${q(platform)} --output ${q(dexOut)} ${classes.map(q).join(' ')}`)
if (!fs.existsSync(path.join(dexOut, 'classes.dex'))) throw new Error('D8 не создал classes.dex')

console.log('› Упаковка')
fs.copyFileSync(path.join(build, 'base.apk'), path.join(build, 'unsigned.apk'))
run(`${q(archive)} a -tzip ${q(path.join(build, 'unsigned.apk'))} classes.dex`, { cwd: dexOut })
run(`${q(zipalign)} -f 4 ${q(path.join(build, 'unsigned.apk'))} ${q(path.join(build, 'aligned.apk'))}`)

const keystore = path.join(android, 'kinetix-debug.jks')
if (!fs.existsSync(keystore)) {
  console.log('› Создание debug-ключа')
  run(`${q(keytool)} -genkeypair -keystore ${q(keystore)} -storepass kinetixdebug -keypass kinetixdebug -alias kinetix -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Kinetix Debug, OU=Kinetix, O=Kinetix, L=Local, C=RU"`)
}

fs.mkdirSync(release, { recursive: true })
const apk = path.join(release, apkName)
console.log('› Подпись APK')
run(`${q(apksigner)} sign --ks ${q(keystore)} --ks-key-alias kinetix --ks-pass pass:kinetixdebug --key-pass pass:kinetixdebug --out ${q(apk)} ${q(path.join(build, 'aligned.apk'))}`)

console.log('› Проверка подписи и манифеста')
run(`${q(apksigner)} verify --verbose ${q(apk)}`)
run(`${q(aapt2)} dump badging ${q(apk)}`)

const size = (fs.statSync(apk).size / 1024 / 1024).toFixed(1)
console.log(`\nAPK готов: ${apk} (${size} МБ)`)

if (fs.existsSync(adb)) {
  const devices = spawnSync(`${q(adb)} devices`, { shell: true, encoding: 'utf8' }).stdout || ''
  const attached = devices.split(/\r?\n/).slice(1).filter(line => /\t(device|emulator)$/.test(line.trim()) || /\sdevice$/.test(line.trim()))
  if (attached.length) {
    console.log('› Устройство найдено, устанавливаем')
    run(`${q(adb)} install -r ${q(apk)}`)
    console.log('Установлено. Запустите Kinetix на устройстве.')
  } else {
    console.log('Устройство или эмулятор не подключены — APK лежит в release/.')
  }
}
