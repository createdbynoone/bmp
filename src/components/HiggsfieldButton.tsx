import React from 'react'

type Status = 'idle' | 'loading' | 'done' | 'error'

interface HiggsfieldButtonProps {
  status: Status
  progress: string[]
  onClick: () => void
  disabled?: boolean
}

export function HiggsfieldButton({ status, progress, onClick, disabled }: HiggsfieldButtonProps) {
  const isLoading = status === 'loading'

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={onClick}
        disabled={disabled || isLoading}
        className={`
          w-full flex items-center justify-center gap-3 py-3 px-5 rounded-lg
          border font-heading font-semibold text-sm uppercase tracking-widest
          transition-all duration-150
          ${isLoading
            ? 'border-accent/40 bg-accent/5 text-accent/60 cursor-not-allowed'
            : status === 'done'
            ? 'border-green-500/40 bg-green-500/5 text-green-400 hover:bg-green-500/10'
            : status === 'error'
            ? 'border-red-500/40 bg-red-500/5 text-red-400 hover:bg-red-500/10'
            : disabled
            ? 'border-border text-text-muted cursor-not-allowed'
            : 'border-accent/60 bg-accent/5 text-accent hover:bg-accent/10 hover:border-accent active:scale-[0.99]'
          }
        `}
      >
        {/* Higgsfield wordmark */}
        <span className="font-mono text-xs tracking-[0.2em] opacity-70">HIGGSFIELD</span>
        <span className="text-text-muted">×</span>
        <span>
          {isLoading ? 'Generating...' : status === 'done' ? 'Done — check Desktop' : status === 'error' ? 'Error — retry' : 'Fire nano_banana_flash'}
        </span>
        {isLoading && (
          <svg className="animate-spin ml-1" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="8 6" strokeLinecap="round"/>
          </svg>
        )}
        {status === 'done' && (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 7l3.5 3.5 6.5-6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>

      {progress.length > 0 && (
        <div className="bg-[#0d0d0d] border border-border rounded-lg p-3 max-h-[80px] overflow-y-auto">
          {progress.map((line, i) => (
            <p key={i} className="text-[10px] font-mono text-text-secondary leading-relaxed">{line}</p>
          ))}
        </div>
      )}
    </div>
  )
}
