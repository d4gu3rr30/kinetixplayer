export type Track = {
  id: string
  title: string
  artist: string
  artwork?: string
  url?: string
  streamUrl?: string
  license?: string
  duration?: number
  fullDuration?: number
  preview?: boolean
  source: 'soundcloud' | 'archive' | 'audius' | 'local' | 'youtube' | 'yandex' | 'vk'
  blob?: Blob
  folder?: string
  offlineKey?: string
}

export type Playlist = {
  id: string
  name: string
  description: string
  cover: string
  isPublic: boolean
  tracks: Track[]
  createdAt: string
  updatedAt: string
}

export type PlaylistSummary = {
  id: string
  name: string
  description: string
  cover: string
  isPublic: boolean
  trackCount: number
  duration: number
  owner: { name: string; avatar: string }
  createdAt: string
  updatedAt: string
  tracks: Track[]
}

export type ExternalPlaylistSummary = {
  id: string
  source: 'youtube' | 'soundcloud' | string
  title: string
  owner: string
  artwork: string
  url: string
  trackCount?: number
  description?: string
}

export type ExternalPlaylist = {
  id?: string
  source: 'youtube' | 'soundcloud' | 'kinetix' | string
  title: string
  owner: string
  artwork: string
  url: string
  trackCount?: number
  description?: string
  isPublic?: boolean
  tracks: Track[]
}
