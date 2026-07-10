import React from 'react'

type Status = 'idle' | 'loading' | 'done' | 'error'
export type Provider = 'higgsfield' | 'poyo'
export type Mode = 'image' | 'video' | 'model'
export type ModelEngine = 'nb2' | 'recraft'
export type ModelGender = 'female' | 'male'

const IMAGE_RATIOS = ['9:16', '4:5', '1:1', '16:9'] as const
const HF_RESOLUTIONS = ['1k', '2k'] as const
const IMAGE_RESOLUTIONS = ['1k', '2k', '4k'] as const

const VIDEO_RATIOS = ['9:16', '16:9', 'auto'] as const
const VIDEO_RESOLUTIONS = ['720p', '1080p'] as const
const VIDEO_DURATIONS = [5, 10, 15] as const

const VARIATIONS = [1, 2, 3, 4] as const
type Variations = typeof VARIATIONS[number]

interface HiggsfieldButtonProps {
  status: Status
  running: number
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

  // model (AI model creation)
  modelEngine: ModelEngine
  onModelEngine: (e: ModelEngine) => void
  modelAspectRatio: string
  onModelAspectRatio: (r: string) => void
  modelResolution: string
  onModelResolution: (r: string) => void
  modelGender: ModelGender
  onModelGender: (g: ModelGender) => void
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

function RecraftLogo() {
  return (
    <span className="flex items-center gap-2">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
        <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="1.8"/>
        <path d="M8 16V8h4.5a2.75 2.75 0 0 1 0 5.5H8M12 13.5l4 2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      <span className="font-sans font-semibold text-[14.7px] tracking-wide">Recraft v4.1 Pro</span>
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
  status, running, onClick, disabled, mode,
  provider, onProvider, aspectRatio, onAspectRatio, resolution, onResolution, variations, onVariations,
  videoModel, onVideoModel, videoAspectRatio, onVideoAspectRatio, videoResolution, onVideoResolution, duration, onDuration,
  modelEngine, onModelEngine, modelAspectRatio, onModelAspectRatio, modelResolution, onModelResolution, modelGender, onModelGender,
}: HiggsfieldButtonProps) {
  // Running tasks never lock the controls: each fire snapshots its settings,
  // so the user can retune and fire another batch in parallel
  const isLoading = status === 'loading'
  const div = <div className="w-px h-4 bg-border flex-shrink-0" />

  return (
    <div className="flex items-center gap-2">
      {mode === 'image' ? (
        <>
          {/* Provider */}
          <div className="flex items-center bg-white/5 border border-border rounded-md p-[3px] flex-shrink-0">
            {(['higgsfield', 'poyo'] as Provider[]).map((p) => (
              <button key={p} onClick={() => onProvider(p)} className={`px-2.5 py-[5px] rounded-[4px] text-[11px] font-heading font-semibold uppercase tracking-widest transition-all duration-150 cursor-pointer ${provider === p ? 'bg-white/15 text-white' : 'text-text-muted hover:text-white/60'}`}>
                {p === 'higgsfield' ? 'HF' : 'NB2'}
              </button>
            ))}
          </div>
          {div}
          <div className="flex items-center gap-1 flex-shrink-0">
            {IMAGE_RATIOS.map((r) => (
              <Pill key={r} active={aspectRatio === r} disabled={false} onClick={() => onAspectRatio(r)}>{r}</Pill>
            ))}
          </div>
          {div}
          <div className="flex items-center gap-1 flex-shrink-0">
            {(provider === 'higgsfield' ? HF_RESOLUTIONS : IMAGE_RESOLUTIONS).map((r) => (
              <AccentPill key={r} active={resolution === r} disabled={false} onClick={() => onResolution(r)}>{r.toUpperCase()}</AccentPill>
            ))}
          </div>
          {div}
          <div className="flex items-center gap-1 flex-shrink-0">
            {VARIATIONS.map((v) => (
              <Pill key={v} active={variations === v} disabled={false} onClick={() => onVariations(v)}>×{v}</Pill>
            ))}
          </div>
        </>
      ) : mode === 'model' ? (
        <>
          {/* Engine */}
          <div className="flex items-center bg-white/5 border border-border rounded-md p-[3px] flex-shrink-0">
            {(['nb2', 'recraft'] as ModelEngine[]).map((e) => (
              <button key={e} onClick={() => onModelEngine(e)} className={`px-2.5 py-[5px] rounded-[4px] text-[11px] font-heading font-semibold uppercase tracking-widest transition-all duration-150 cursor-pointer ${modelEngine === e ? 'bg-white/15 text-white' : 'text-text-muted hover:text-white/60'}`}>
                {e === 'nb2' ? 'NB2' : 'RECRAFT'}
              </button>
            ))}
          </div>
          {div}
          <div className="flex items-center gap-1 flex-shrink-0">
            {IMAGE_RATIOS.map((r) => (
              <Pill key={r} active={modelAspectRatio === r} disabled={false} onClick={() => onModelAspectRatio(r)}>{r}</Pill>
            ))}
          </div>
          {div}
          {modelEngine === 'nb2' ? (
            <div className="flex items-center gap-1 flex-shrink-0">
              {IMAGE_RESOLUTIONS.map((r) => (
                <AccentPill key={r} active={modelResolution === r} disabled={false} onClick={() => onModelResolution(r)}>{r.toUpperCase()}</AccentPill>
              ))}
            </div>
          ) : (
            <span className="text-[11px] font-mono font-semibold text-accent/70 tracking-wide px-1 flex-shrink-0" title="Recraft v4.1 Pro genera siempre a 4MP">4MP PRO</span>
          )}
          {div}
          {/* SKU gender — decides the SMF/SMM folder the pair is filed under */}
          <div className="flex items-center bg-white/5 border border-border rounded-md p-[3px] flex-shrink-0" title="Categoría SKU: SMF (female) / SMM (male)">
            {(['female', 'male'] as ModelGender[]).map((g) => (
              <button key={g} onClick={() => onModelGender(g)} className={`px-2.5 py-[5px] rounded-[4px] text-[11px] font-heading font-semibold uppercase tracking-widest transition-all duration-150 cursor-pointer ${modelGender === g ? 'bg-accent/20 text-accent' : 'text-text-muted hover:text-white/60'}`}>
                {g === 'female' ? 'SMF' : 'SMM'}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* Video model */}
          <div className="flex items-center bg-white/5 border border-border rounded-md p-[3px] flex-shrink-0">
            {(['seedance-2', 'seedance-2-fast'] as const).map((m) => (
              <button key={m} onClick={() => onVideoModel(m)} className={`px-2.5 py-[5px] rounded-[4px] text-[11px] font-heading font-semibold uppercase tracking-widest transition-all duration-150 cursor-pointer ${videoModel === m ? 'bg-white/15 text-white' : 'text-text-muted hover:text-white/60'}`}>
                {m === 'seedance-2' ? 'PRO' : 'FAST'}
              </button>
            ))}
          </div>
          {div}
          <div className="flex items-center gap-1 flex-shrink-0">
            {VIDEO_RATIOS.map((r) => (
              <Pill key={r} active={videoAspectRatio === r} disabled={false} onClick={() => onVideoAspectRatio(r)}>{r}</Pill>
            ))}
          </div>
          {div}
          <div className="flex items-center gap-1 flex-shrink-0">
            {VIDEO_RESOLUTIONS.map((r) => (
              <AccentPill key={r} active={videoResolution === r} disabled={false} onClick={() => onVideoResolution(r)}>{r.toUpperCase()}</AccentPill>
            ))}
          </div>
          {div}
          <div className="flex items-center gap-1 flex-shrink-0">
            {VIDEO_DURATIONS.map((d) => (
              <Pill key={d} active={duration === d} disabled={false} onClick={() => onDuration(d)}>{d}s</Pill>
            ))}
          </div>
        </>
      )}

      {/* Fire button — stays clickable while tasks run so a new batch can be
          fired in parallel; the running task is never interrupted */}
      <button
        onClick={onClick}
        disabled={disabled}
        title={isLoading && !disabled ? 'Task keeps running in background — click fires another batch in parallel' : undefined}
        className={`flex-1 flex items-center justify-center gap-2 py-[7px] px-4 rounded-lg border transition-all duration-150 ${isLoading ? `border-accent/30 bg-accent/5 text-white/70 ${disabled ? 'cursor-not-allowed' : 'hover:bg-accent/10 hover:border-accent/50 cursor-pointer'}` : status === 'done' ? 'border-green-500/40 bg-green-500/5 text-green-400 hover:bg-green-500/10 cursor-pointer' : status === 'error' ? 'border-red-500/40 bg-red-500/5 text-red-400 hover:bg-red-500/10 cursor-pointer' : disabled ? 'border-border bg-transparent text-text-muted cursor-not-allowed opacity-40' : 'border-white/20 bg-white/5 text-white hover:bg-white/10 hover:border-white/40 active:scale-[0.99] cursor-pointer'}`}
      >
        {isLoading ? (
          <>
            <svg className="animate-spin flex-shrink-0 text-accent" width="12" height="12" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="8 6" strokeLinecap="round"/>
            </svg>
            <span className="text-[12.7px] font-heading font-semibold uppercase tracking-widest">
              {mode === 'video' ? 'Generating video' : 'Generating'}{running > 1 ? ` ×${running}` : ''}
            </span>
            {!disabled && <span className="text-[11px] font-mono text-white/35 normal-case tracking-normal">+ fire again</span>}
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
        ) : mode === 'model' ? (
          modelEngine === 'recraft' ? <RecraftLogo /> : <NanoBananaLogo />
        ) : provider === 'higgsfield' ? (
          <>
            <HiggsfieldLogo />
            {variations > 1 && <span className="text-[11.7px] font-mono text-white/40 ml-1">×{variations}</span>}
          </>
        ) : (
          <>
            <NanoBananaLogo />
            {variations > 1 && <span className="text-[11.7px] font-mono text-white/40 ml-1">×{variations}</span>}
          </>
        )}
      </button>
    </div>
  )
}
