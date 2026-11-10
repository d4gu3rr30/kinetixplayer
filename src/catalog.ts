export type Artist = { id: string; name: string; tags: string[]; tint: string }
export type Genre = { id: string; label: string; subtitle: string; icon: string; tint: string; tags: string[] }

export const artists: Artist[] = [
  { id: 'the-weeknd', name: 'The Weeknd', tags: ['pop', 'rnb', 'electronic'], tint: '#9b545d' },
  { id: 'billie-eilish', name: 'Billie Eilish', tags: ['pop', 'indie', 'electronic'], tint: '#607b6c' },
  { id: 'daft-punk', name: 'Daft Punk', tags: ['electronic', 'house', 'pop'], tint: '#c49b5a' },
  { id: 'arctic-monkeys', name: 'Arctic Monkeys', tags: ['indie', 'rock'], tint: '#84736f' },
  { id: 'kendrick-lamar', name: 'Kendrick Lamar', tags: ['hiphop', 'rnb'], tint: '#95705c' },
  { id: 'lana-del-rey', name: 'Lana Del Rey', tags: ['pop', 'indie', 'ambient'], tint: '#a0879b' },
  { id: 'tyler-the-creator', name: 'Tyler, The Creator', tags: ['hiphop', 'indie'], tint: '#bd9956' },
  { id: 'tame-impala', name: 'Tame Impala', tags: ['indie', 'rock', 'electronic'], tint: '#8277ac' },
  { id: 'dua-lipa', name: 'Dua Lipa', tags: ['pop', 'house'], tint: '#b97684' },
  { id: 'radiohead', name: 'Radiohead', tags: ['rock', 'indie', 'ambient'], tint: '#778899' },
  { id: 'frank-ocean', name: 'Frank Ocean', tags: ['rnb', 'indie'], tint: '#769c82' },
  { id: 'fred-again', name: 'Fred again..', tags: ['electronic', 'house', 'ambient'], tint: '#6f91a7' },
  { id: 'oasis', name: 'Oasis', tags: ['rock', 'indie'], tint: '#967f73' },
  { id: 'sza', name: 'SZA', tags: ['rnb', 'pop'], tint: '#b58368' },
  { id: 'gorillaz', name: 'Gorillaz', tags: ['indie', 'hiphop', 'electronic'], tint: '#798e93' },
  { id: 'charli-xcx', name: 'Charli xcx', tags: ['pop', 'electronic'], tint: '#a3af4e' },
  { id: 'aphex-twin', name: 'Aphex Twin', tags: ['electronic', 'ambient', 'techno'], tint: '#936668' },
  { id: 'massive-attack', name: 'Massive Attack', tags: ['electronic', 'ambient', 'rnb'], tint: '#7b7289' },
  { id: 'drake', name: 'Drake', tags: ['hiphop', 'rnb', 'pop'], tint: '#8b7975' },
  { id: 'kanye-west', name: 'Ye', tags: ['hiphop', 'electronic'], tint: '#a3846a' },
  { id: 'nina-simone', name: 'Nina Simone', tags: ['jazz', 'classical', 'rnb'], tint: '#8a6f86' },
  { id: 'miles-davis', name: 'Miles Davis', tags: ['jazz', 'ambient'], tint: '#7b91a0' },
  { id: 'hans-zimmer', name: 'Hans Zimmer', tags: ['classical', 'ambient'], tint: '#849374' },
  { id: 'nils-frahm', name: 'Nils Frahm', tags: ['classical', 'ambient', 'electronic'], tint: '#9a8d78' },
  { id: 'bonobo', name: 'Bonobo', tags: ['electronic', 'ambient', 'jazz'], tint: '#688a8b' },
  { id: 'flume', name: 'Flume', tags: ['electronic', 'pop'], tint: '#8f7aa8' },
  { id: 'bicep', name: 'Bicep', tags: ['electronic', 'house', 'techno'], tint: '#708f9e' },
  { id: 'four-tet', name: 'Four Tet', tags: ['electronic', 'house', 'ambient'], tint: '#777e9c' },
  { id: 'metallica', name: 'Metallica', tags: ['rock'], tint: '#8f6d70' },
  { id: 'paramore', name: 'Paramore', tags: ['rock', 'pop', 'indie'], tint: '#bc846d' },
  { id: 'm83', name: 'M83', tags: ['electronic', 'ambient', 'indie'], tint: '#7e85ae' },
  { id: 'men-i-trust', name: 'Men I Trust', tags: ['indie', 'pop', 'lofi'], tint: '#81a097' },
  { id: 'joji', name: 'Joji', tags: ['rnb', 'lofi', 'pop'], tint: '#8d7993' },
  { id: 'mac-miller', name: 'Mac Miller', tags: ['hiphop', 'jazz', 'lofi'], tint: '#a88b73' },
  { id: 'molchat-doma', name: 'Молчат Дома', tags: ['indie', 'rock', 'electronic'], tint: '#82818b' },
  { id: 'scriptonite', name: 'Скриптонит', tags: ['hiphop', 'rnb'], tint: '#987868' },
  { id: 'monetochka', name: 'Монеточка', tags: ['pop', 'indie'], tint: '#aa9095' },
  { id: 'kedr-livanskiy', name: 'Кедр Ливанский', tags: ['electronic', 'house', 'indie'], tint: '#797ca4' },
  { id: 'ic3peak', name: 'IC3PEAK', tags: ['electronic', 'indie'], tint: '#7a8f9e' },
  { id: 'zemfira', name: 'Земфира', tags: ['rock', 'indie', 'pop'], tint: '#a07883' },
]

