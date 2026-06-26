import React, { useState, useEffect } from 'react'

type UpdatePhase = 'available' | 'downloading' | 'installing' | 'ready' | 'error'

interface UpdateStatus {
  phase: UpdatePhase
  version?: string
  percent?: number
  error?: string
}

export function UpdateBar() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const cleanup = window.bmp?.onUpdateStatus?.((s) => {
      setStatus(s as UpdateStatus)
    })
    return cleanup
  }, [])

  if (!status || dismissed) return null

  const { phase, version, percent, error } = status

  return (
    <div className="flex-shrink-0 border-b border-border overflow-hidden">
      {/* Progress fill — always rendered, width animated */}
      <div className="relative bg-surface">
        {/* Thin accent track */}
        {phase === 'downloading' && (
          <div
            className="absolute inset-y-0 left-0 bg-accent/10 transition-all duration-300 ease-out"
            style={{ width: `${percent ?? 0}%` }}
          />
        )}
        {phase === 'ready' && (
          <div className="absolute inset-y-0 left-0 bg-accent/10 w-full" />
        )}

        <div className="relative flex items-center justify-between px-5 py-2 gap-4">
          {/* Left: icon + message */}
          <div className="flex items-center gap-2.5 min-w-0">
            {phase === 'available' && (
              <>
                <span className="text-accent text-[15px]">↓</span>
                <span className="text-[15px] font-mono text-text-secondary tracking-wide">
                  BMP {version && <span className="text-text-primary">{version}</span>} disponible · iniciando descarga...
                </span>
                <Spinner />
              </>
            )}

            {phase === 'downloading' && (
              <>
                <span className="text-accent text-[15px]">↓</span>
                <span className="text-[15px] font-mono text-text-secondary tracking-wide">
                  BMP {version && <span className="text-text-primary">{version}</span>} · descargando
                </span>
                <div className="flex items-center gap-1.5">
                  <div className="w-20 h-px bg-border relative overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 bg-accent transition-all duration-300 ease-out"
                      style={{ width: `${percent ?? 0}%` }}
                    />
                  </div>
                  <span className="text-[15px] font-mono text-accent tabular-nums">{percent ?? 0}%</span>
                </div>
              </>
            )}

            {phase === 'installing' && (
              <>
                <span className="text-accent text-[15px]">⚙</span>
                <span className="text-[15px] font-mono text-text-secondary tracking-wide">
                  BMP {version && <span className="text-text-primary">{version}</span>} · instalando...
                </span>
                <Spinner />
              </>
            )}

            {phase === 'ready' && (
              <>
                <span className="text-accent text-[15px]">✓</span>
                <span className="text-[15px] font-mono text-text-secondary tracking-wide">
                  BMP {version && <span className="text-text-primary">{version}</span>} instalada · reiniciando
                </span>
                <Spinner />
              </>
            )}

            {phase === 'error' && (
              <>
                <span className="text-red-400 text-[15px]">⚠</span>
                <span className="text-[15px] font-mono text-red-400/70 tracking-wide truncate">
                  {error ?? 'Error al verificar actualizaciones'}
                </span>
              </>
            )}
          </div>

          {/* Right: dismiss (only on error) */}
          {phase === 'error' && (
            <button
              onClick={() => setDismissed(true)}
              className="text-[15px] text-text-muted hover:text-text-secondary transition-colors flex-shrink-0"
            >
              ×
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin text-accent" width="10" height="10" viewBox="0 0 10 10" fill="none">
      <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.2" strokeDasharray="6 4" strokeLinecap="round" />
    </svg>
  )
}
