import React from 'react'

type Status = 'idle' | 'loading' | 'done' | 'error'

const RATIOS = ['9:16', '4:5', '1:1'] as const
type AspectRatio = typeof RATIOS[number]

const RESOLUTIONS = ['1k', '2k'] as const
type Resolution = typeof RESOLUTIONS[number]

const VARIATIONS = [1, 2, 3, 4] as const
type Variations = typeof VARIATIONS[number]

interface HiggsfieldButtonProps {
  status: Status
  progress: string[]
  onClick: () => void
  disabled: boolean
  aspectRatio: AspectRatio
  onAspectRatio: (r: AspectRatio) => void
  resolution: Resolution
  onResolution: (r: Resolution) => void
  variations: Variations
  onVariations: (v: Variations) => void
}

function HiggsfieldLogo() {
  return (
    <span className="flex items-center gap-2">
      <svg width="16" height="16" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M50 8C27 8 8 27 8 50C8 73 27 92 50 92C73 92 92 73 92 50C92 40 88 31 82 24C76 17 67 13 58 12C47 11 37 16 31 25C26 33 27 44 33 51C39 58 49 60 57 56C63 53 67 46 65 39C63 33 57 29 51 31"
          stroke="currentColor" strokeWidth="8" strokeLinecap="round" fill="none"
        />
        <circle cx="51" cy="31" r="5" fill="currentColor" />
      </svg>
      <span className="font-sans font-semibold text-[15px] tracking-wide">Higgsfield</span>
    </span>
  )
}

export function HiggsfieldButton({ status, progress, onClick, disabled, aspectRatio, onAspectRatio, resolution, onResolution, variations, onVariations }: HiggsfieldButtonProps) {
  const isLoading = status === 'loading'

  return (
    <div className="flex flex-col gap-2">

      {/* Progress log — shown above the controls */}
      {progress.length > 0 && (
        <div className="bg-[#0f0f0f] border border-border rounded-lg px-3 py-2 max-h-[60px] overflow-y-auto">
          {progress.map((line, i) => (
            <p key={i} className="text-[15px] font-mono text-text-secondary leading-relaxed">{line}</p>
          ))}
        </div>
      )}

      {/* Controls row: ratio pills + resolution pills + fire button */}
      <div className="flex items-center gap-2">

        {/* Aspect ratio pills */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {RATIOS.map((r) => (
            <button
              key={r}
              onClick={() => onAspectRatio(r)}
              disabled={isLoading}
              className={`
                px-2.5 py-[7px] rounded-md text-[15px] font-mono font-semibold tracking-wide border transition-all duration-150
                ${aspectRatio === r
                  ? 'border-white/50 bg-white/10 text-white'
                  : 'border-border bg-transparent text-text-muted hover:border-white/25 hover:text-white/70'
                }
                ${isLoading ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}
              `}
            >
              {r}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="w-px h-4 bg-border flex-shrink-0" />

        {/* Resolution pills */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {RESOLUTIONS.map((r) => (
            <button
              key={r}
              onClick={() => onResolution(r)}
              disabled={isLoading}
              className={`
                px-2.5 py-[7px] rounded-md text-[15px] font-mono font-semibold tracking-wide border transition-all duration-150
                ${resolution === r
                  ? 'border-accent/70 bg-accent/10 text-accent'
                  : 'border-border bg-transparent text-text-muted hover:border-accent/30 hover:text-accent/60'
                }
                ${isLoading ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}
              `}
            >
              {r.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="w-px h-4 bg-border flex-shrink-0" />

        {/* Variations pills */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {VARIATIONS.map((v) => (
            <button
              key={v}
              onClick={() => onVariations(v)}
              disabled={isLoading}
              className={`
                px-2 py-[7px] rounded-md text-[15px] font-mono font-semibold tracking-wide border transition-all duration-150
                ${variations === v
                  ? 'border-white/50 bg-white/10 text-white'
                  : 'border-border bg-transparent text-text-muted hover:border-white/25 hover:text-white/70'
                }
                ${isLoading ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}
              `}
            >
              ×{v}
            </button>
          ))}
        </div>

        {/* Fire button */}
        <button
          onClick={onClick}
          disabled={disabled || isLoading}
          className={`
            flex-1 flex items-center justify-center gap-2 py-[7px] px-4 rounded-lg
            border transition-all duration-150
            ${isLoading
              ? 'border-white/15 bg-white/5 text-white/40 cursor-not-allowed'
              : status === 'done'
              ? 'border-green-500/40 bg-green-500/5 text-green-400 hover:bg-green-500/10 cursor-pointer'
              : status === 'error'
              ? 'border-red-500/40 bg-red-500/5 text-red-400 hover:bg-red-500/10 cursor-pointer'
              : disabled
              ? 'border-border bg-transparent text-text-muted cursor-not-allowed opacity-40'
              : 'border-white/20 bg-white/5 text-white hover:bg-white/10 hover:border-white/40 active:scale-[0.99] cursor-pointer'
            }
          `}
        >
          {isLoading ? (
            <>
              <svg className="animate-spin flex-shrink-0" width="12" height="12" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="8 6" strokeLinecap="round"/>
              </svg>
              <span className="text-[15px] font-heading font-semibold uppercase tracking-widest">Generating...</span>
            </>
          ) : status === 'done' ? (
            <>
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                <path d="M2 7l3.5 3.5 6.5-6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="text-[15px] font-heading font-semibold uppercase tracking-widest">Done — check Desktop</span>
            </>
          ) : status === 'error' ? (
            <span className="text-[15px] font-heading font-semibold uppercase tracking-widest text-red-400">Error — retry</span>
          ) : (
            <>
              <HiggsfieldLogo />
              {variations > 1 && (
                <span className="text-[15px] font-mono text-white/40 ml-1">×{variations}</span>
              )}
            </>
          )}
        </button>

      </div>
    </div>
  )
}