export const genres: Genre[] = [
  { id: 'electronic', label: 'Электроника', subtitle: 'Пульс будущего', icon: '◈', tint: '#326fc4', tags: ['synthwave', 'glitch', 'idm', 'bass'] },
  { id: 'hiphop', label: 'Хип-хоп', subtitle: 'Ритм улиц', icon: '✳', tint: '#bf603e', tags: ['trap', 'boom bap', 'drill', 'old school'] },
  { id: 'indie', label: 'Инди', subtitle: 'Своя волна', icon: '✦', tint: '#7955b7', tags: ['shoegaze', 'dream pop', 'garage', 'bedroom'] },
  { id: 'pop', label: 'Поп', subtitle: 'Ярче каждый день', icon: '✺', tint: '#ba4f91', tags: ['dance pop', 'synth pop', 'hyperpop', 'ballads'] },
  { id: 'rock', label: 'Рок', subtitle: 'Громче внутри', icon: '⚡', tint: '#b54847', tags: ['garage rock', 'post punk', 'grunge', 'metal'] },
  { id: 'ambient', label: 'Эмбиент', subtitle: 'Пространство звука', icon: '◌', tint: '#2a8e92', tags: ['drone', 'cinematic', 'space', 'sleep'] },
  { id: 'house', label: 'Хаус', subtitle: 'Ночь в движении', icon: '⌁', tint: '#bd862e', tags: ['deep house', 'tech house', 'disco', 'garage'] },
  { id: 'jazz', label: 'Джаз', subtitle: 'Свобода в нотах', icon: '♫', tint: '#7c5ab1', tags: ['cool jazz', 'bebop', 'soul jazz', 'fusion'] },
  { id: 'rnb', label: 'R&B', subtitle: 'Мягкий грув', icon: '✿', tint: '#b65c79', tags: ['neo soul', 'slow jam', 'funk', 'quiet storm'] },
  { id: 'techno', label: 'Техно', subtitle: 'Чистая энергия', icon: '⟐', tint: '#287c98', tags: ['acid', 'minimal', 'industrial', 'dub techno'] },
  { id: 'classical', label: 'Классика', subtitle: 'Вне времени', icon: '❋', tint: '#888138', tags: ['piano', 'orchestra', 'baroque', 'modern'] },
  { id: 'lofi', label: 'Lo-fi', subtitle: 'Тёплый фон', icon: '☾', tint: '#458763', tags: ['chillhop', 'jazzhop', 'sleep', 'study'] },
]

const artistKey = (name: string) => name.toLocaleLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const artistMap = new Map(artists.map(artist => [artist.id, artist]))
const artistNameMap = new Map(artists.map(artist => [artistKey(artist.name), artist]))
export function artistById(id: string) { return artistMap.get(id) }
export function artistByName(name: string) { return artistNameMap.get(artistKey(name)) }
export function registerArtists(items: Artist[]) { for (const artist of items) { artistMap.set(artist.id, artist); if (artist.name) artistNameMap.set(artistKey(artist.name), artist) } }
export function initialArtistIds() { return [...artists].sort(() => Math.random() - .5).slice(0, 12).map(item => item.id) }
export function similarArtists(selected: string[], visible: string[], limit = 8) {
  const source = selected.map(id => artistMap.get(id)).filter((artist): artist is Artist => Boolean(artist))
  return artists.filter(artist => !visible.includes(artist.id)).map(artist => ({ artist, score: source.reduce((sum, chosen) => sum + artist.tags.filter(tag => chosen.tags.includes(tag)).length, 0) + Math.random() * .2 })).filter(item => item.score > .2).sort((a, b) => b.score - a.score).slice(0, limit).map(item => item.artist.id)
}
