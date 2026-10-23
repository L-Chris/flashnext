export const AUDIO_PLAYBACK_PROFILE = 'study-speech-loudness-v1'

export type Playback = {
  id: string; profile: string; sourceSha256: string; sha256: string
  mimeType: string; bytes: number; storageKey: string; metrics: string
}

export const playbackOf = (asset: { sha256?: string; playbacks?: Playback[] }) =>
  asset.playbacks?.find(p => p.profile === AUDIO_PLAYBACK_PROFILE && p.sourceSha256 === asset.sha256)
