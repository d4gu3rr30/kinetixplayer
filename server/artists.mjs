import { deezerArtist, deezerArtistRelated, resolveDeezerArtist, sameArtistName, searchArtistEntities } from './deezer.mjs'
import { curatedArtists, curatedById } from './curated.mjs'

const endpoints = { en: 'https://en.wikipedia.org/w/api.php', ru: 'https://ru.wikipedia.org/w/api.php' }
const categories = { all: 'musician OR singer OR band', pop: 'pop singer', rock: 'rock musician', hiphop: 'hip hop rapper', indie: 'indie musician', electronic: 'electronic music producer', jazz: 'jazz musician', classical: 'classical musician', rnb: 'rhythm and blues singer', ambient: 'ambient musician', house: 'house music producer', techno: 'techno musician', lofi: 'lofi musician', phonk: 'phonk producer' }
const languages = { all: '', en: 'English-language', es: 'Spanish-language', fr: 'French-language', ko: 'Korean-language', ja: 'Japanese-language' }
const russianCategories = {
  all: ['Певцы и певицы России', 'Рэперы России', 'Рок-музыканты России', 'Поп-музыканты России', 'Рок-группы России', 'Поп-группы России'],
  pop: ['Поп-музыканты России', 'Поп-группы России', 'Певцы и певицы России'],
  rock: ['Рок-музыканты России', 'Рок-группы России'],
  hiphop: ['Рэперы России'],
}
const tints = { pop: '#ba4f91', rock: '#b54847', hiphop: '#bf603e', indie: '#7955b7', electronic: '#326fc4', jazz: '#7c5ab1', classical: '#888138', rnb: '#b65c79', ambient: '#2a8e92', house: '#bd862e', techno: '#287c98', lofi: '#458763', phonk: '#8f4a5d' }
const popularRu = ['Алла Пугачёва', 'Земфира', 'Дима Билан', 'Сергей Лазарев', 'Полина Гагарина', 'Леонид Агутин', 'Валерий Меладзе', 'Филипп Киркоров', 'Баста', 'Моргенштерн', 'Егор Крид', 'Макс Корж', 'Монеточка', 'Оксимирон', 'Скриптонит', 'Алсу', 'Ирина Аллегрова', 'Жанна Агузарова']
const cache = new Map()
const cleanName = value => String(value || '').toLocaleLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

function curatedMatches({ genre = 'all', language = 'all', query = '' }) {
  const wanted = cleanName(query)
  return curatedArtists.filter(item => {
    if (language !== 'all' && item.language !== language) return false
    if (genre !== 'all' && !item.tags.includes(genre)) return false
    if (wanted && !cleanName(item.name).includes(wanted) && !cleanName(item.name).split(' ').some(word => word.startsWith(wanted))) return false
    return true
  }).map(({ id, name, tags, tint, description, popularity, language: itemLanguage }) => ({ id, name, tags, tint, description, popularity, language: itemLanguage }))
}

