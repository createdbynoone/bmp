import React, { useState } from 'react'
import { ActivityLog, type LogEntry } from './ActivityLog'
import type { ModelResult } from '../App'

interface ModelModeProps {
  prompt: string
  onPrompt: (p: string) => void
  results: ModelResult[] // SKU pairs (full body + face macro), newest first
  entries: LogEntry[]
  running: number
  onClearLog: () => void
}

export function ModelMode({ prompt, onPrompt, results, entries, running, onClearLog }: ModelModeProps) {
  const [lightbox, setLightbox] = useState<string | null>(null)
  const showLog = entries.length > 0 || running > 0
  const showResults = results.length > 0

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">

      {/* Prompt input */}
      <div className={`bg-surface border border-border rounded-lg p-3 flex flex-col gap-2 min-h-0 ${showResults || showLog ? 'flex-shrink-0' : 'flex-1'}`}>
        <div className="flex items-center justify-between">
          <label className="text-[11.7px] font-heading font-semibold uppercase tracking-widest text-text-secondary">
            Model Prompt <span className="text-text-muted normal-case tracking-normal">(paste — AI model creation)</span>
          </label>
          {prompt.trim().length > 0 && (
            <button onClick={() => onPrompt('')} className="text-[11px] text-text-muted hover:text-text-secondary uppercase tracking-widest transition-colors">
              Clear
            </button>
          )}
        </div>
        <textarea
          value={prompt}
          onChange={(e) => onPrompt(e.target.value)}
          placeholder="Pega aquí el prompt del modelo de IA (rasgos, piel, pelo, pose, luz...) y dispara con NB2 o Recraft v4.1 Pro."
          className={`w-full bg-transparent text-[13.7px] text-text-primary placeholder:text-text-muted font-mono leading-relaxed focus:outline-none resize-none ${showResults || showLog ? 'h-[110px]' : 'flex-1 min-h-[110px]'}`}
        />
      </div>

      {/* Results gallery — each SKU is a card with the full shot and its
          auto-generated macro face shot side by side */}
      {showResults && (
        <div className="bg-surface border border-border rounded-lg overflow-hidden flex flex-col min-h-[200px] flex-[3]">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border flex-shrink-0">
            <span className="text-[11.7px] font-medium uppercase tracking-widest text-text-secondary font-heading">
              Models <span className="text-text-muted">· {results.length}</span>
            </span>
            <span className="text-[11px] font-mono text-text-muted">click to preview · Brotherhood/IA/Modelos</span>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto p-3">
            <div className="grid grid-cols-2 gap-3">
              {results.map((r) => (
                <div key={r.sku} className="rounded-lg border border-border overflow-hidden bg-black/30">
                  <div className="flex items-center justify-between px-3 py-1.5 border-b border-border">
                    <span className="text-[11.7px] font-mono font-bold text-accent tracking-widest">{r.sku}</span>
                    <span className="text-[10px] font-mono text-text-muted uppercase tracking-widest">{r.gender}</span>
                  </div>
                  <div className="grid grid-cols-2">
                    <button onClick={() => setLightbox(r.full)} className="relative group aspect-[4/5] bg-black/40 border-r border-border overflow-hidden">
                      <img src={`localfile://${r.full}`} alt={`${r.sku} full`} className="w-full h-full object-cover block group-hover:scale-[1.02] transition-transform duration-200" loading="lazy" />
                      <span className="absolute top-1.5 left-1.5 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-black/70 text-white/70">FULL</span>
                    </button>
                    {r.face ? (
                      <button onClick={() => setLightbox(r.face)} className="relative group aspect-[4/5] bg-black/40 overflow-hidden">
                        <img src={`localfile://${r.face}`} alt={`${r.sku} face`} className="w-full h-full object-cover block group-hover:scale-[1.02] transition-transform duration-200" loading="lazy" />
                        <span className="absolute top-1.5 left-1.5 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-accent/80 text-black">FACE</span>
                      </button>
                    ) : (
                      <div className="aspect-[4/5] flex items-center justify-center">
                        <span className="text-[10px] font-mono text-text-muted uppercase tracking-widest text-center px-2">face macro<br />failed</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Activity log */}
      {showLog && (
        <ActivityLog entries={entries} running={running} onClear={onClearLog} className={showResults ? 'flex-[2] min-h-[100px]' : 'flex-1 min-h-[110px]'} />
      )}

      {/* Empty state */}
      {!showResults && !showLog && (
        <div className="flex-shrink-0 flex items-center justify-center py-4">
          <p className="text-[11.7px] text-text-muted uppercase tracking-[0.2em] font-heading">Paste prompt · Pick engine · Fire — results appear here</p>
        </div>
      )}

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-8 cursor-zoom-out" onClick={() => setLightbox(null)}>
          <img src={`localfile://${lightbox}`} alt="Preview" className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[11.7px] font-mono text-white/50">{lightbox.split('/').pop()} · click to close</span>
        </div>
      )}
    </div>
  )
}
