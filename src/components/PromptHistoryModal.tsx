import React, { useEffect, useState, useRef } from 'react'

interface MemoryEntry {
  id: string
  timestamp: number
  description: string
  prompt: string
  fired: boolean
  aspectRatio?: string
}

interface Props {
  onUse: (prompt: string) => void
  onClose: () => void
}

export function PromptHistoryModal({ onUse, onClose }: Props) {
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.bmp?.getMemoryEntries?.().then(setEntries)
    setTimeout(() => searchRef.current?.focus(), 50)
  }, [])

  const filtered = entries.filter(e =>
    !search || e.description.toLowerCase().includes(search.toLowerCase()) || e.prompt.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-50 pt-16" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-xl w-[600px] max-h-[70vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <span className="font-heading font-bold text-text-primary text-[13.7px] uppercase tracking-widest">
            Prompt History
          </span>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-2 border-b border-border flex-shrink-0">
          <input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search prompts..."
            className="w-full bg-transparent text-[13.7px] text-text-primary placeholder:text-text-muted font-mono focus:outline-none"
          />
        </div>

        {/* List */}
        <div className="overflow-y-auto flex-1">
          {filtered.length === 0 ? (
            <p className="text-center text-text-muted text-[12.7px] py-8 font-mono">No prompts found</p>
          ) : (
            filtered.map(entry => {
              const isExpanded = expanded === entry.id
              const date = new Date(entry.timestamp).toLocaleDateString('es-CO', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
              return (
                <div key={entry.id} className="border-b border-border/50 last:border-0">
                  {/* Row */}
                  <div className="flex items-start gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors">
                    {/* Fired badge */}
                    <span className={`mt-0.5 flex-shrink-0 text-[11px] ${entry.fired ? 'text-yellow-500' : 'text-text-muted/30'}`}>★</span>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 mb-0.5">
                        <span className="text-[13.7px] text-text-primary font-medium truncate">{entry.description}</span>
                        <span className="text-[11px] text-text-muted font-mono flex-shrink-0">{date}</span>
                        {entry.aspectRatio && (
                          <span className="text-[11px] font-mono text-text-muted/60 flex-shrink-0">{entry.aspectRatio}</span>
                        )}
                      </div>
                      <p className={`text-[12px] font-mono text-text-muted leading-relaxed ${isExpanded ? '' : 'line-clamp-2'}`}>
                        {entry.prompt}
                      </p>
                      {entry.prompt.length > 120 && (
                        <button
                          onClick={() => setExpanded(isExpanded ? null : entry.id)}
                          className="text-[11px] text-text-muted/60 hover:text-text-muted mt-0.5 transition-colors"
                        >
                          {isExpanded ? 'Show less' : 'Show more'}
                        </button>
                      )}
                    </div>

                    {/* Use button */}
                    <button
                      onClick={() => { onUse(entry.prompt); onClose() }}
                      className="flex-shrink-0 px-3 py-1.5 rounded-md border border-white/20 text-[11.7px] font-heading font-semibold uppercase tracking-widest text-white hover:bg-white/10 transition-colors"
                    >
                      Use
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
