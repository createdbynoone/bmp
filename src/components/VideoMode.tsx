import React, { useRef, useState, useCallback, useMemo } from 'react'

interface VideoModeProps {
  prompt: string
  onPrompt: (p: string) => void
  frames: string[]
  onFrames: (f: string[]) => void
  progress: string[]
}

export function VideoMode({ prompt, onPrompt, frames, onFrames, progress }: VideoModeProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [draggingOver, setDraggingOver] = useState(false)

  // Which @Image indices are referenced in the current prompt
  const usedIndices = useMemo(() => {
    const matches = [...prompt.matchAll(/@Image(\d+)/gi)]
    return new Set(matches.map((m) => parseInt(m[1]) - 1)) // convert to 0-based
  }, [prompt])

  // Tags referenced but no frame available (warn)
  const missingTags = useMemo(() => {
    const matches = [...prompt.matchAll(/@Image(\d+)/gi)]
    return matches
      .map((m) => parseInt(m[1]))
      .filter((n) => n > frames.length)
  }, [prompt, frames.length])

  const insertTag = (index: number) => {
    const tag = `@Image${index + 1}`
    const el = textareaRef.current
    if (!el) { onPrompt(prompt + (prompt.endsWith(' ') ? '' : ' ') + tag + ' '); return }
    const start = el.selectionStart ?? prompt.length
    const end = el.selectionEnd ?? prompt.length
    const before = prompt.slice(0, start)
    const after = prompt.slice(end)
    const spaceBefore = before.length > 0 && !before.endsWith(' ') ? ' ' : ''
    const spaceAfter = after.length > 0 && !after.startsWith(' ') ? ' ' : ''
    const next = before + spaceBefore + tag + spaceAfter + after
    onPrompt(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + spaceBefore.length + tag.length + spaceAfter.length
      el.setSelectionRange(pos, pos)
    })
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDraggingOver(false)
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
    if (files.length === 0) return
    const paths = files.map((f) => { try { return window.bmp.getPathForFile(f) } catch { return '' } }).filter(Boolean)
    onFrames([...frames, ...paths].slice(0, 9))
  }, [frames, onFrames])

  const removeFrame = (i: number) => {
    onFrames(frames.filter((_, idx) => idx !== i))
  }

  return (
    <div className="flex flex-col gap-3 h-full">

      {/* Frames section */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDraggingOver(true) }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDraggingOver(false) }}
        onDrop={handleDrop}
        className={`border rounded-lg p-3 flex-shrink-0 transition-all duration-150 ${draggingOver ? 'border-white/40 bg-white/5' : 'border-border bg-surface'}`}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <label className="text-[11.7px] font-heading font-semibold uppercase tracking-widest text-text-secondary">
              Frames
            </label>
            <span className="text-[11px] text-text-muted font-mono">drag · max 9</span>
          </div>
          {frames.length > 0 && (
            <span className="text-[11px] text-text-muted font-mono">{frames.length}/9 · click thumbnail to insert tag</span>
          )}
        </div>

        {frames.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-5 gap-1.5">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-text-muted">
              <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.5"/>
              <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/>
              <path d="M3 15l5-5 4 4 3-3 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="text-[11.7px] text-text-muted font-heading uppercase tracking-widest">Drop frames here</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            {frames.map((f, i) => {
              const used = usedIndices.has(i)
              return (
                <button
                  key={i}
                  onClick={() => insertTag(i)}
                  title={`Insert @Image${i + 1} at cursor`}
                  className={`relative group flex-shrink-0 rounded-md overflow-hidden border transition-all duration-150 ${used ? 'border-accent/60 ring-1 ring-accent/30' : 'border-border hover:border-white/30'}`}
                >
                  <img
                    src={`localfile://${f}`}
                    alt={`Frame ${i + 1}`}
                    className="w-16 h-16 object-cover block"
                  />
                  {/* Label */}
                  <div className={`absolute bottom-0 left-0 right-0 text-[9px] font-mono font-bold text-center py-0.5 transition-colors ${used ? 'bg-accent/80 text-black' : 'bg-black/70 text-white/70'}`}>
                    @Image{i + 1}
                  </div>
                  {/* Remove button */}
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFrame(i) }}
                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/80 border border-white/20 text-white/70 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-[10px] leading-none"
                  >
                    ×
                  </button>
                </button>
              )
            })}
            {/* Add more drop target */}
            {frames.length < 9 && (
              <div className="w-16 h-16 border border-dashed border-border rounded-md flex items-center justify-center text-text-muted hover:border-white/30 hover:text-white/60 transition-all text-[20px] cursor-default flex-shrink-0">
                +
              </div>
            )}
          </div>
        )}
      </div>

      {/* Prompt textarea */}
      <div className="bg-surface border border-border rounded-lg p-3 flex flex-col gap-2 flex-1 min-h-0">
        <div className="flex items-center justify-between">
          <label className="text-[11.7px] font-heading font-semibold uppercase tracking-widest text-text-secondary">
            Video Prompt
          </label>
          {missingTags.length > 0 && (
            <span className="text-[11px] font-mono text-orange-400/80">
              ⚠ @Image{missingTags[0]}{missingTags.length > 1 ? `–${missingTags[missingTags.length - 1]}` : ''} not in frames
            </span>
          )}
        </div>
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => onPrompt(e.target.value)}
          placeholder={frames.length > 0
            ? `Use @Image1${frames.length > 1 ? ', @Image2...' : ''} to reference your frames. Ej: "@Image1 first frame disassembly render to cap building, @Image2 enters floating in 3d render..."`
            : 'Drop frames above, then write your video prompt using @Image1, @Image2... tags to reference them.'
          }
          className="w-full flex-1 bg-transparent text-[13.7px] text-text-primary placeholder:text-text-muted font-sans leading-relaxed focus:outline-none resize-none"
          style={{ minHeight: '120px' }}
        />
      </div>

      {/* Progress log */}
      {progress.length > 0 && (
        <div className="bg-[#0f0f0f] border border-border rounded-lg px-3 py-2 max-h-[64px] overflow-y-auto flex-shrink-0">
          {progress.map((line, i) => (
            <p key={i} className="text-[11.7px] font-mono text-text-secondary leading-relaxed">{line}</p>
          ))}
        </div>
      )}
    </div>
  )
}
