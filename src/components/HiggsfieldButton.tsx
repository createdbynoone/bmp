import React from 'react'

type Status = 'idle' | 'loading' | 'done' | 'error'
export type Provider = 'higgsfield' | 'gemini' | 'poyo'
export type Mode = 'image' | 'video'

const HF_RATIOS = ['9:16', '4:5', '1:1'] as const
const GEMINI_RATIOS = ['9:16', '3:4', '1:1'] as const
const NB2_RATIOS = ['9:16', '4:5', '3:4', '1:1', '16:9'] as const
const HF_RESOLUTIONS = ['1k', '2k'] as const
const IMAGE_RESOLUTIONS = ['1k', '2k', '4k'] as const

const VIDEO_RATIOS = ['9:16', '16:9', '1:1', 'auto'] as const
const VIDEO_RESOLUTIONS = ['720p', '1080p', '4k'] as const
const VIDEO_DURATIONS = [5, 10, 15] as const

const VARIATIONS = [1, 2, 3, 4] as const
type Variations = typeof VARIATIONS[number]

interface HiggsfieldButtonProps {
  status: Status
  onClick: () => void
  disabled: boolean
  mode: Mode

  // image
  provider: Provider
  onProvider: (p: Provider) => void
  aspectRatio: string
  onAspectRatio: (r: string) => void
  resolution: string
  onResolution: (r: string) => void
  variations: Variations
  onVariations: (v: Variations) => void

  // video
  videoModel: 'seedance-2' | 'seedance-2-fast'
  onVideoModel: (m: 'seedance-2' | 'seedance-2-fast') => void
  videoAspectRatio: string
  onVideoAspectRatio: (r: string) => void
  videoResolution: string
  onVideoResolution: (r: string) => void
  duration: number
  onDuration: (d: number) => void
  generateAudio: boolean
  onGenerateAudio: (a: boolean) => void
}

function HiggsfieldLogo() {
  return (
    <span className="flex items-center gap-2">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
        <path d="M12 2C9 6 6 9 2 12C6 15 9 18 12 22C15 18 18 15 22 12C18 9 15 6 12 2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/>
        <circle cx="12" cy="12" r="2.5" fill="currentColor"/>
      </svg>
      <span className="font-sans font-semibold text-[14.7px] tracking-wide">Higgsfield</span>
    </span>
  )
}

function GeminiLogo() {
  return (
    <span className="flex items-center gap-2">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
        <path d="M12 2C12 2 14.5 9.5 22 12C14.5 14.5 12 22 12 22C12 22 9.5 14.5 2 12C9.5 9.5 12 2 12 2Z" fill="currentColor"/>
      </svg>
      <span className="font-sans font-semibold text-[14.7px] tracking-wide">Gemini</span>
    </span>
  )
}

function NanoBananaLogo() {
  return (
    <span className="flex items-center gap-2">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
        <path d="M4 17C4 17 4 7 12 7C20 7 20 17 20 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
        <path d="M8 17C8 17 8 11 12 11C16 11 16 17 16 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
      </svg>
      <span className="font-sans font-semibold text-[14.7px] tracking-wide">Nano Banana</span>
    </span>
  )
}

function SeedanceLogo() {
  return (
    <span className="flex items-center gap-2">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
        <path d="M12 3C7 3 3 7 3 12s4 9 9 9 9-4 9-9-4-9-9-9z" stroke="currentColor" strokeWidth="1.6"/>
        <path d="M8 12c0-2.2 1.8-4 4-4s4 1.8 4 4-1.8 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
        <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
      </svg>
      <span className="font-sans font-semibold text-[14.7px] tracking-wide">Seedance 2</span>
    </span>
  )
}