function mergeArtists(...lists) {
  const seen = new Set()
  const result = []
  for (const list of lists) for (const item of list) {
    const key = cleanName(item?.name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

async function curatedAndDeezer(genre, language, query) {
  const curated = curatedMatches({ genre, language, query })
  if (!query) return curated
  const discovered = await searchArtistEntities(query, { limit: 24 }).catch(() => [])
  return mergeArtists(curated, discovered)
}

async function wiki(params, locale = 'en') {
  const url = new URL(endpoints[locale])
  url.search = new URLSearchParams({ action: 'query', format: 'json', prop: 'pageimages|description', piprop: 'thumbnail|name', pithumbsize: '500', ...params }).toString()
  const key = url.href
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return cached.data
  const response = await fetch(url, { headers: { 'user-agent': 'KinetixPlayer/1.0 (artist discovery; contact via repository)' }, signal: AbortSignal.timeout(12000) })
  if (!response.ok) throw new Error('Каталог исполнителей временно недоступен')
  const data = await response.json()
  cache.set(key, { data, expires: Date.now() + 10 * 60_000 })
  return data
}

function artist(page, genre, locale = 'en', trustedCategory = false) {
  if (!page?.pageid || !page?.title || page.ns !== 0) return null
  const description = String(page.description || '')
  const isArtist = locale === 'ru'
    ? /пев[еи]ц|певица|музыкант|рэпер|рок-группа|поп-группа|музыкальная группа|исполнитель|композитор|вокалист/i.test(description)
    : /singer|musician|band|rapper|composer|duo|music group|disc jockey|producer|songwriter|guitarist|pianist|recording artist|musical artist/i.test(description)
  if (!isArtist && !trustedCategory) return null
  const source = page.pageimage && page.thumbnail?.source?.includes('/wikipedia/commons/') ? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(page.pageimage.replace(/^File:/, ''))}` : `https://${locale}.wikipedia.org/?curid=${page.pageid}`
  const inferred = locale === 'ru'
    ? [/рок/i.test(description) && 'rock', /рэп|хип-хоп/i.test(description) && 'hiphop', /поп/i.test(description) && 'pop', /электрон/i.test(description) && 'electronic', /джаз/i.test(description) && 'jazz'].filter(Boolean)
    : Object.keys(categories).filter(key => key !== 'all' && new RegExp(categories[key].split(' ')[0], 'i').test(description))
  const name = locale === 'ru' && page.title.includes(', ') ? `${page.title.split(', ')[1].split(' ')[0]} ${page.title.split(', ')[0]}` : page.title
  const popularIndex = popularRu.indexOf(name)
  return { id: `${locale === 'ru' ? 'ruwiki' : 'wiki'}-${page.pageid}`, name, tags: genre === 'all' ? (inferred.length ? inferred : ['all']) : [genre], tint: tints[genre] || '#768b76', image: page.thumbnail?.source, imageSource: source, description, language: locale, popularity: popularIndex < 0 ? 0 : 900 - popularIndex * 25 }
}

function readCursor(cursor) {
  try { const data = JSON.parse(Buffer.from(cursor, 'base64url').toString()); return Number.isInteger(data.index) && data.index >= 0 && data.index < 10 && typeof data.next === 'string' && data.next.length < 400 ? data : null } catch { return null }
}
const writeCursor = data => Buffer.from(JSON.stringify(data)).toString('base64url')

export async function discoverArtists({ genre = 'all', language = 'all', cursor = '', query = '' }) {
  if (!categories[genre]) genre = 'all'
  const curated = await curatedAndDeezer(genre, language, query)
  if (language === 'ru') {
    if (query) {
      const params = { generator: 'search', gsrsearch: query.slice(0, 70), gsrlimit: '50' }
      if (/^\d{1,5}$/.test(cursor)) params.gsroffset = cursor
      const data = await wiki(params, 'ru')
      const found = Object.values(data.query?.pages || {}).map(page => artist(page, genre, 'ru')).filter(Boolean)
      return { artists: mergeArtists(!cursor ? curated : [], found), cursor: data.continue?.gsroffset ? String(data.continue.gsroffset) : null }
    }
    const list = russianCategories[genre] || russianCategories.all
    const state = readCursor(cursor) || { index: 0, next: '' }
    if (state.index >= list.length) return { artists: !cursor ? curated : [], cursor: null }
    const found = []
    if (!cursor && genre === 'all') {
      try { const seeds = await wiki({ titles: popularRu.join('|') }, 'ru'); found.push(...Object.values(seeds.query?.pages || {}).map(item => artist(item, genre, 'ru')).filter(Boolean)) } catch { /* Category pages still provide artists. */ }
    }
    for (let page = 0; page < 3 && state.index < list.length; page++) {
      const params = { generator: 'categorymembers', gcmtitle: `Категория:${list[state.index]}`, gcmtype: 'page', gcmlimit: '50' }
      if (state.next) params.gcmcontinue = state.next
      const data = await wiki(params, 'ru')
      found.push(...Object.values(data.query?.pages || {}).map(item => artist(item, genre, 'ru', true)).filter(Boolean))
      if (data.continue?.gcmcontinue) state.next = data.continue.gcmcontinue
      else { state.index++; state.next = '' }
    }
    const sorted = [...new Map(found.map(item => [item.id, item])).values()].sort((a, b) => b.popularity - a.popularity || Number(Boolean(b.image)) - Number(Boolean(a.image)))
    return { artists: mergeArtists(!cursor ? curated : [], sorted), cursor: state.index < list.length ? writeCursor(state) : null }
  }
  if (!(language in languages)) language = 'all'
  const category = genre === 'all' ? '(musician OR singer OR band)' : `"${categories[genre]}"`
  const languageCategory = language === 'all' ? '' : `Category:${languages[language]} singers`
  const params = languageCategory && !query && genre === 'all'
    ? { generator: 'categorymembers', gcmtitle: languageCategory, gcmtype: 'page', gcmlimit: '50' }
    : { generator: 'search', gsrsearch: `${query ? query.slice(0, 70) : category} ${languageCategory ? `incategory:"${languages[language]} singers"` : query ? '(musician OR singer OR band OR rapper)' : ''}`.trim(), gsrlimit: query ? '35' : '50' }
  if (cursor && cursor.length < 300) {
    if (params.generator === 'categorymembers') params.gcmcontinue = cursor
    else if (/^\d{1,5}$/.test(cursor)) params.gsroffset = cursor
  }
  const data = await wiki(params)
  const found = Object.values(data.query?.pages || {}).map(page => artist(page, genre)).filter(Boolean)
  return { artists: mergeArtists(!cursor ? curated : [], found), cursor: data.continue?.gcmcontinue || (data.continue?.gsroffset ? String(data.continue.gsroffset) : null) }
}

const lookupTints = ['#9b545d', '#607b6c', '#c49b5a', '#84736f', '#95705c', '#a0879b', '#bd9956', '#8277ac', '#b97684', '#778899', '#769c82', '#6f91a7', '#967f73', '#b58368', '#798e93', '#a3af4e']
function lookupTint(value) { let hash = 0; for (const char of String(value || '')) hash = (hash * 31 + char.codePointAt(0)) >>> 0; return lookupTints[hash % lookupTints.length] }

const relatedCache = new Map()
export async function relatedArtists({ name = '', deezerId = '', limit = 8 }) {
  const key = `${deezerId || ''}|${cleanName(name)}|${limit}`
  const cached = relatedCache.get(key)
  if (cached && cached.expires > Date.now()) return cached.data
  const artist = await resolveDeezerArtist(name, deezerId)
  const found = await deezerArtistRelated(artist.id)
  const artists = (found.data || []).slice(0, limit).map(item => ({
    id: `deezer-${item.id}`,
    name: item.name,
    tags: ['all'],
    tint: lookupTint(item.name),
    image: item.picture_xl || item.picture_big || item.picture_medium || '',
    imageSource: item.link || '',
    description: `${Number(item.nb_fan) || 0} слушателей · ${Number(item.nb_album) || 0} релизов`,
    language: 'all',
    popularity: Number(item.nb_fan) || 0,
    fans: Number(item.nb_fan) || 0,
    albums: Number(item.nb_album) || 0,
  })).filter(item => item.name && item.image)
  const data = { artistId: `deezer-${artist.id}`, artistName: artist.name, artists }
  if (relatedCache.size > 180) relatedCache.delete(relatedCache.keys().next().value)
  relatedCache.set(key, { data, expires: Date.now() + 10 * 60_000 })
  return data
}

export async function lookupArtists(ids) {
  const english = ids.filter(id => /^wiki-\d+$/.test(id)).slice(0, 50).map(id => id.slice(5))
  const russian = ids.filter(id => /^ruwiki-\d+$/.test(id)).slice(0, 50).map(id => id.slice(7))
  const deezer = ids.filter(id => /^deezer-\d+$/.test(id)).slice(0, 16).map(id => id.slice(7))
  const curated = ids.filter(id => curatedById.has(id)).slice(0, 16)
  const [englishResult, russianResult, deezerResult, curatedResult] = await Promise.allSettled([
    english.length ? wiki({ pageids: english.join('|') }) : Promise.resolve(null),
    russian.length ? wiki({ pageids: russian.join('|') }, 'ru') : Promise.resolve(null),
    deezer.length ? Promise.allSettled(deezer.map(id => deezerArtist(id))) : Promise.resolve([]),
    curated.length ? Promise.allSettled(curated.map(async id => {
      const entry = curatedById.get(id)
      let details = null
      try { details = await resolveDeezerArtist(entry.name) } catch { /* Index entry still works without a photo. */ }
      const verified = details && sameArtistName(details.name, entry.name) ? details : null
      return {
        id: entry.id,
        name: entry.name,
        tags: entry.tags,
        tint: entry.tint,
        language: entry.language,
        image: verified?.picture_big || verified?.picture_xl || verified?.picture_medium || '',
        imageSource: verified?.link || '',
        description: verified ? `${Number(verified.nb_fan) || 0} слушателей` : entry.description,
        popularity: verified ? Number(verified.nb_fan) || entry.popularity : entry.popularity,
      }
    })) : Promise.resolve([]),
  ])
  const wikiItems = [englishResult, russianResult].flatMap((entry, index) => entry.status === 'fulfilled' && entry.value ? Object.values(entry.value.query?.pages || {}).map(page => artist(page, 'all', index ? 'ru' : 'en', Boolean(index))).filter(Boolean) : [])
  const deezerItems = deezerResult.status === 'fulfilled' && Array.isArray(deezerResult.value)
    ? deezerResult.value.filter(entry => entry.status === 'fulfilled' && entry.value?.id).map(entry => {
      const item = entry.value
      return { id: `deezer-${item.id}`, name: item.name, tags: ['all'], tint: lookupTint(item.name), image: item.picture_medium || item.picture_big || '', imageSource: item.link || '', description: `${Number(item.nb_fan) || 0} слушателей`, language: 'all', popularity: Number(item.nb_fan) || 0 }
    })
    : []
  const curatedItems = curatedResult.status === 'fulfilled' && Array.isArray(curatedResult.value)
    ? curatedResult.value.filter(entry => entry.status === 'fulfilled' && entry.value?.id).map(entry => entry.value)
    : []
  return [...curatedItems, ...wikiItems, ...deezerItems]
}
