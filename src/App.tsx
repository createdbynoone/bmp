import React, { useState, useEffect } from 'react'
import { DropZone } from './components/DropZone'
import { PromptOutput } from './components/PromptOutput'
import { HiggsfieldButton } from './components/HiggsfieldButton'

type GenerateStatus = 'idle' | 'loading' | 'done' | 'error'
type FireStatus = 'idle' | 'loading' | 'done' | 'error'

export default function App() {
  const [refs, setRefs] = useState<string[]>([])
  const [products, setProducts] = useState<string[]>([])
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const [generateStatus, setGenerateStatus] = useState<GenerateStatus>('idle')
  const [fireStatus, setFireStatus] = useState<FireStatus>('idle')
  const [fireProgress, setFireProgress] = useState<string[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    const cleanup = window.bmp.onHiggsfieldProgress((line) => {
      setFireProgress((prev) => [...prev, line])
    })
    return cleanup
  }, [])

  const canGenerate = refs.length > 0 && products.length > 0 && description.trim().length > 0

  const handleGenerate = async () => {
    if (!canGenerate) return
    setGenerateStatus('loading')
    setPrompt('')
    setError('')
    setFireStatus('idle')
    setFireProgress([])

    try {
      const result = await window.bmp.generatePrompt({ refs, products, description })
      setPrompt(result)
      setGenerateStatus('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
      setGenerateStatus('error')
    }
  }

  const handleFire = async () => {
    if (!prompt) return
    setFireStatus('loading')
    setFireProgress([])

    try {
      const result = await window.bmp.fireHighsfield({ prompt })
      setFireStatus(result.success ? 'done' : 'error')
    } catch (err) {
      setFireStatus('error')
      setFireProgress((prev) => [...prev, err instanceof Error ? err.message : 'Unknown error'])
    }
  }

  const reset = () => {
    setRefs([])
    setProducts([])
    setDescription('')
    setPrompt('')
    setGenerateStatus('idle')
    setFireStatus('idle')
    setFireProgress([])
    setError('')
  }

  return (
    <div className="flex flex-col h-screen bg-bg overflow-hidden">
      {/* Titlebar */}
      <div className="titlebar-drag flex items-center justify-between px-5 pt-4 pb-3 flex-shrink-0">
        <div className="titlebar-nodrag flex items-center gap-3" style={{ marginLeft: '64px' }}>
          <span className="font-heading font-bold text-base text-text-primary tracking-tight">BMP</span>
          <span className="text-text-muted text-xs">·</span>
          <span className="text-text-secondary text-xs font-medium tracking-wide">Brotherhood Marketing Prompts</span>
        </div>
        <div className="titlebar-nodrag flex items-center gap-3">
          <span className="text-[10px] text-text-muted font-mono tracking-widest uppercase">brotherhood.com.co</span>
          <button
            onClick={reset}
            className="text-[10px] text-text-muted hover:text-text-secondary uppercase tracking-widest transition-colors"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Divider */}
      <div className="h-px bg-border flex-shrink-0" />

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">

        {/* Drop zones */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-surface border border-border rounded-lg p-3 flex flex-col gap-2">
            <label className="text-[10px] font-heading font-semibold uppercase tracking-widest text-text-secondary">
              References <span className="text-text-muted">(composition / mood)</span>
            </label>
            <DropZone
              label="+ Add refs"
              multiple
              files={refs}
              onFiles={setRefs}
            />
          </div>
          <div className="bg-surface border border-border rounded-lg p-3 flex flex-col gap-2">
            <label className="text-[10px] font-heading font-semibold uppercase tracking-widest text-text-secondary">
              Product <span className="text-text-muted">(Brotherhood garment)</span>
            </label>
            <DropZone
              label="+ Add product"
              multiple
              files={products}
              onFiles={setProducts}
            />
          </div>
        </div>

        {/* Description */}
        <div className="bg-surface border border-border rounded-lg p-3 flex flex-col gap-2">
          <label className="text-[10px] font-heading font-semibold uppercase tracking-widest text-text-secondary">
            Brief Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder='Ej: "gorra en ola de playa, luz dorada al atardecer"'
            rows={2}
            className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted font-sans leading-relaxed focus:outline-none"
          />
        </div>

        {/* Generate button */}
        <button
          onClick={handleGenerate}
          disabled={!canGenerate || generateStatus === 'loading'}
          className={`
            w-full py-3 rounded-lg font-heading font-semibold text-sm uppercase tracking-widest
            border transition-all duration-150
            ${generateStatus === 'loading'
              ? 'border-accent/30 bg-accent/5 text-accent/50 cursor-not-allowed'
              : !canGenerate
              ? 'border-border text-text-muted cursor-not-allowed'
              : 'border-accent bg-accent text-bg hover:bg-accent/90 active:scale-[0.99]'
            }
          `}
        >
          {generateStatus === 'loading' ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="8 6" strokeLinecap="round"/>
              </svg>
              Generating with Claude...
            </span>
          ) : 'Generate Prompt'}
        </button>

        {/* Error */}
        {error && (
          <div className="bg-red-500/5 border border-red-500/20 rounded-lg px-4 py-3">
            <p className="text-xs text-red-400 font-mono">{error}</p>
          </div>
        )}

        {/* Prompt output */}
        {prompt && (
          <>
            <PromptOutput prompt={prompt} />
            <HiggsfieldButton
              status={fireStatus}
              progress={fireProgress}
              onClick={handleFire}
              disabled={!prompt}
            />
          </>
        )}

        {/* Empty state hint */}
        {!prompt && generateStatus === 'idle' && (
          <div className="flex-1 flex items-center justify-center py-6">
            <div className="text-center">
              <p className="text-[10px] text-text-muted uppercase tracking-[0.2em] font-heading">
                Drop refs + product · Write brief · Generate
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 border-t border-border px-5 py-2 flex items-center justify-between">
        <span className="text-[9px] text-text-muted font-mono tracking-widest uppercase">nano_banana_flash · 1k · 4:5</span>
        <span className="text-[9px] text-text-muted font-mono">BMP v1.0</span>
      </div>
    </div>
  )
}