function Pill({ active, disabled: dis, onClick: h, children }: { active: boolean; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={h} disabled={dis} className={`px-2.5 py-[7px] rounded-md text-[11.7px] font-mono font-semibold tracking-wide border transition-all duration-150 ${active ? 'border-white/50 bg-white/10 text-white' : 'border-border bg-transparent text-text-muted hover:border-white/25 hover:text-white/70'} ${dis ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}>
      {children}
    </button>
  )
}

function AccentPill({ active, disabled: dis, onClick: h, children }: { active: boolean; disabled: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={h} disabled={dis} className={`px-2.5 py-[7px] rounded-md text-[11.7px] font-mono font-semibold tracking-wide border transition-all duration-150 ${active ? 'border-accent/70 bg-accent/10 text-accent' : 'border-border bg-transparent text-text-muted hover:border-accent/30 hover:text-accent/60'} ${dis ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}>
      {children}
    </button>
  )
}

export function HiggsfieldButton({
  status, onClick, disabled, mode,
  provider, onProvider, aspectRatio, onAspectRatio, resolution, onResolution, variations, onVariations,
  videoModel, onVideoModel, videoAspectRatio, onVideoAspectRatio, videoResolution, onVideoResolution, duration, onDuration, generateAudio, onGenerateAudio,
}: HiggsfieldButtonProps) {
  const isLoading = status === 'loading'
  const div = <div className="w-px h-4 bg-border flex-shrink-0" />

  return (
    <div className="flex items-center gap-2">
      {mode === 'image' ? (
        <>
          {/* Provider */}
          <div className="flex items-center bg-white/5 border border-border rounded-md p-[3px] flex-shrink-0">
            {(['higgsfield', 'gemini', 'poyo'] as Provider[]).map((p) => (
              <button key={p} onClick={() => onProvider(p)} disabled={isLoading} className={`px-2.5 py-[5px] rounded-[4px] text-[11px] font-heading font-semibold uppercase tracking-widest transition-all duration-150 ${provider === p ? 'bg-white/15 text-white' : 'text-text-muted hover:text-white/60'} ${isLoading ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}>
                {p === 'higgsfield' ? 'HF' : p === 'gemini' ? 'AI' : 'NB2'}
              </button>
            ))}
          </div>
          {div}
          <div className="flex items-center gap-1 flex-shrink-0">
            {(provider === 'higgsfield' ? HF_RATIOS : provider === 'gemini' ? GEMINI_RATIOS : NB2_RATIOS).map((r) => (
              <Pill key={r} active={aspectRatio === r} disabled={isLoading} onClick={() => onAspectRatio(r)}>{r}</Pill>
            ))}
          </div>
          {div}
          <div className="flex items-center gap-1 flex-shrink-0">
            {(provider === 'higgsfield' ? HF_RESOLUTIONS : IMAGE_RESOLUTIONS).map((r) => (
              <AccentPill key={r} active={resolution === r} disabled={isLoading} onClick={() => onResolution(r)}>{r.toUpperCase()}</AccentPill>
            ))}
          </div>
          {div}
          <div className="flex items-center gap-1 flex-shrink-0">
            {VARIATIONS.map((v) => (
              <Pill key={v} active={variations === v} disabled={isLoading} onClick={() => onVariations(v)}>×{v}</Pill>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* Video model */}
          <div className="flex items-center bg-white/5 border border-border rounded-md p-[3px] flex-shrink-0">
            {(['seedance-2', 'seedance-2-fast'] as const).map((m) => (
              <button key={m} onClick={() => onVideoModel(m)} disabled={isLoading} className={`px-2.5 py-[5px] rounded-[4px] text-[11px] font-heading font-semibold uppercase tracking-widest transition-all duration-150 ${videoModel === m ? 'bg-white/15 text-white' : 'text-text-muted hover:text-white/60'} ${isLoading ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}>
                {m === 'seedance-2' ? 'PRO' : 'FAST'}
              </button>
            ))}
          </div>
          {div}
          <div className="flex items-center gap-1 flex-shrink-0">
            {VIDEO_RATIOS.map((r) => (
              <Pill key={r} active={videoAspectRatio === r} disabled={isLoading} onClick={() => onVideoAspectRatio(r)}>{r}</Pill>
            ))}
          </div>
          {div}
          <div className="flex items-center gap-1 flex-shrink-0">
            {VIDEO_RESOLUTIONS.map((r) => (
              <AccentPill key={r} active={videoResolution === r} disabled={isLoading} onClick={() => onVideoResolution(r)}>{r.toUpperCase()}</AccentPill>
            ))}
          </div>
          {div}
          <div className="flex items-center gap-1 flex-shrink-0">
            {VIDEO_DURATIONS.map((d) => (
              <Pill key={d} active={duration === d} disabled={isLoading} onClick={() => onDuration(d)}>{d}s</Pill>
            ))}
          </div>
          {div}
          <button onClick={() => onGenerateAudio(!generateAudio)} disabled={isLoading} title={generateAudio ? 'Audio ON' : 'Audio OFF'} className={`px-2 py-[7px] rounded-md text-[13px] border transition-all duration-150 ${generateAudio ? 'border-accent/70 bg-accent/10 text-accent' : 'border-border text-text-muted hover:border-white/25'} ${isLoading ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}`}>
            {generateAudio ? '🔊' : '🔇'}
          </button>
        </>
      )}

      {/* Fire button */}
      <button
        onClick={onClick}
        disabled={disabled || isLoading}
        className={`flex-1 flex items-center justify-center gap-2 py-[7px] px-4 rounded-lg border transition-all duration-150 ${isLoading ? 'border-white/15 bg-white/5 text-white/40 cursor-not-allowed' : status === 'done' ? 'border-green-500/40 bg-green-500/5 text-green-400 hover:bg-green-500/10 cursor-pointer' : status === 'error' ? 'border-red-500/40 bg-red-500/5 text-red-400 hover:bg-red-500/10 cursor-pointer' : disabled ? 'border-border bg-transparent text-text-muted cursor-not-allowed opacity-40' : 'border-white/20 bg-white/5 text-white hover:bg-white/10 hover:border-white/40 active:scale-[0.99] cursor-pointer'}`}
      >
        {isLoading ? (
          <>
            <svg className="animate-spin flex-shrink-0" width="12" height="12" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="8 6" strokeLinecap="round"/>
            </svg>
            <span className="text-[12.7px] font-heading font-semibold uppercase tracking-widest">
              {mode === 'video' ? 'Generating video...' : 'Generating...'}
            </span>
          </>
        ) : status === 'done' ? (
          <>
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
              <path d="M2 7l3.5 3.5 6.5-6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="text-[12.7px] font-heading font-semibold uppercase tracking-widest">Done</span>
          </>
        ) : status === 'error' ? (
          <span className="text-[12.7px] font-heading font-semibold uppercase tracking-widest text-red-400">Error — retry</span>
        ) : mode === 'video' ? (
          <SeedanceLogo />
        ) : provider === 'higgsfield' ? (
          <>
            <HiggsfieldLogo />
            {variations > 1 && <span className="text-[11.7px] font-mono text-white/40 ml-1">×{variations}</span>}
          </>
        ) : provider === 'gemini' ? (
          <>
            <GeminiLogo />
            {variations > 1 && <span className="text-[11.7px] font-mono text-white/40 ml-1">×{variations}</span>}
          </>
        ) : (
          <NanoBananaLogo />
        )}
      </button>
    </div>
  )
}
