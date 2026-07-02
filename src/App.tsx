import React, { useState, useEffect } from 'react'
import { DropZone } from './components/DropZone'
import { PromptOutput } from './components/PromptOutput'
import { HiggsfieldButton } from './components/HiggsfieldButton'
import { UpdateBar } from './components/UpdateBar'
import { SettingsModal } from './components/SettingsModal'
import { PromptHistoryModal } from './components/PromptHistoryModal'
import { VideoMode } from './components/VideoMode'
import type { Provider, Mode } from './components/HiggsfieldButton'

type GenerateStatus = 'idle' | 'loading' | 'done' | 'error'
type FireStatus = 'idle' | 'loading' | 'done' | 'error'

export default function App() {
  // ── Image mode state ──────────────────────────────────────────────────────
  const [refs, setRefs] = useState<string[]>([])
  const [products, setProducts] = useState<string[]>([])
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const [generateStatus, setGenerateStatus] = useState<GenerateStatus>('idle')
  const [error, setError] = useState('')
  const [memoryId, setMemoryId] = useState<string | null>(null)
  const [provider, setProvider] = useState<Provider>('gemini')
  const [aspectRatio, setAspectRatio] = useState('3:4')
  const [resolution, setResolution] = useState('2k')
  const [variations, setVariations] = useState(1)
  const [showHistory, setShowHistory] = useState(false)

  // ── Video mode state ──────────────────────────────────────────────────────
  const [videoPrompt, setVideoPrompt] = useState('')
  const [frames, setFrames] = useState<string[]>([])
  const [videoModel, setVideoModel] = useState<'seedance-2' | 'seedance-2-fast'>('seedance-2')
  const [videoAspectRatio, setVideoAspectRatio] = useState('9:16')
  const [videoResolution, setVideoResolution] = useState('1080p')
  const [duration, setDuration] = useState(5)
  const [generateAudio, setGenerateAudio] = useState(true)

  // ── Shared state ──────────────────────────────────────────────────────────
  const [mode, setMode] = useState<Mode>('image')
  const [fireStatus, setFireStatus] = useState<FireStatus>('idle')
  const [fireProgress, setFireProgress] = useState<string[]>([])
  const [memoryStats, setMemoryStats] = useState<{ total: number; fired: number } | null>(null)
  const [credits, setCredits] = useState<{ credits: number | null; plan: string | null } | null>(null)
  const [appVersion, setAppVersion] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [showLoginModal, setShowLoginModal] = useState(false)

  useEffect(() => {
    if (!window.bmp) return
    const cleanup = window.bmp.onHiggsfieldProgress((line) => {
      setFireProgress((prev) => [...prev, line])
    })
    return cleanup
  }, [])

  useEffect(() => {
    window.bmp?.checkHiggsfieldAuth?.().then((res: { authenticated: boolean }) => {
      if (!res.authenticated) { setShowLoginModal(true); window.bmp?.higgsfieldLogin?.() }
    })
    window.bmp?.getMemoryStats?.().then((s: { total: number; fired: number }) => setMemoryStats(s))
    window.bmp?.getHiggsfieldCredits?.().then((c) => setCredits(c))
    window.bmp?.getVersion?.().then((v) => setAppVersion(v))
  }, [])

  const handleProviderChange = (p: Provider) => {
    setProvider(p)
    if (p === 'higgsfield') {
      if (aspectRatio === '3:4' || aspectRatio === '16:9') setAspectRatio('4:5')
      if (resolution === '4k') setResolution('2k')
    } else if (p === 'gemini') {
      if (aspectRatio === '4:5' || aspectRatio === '16:9') setAspectRatio('3:4')
    }
    // poyo (NB2) supports 9:16 / 4:5 / 3:4 / 1:1 / 16:9 — all are valid, no reset needed
    setFireStatus('idle'); setFireProgress([])
  }

  const handleModeChange = (m: Mode) => {
    setMode(m)
    setFireStatus('idle'); setFireProgress([])
  }

  // ── Image: generate prompt ────────────────────────────────────────────────
  const canGenerate = refs.length > 0 && products.length > 0 && description.trim().length > 0

  const handleGenerate = async () => {
    if (!canGenerate) return
    setGenerateStatus('loading'); setPrompt(''); setError(''); setFireStatus('idle'); setFireProgress([])
    try {
      const result = await window.bmp.generatePrompt({ refs, products, description })
      setPrompt(result.prompt); setMemoryId(result.memoryId); setGenerateStatus('done')
      window.bmp?.getMemoryStats?.().then((s: { total: number; fired: number }) => setMemoryStats(s))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed'); setGenerateStatus('error')
    }
  }

  // ── Image: fire ───────────────────────────────────────────────────────────
  const handleFire = async () => {
    if (!prompt) return
    setFireStatus('loading'); setFireProgress([])
    try {
      if (provider === 'poyo') {
        const result = await window.bmp.firePoyoImage({ prompt, products, aspectRatio, resolution })
        setFireStatus(result.success ? 'done' : 'error')
        if (result.success && memoryId) {
          window.bmp?.markPromptFired?.({ id: memoryId, aspectRatio })
          window.bmp?.getMemoryStats?.().then((s: { total: number; fired: number }) => setMemoryStats(s))
        }
      } else {
        const settled = await Promise.allSettled(
          Array.from({ length: variations }, () =>
            window.bmp.fireHighsfield({ prompt, aspectRatio, products, resolution, provider })
          )
        )
        const succeeded = settled.filter((s) => s.status === 'fulfilled' && s.value.success).length
        const failed = variations - succeeded
        if (variations > 1) {
          setFireProgress((prev) => [...prev, failed === 0 ? `All ${variations} variations generated.` : succeeded === 0 ? `All ${variations} variations failed.` : `${succeeded}/${variations} generated — ${failed} failed.`])
        }
        setFireStatus(succeeded > 0 ? 'done' : 'error')
        if (succeeded > 0 && memoryId) {
          window.bmp?.markPromptFired?.({ id: memoryId, aspectRatio })
          window.bmp?.getMemoryStats?.().then((s: { total: number; fired: number }) => setMemoryStats(s))
        }
      }
    } catch (err) {
      setFireStatus('error'); setFireProgress((prev) => [...prev, err instanceof Error ? err.message : 'Unknown error'])
    }
  }

  // ── Video: fire ───────────────────────────────────────────────────────────
  const handleFireVideo = async () => {
    if (!videoPrompt.trim()) return
    setFireStatus('loading'); setFireProgress([])
    try {
      const result = await window.bmp.fireVideo({
        prompt: videoPrompt,
        products: frames,
        videoModel,
        aspectRatio: videoAspectRatio,
        resolution: videoResolution,
        duration,
        generateAudio,
      })
      setFireStatus(result.success ? 'done' : 'error')
    } catch (err) {
      setFireStatus('error'); setFireProgress((prev) => [...prev, err instanceof Error ? err.message : 'Unknown error'])
    }
  }

  const reset = () => {
    if (mode === 'image') {
      setRefs([]); setProducts([]); setDescription(''); setPrompt(''); setGenerateStatus('idle'); setMemoryId(null); setVariations(1); setError('')
    } else {
      setVideoPrompt(''); setFrames([])
    }
    setFireStatus('idle'); setFireProgress([])
  }

  const footerLabel = mode === 'video'
    ? `seedance-2 · ${videoAspectRatio} · ${videoResolution} · ${duration}s`
    : `${provider === 'higgsfield' ? 'higgsfield' : provider === 'gemini' ? 'gemini-3-pro' : 'nano-banana-2'} · ${aspectRatio} · ${resolution.toUpperCase()}`

  const fireDisabled = mode === 'video' ? !videoPrompt.trim() : !prompt

  return (
    <div className="flex flex-col h-screen bg-bg overflow-hidden">

      {/* Titlebar */}
      <div className="titlebar-drag flex items-center justify-between px-5 h-11 flex-shrink-0">
        <div className="titlebar-nodrag flex items-center gap-3 translate-y-[1px]" style={{ marginLeft: '72px' }}>
          <span className="font-heading font-bold text-base text-text-primary tracking-tight">BMP</span>
          <span className="text-text-muted text-[13.7px]">·</span>
          <span className="text-text-secondary text-[13.7px] font-medium tracking-wide">Brotherhood Marketing Prompts</span>
        </div>
        <div className="titlebar-nodrag flex items-center gap-3">
          <span className="text-[11.7px] text-text-muted font-mono tracking-widest uppercase">brotherhood.com.co</span>
          <button onClick={reset} className="text-[11.7px] text-text-muted hover:text-text-secondary uppercase tracking-widest transition-colors">Reset</button>
          <button onClick={() => setShowSettings(true)} className="text-text-muted hover:text-text-secondary transition-colors" title="Settings">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="2" stroke="currentColor" strokeWidth="1.25"/>
              <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.697 2.697l1.06 1.06M10.243 10.243l1.06 1.06M2.697 11.303l1.06-1.06M10.243 3.757l1.06-1.06" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="h-px bg-border flex-shrink-0" />
      <UpdateBar />

      {/* Mode tabs */}
      <div className="flex-shrink-0 px-4 pt-3 pb-0">
        <div className="flex items-center gap-1 bg-white/[0.04] border border-border rounded-lg p-1 w-fit">
          {(['image', 'video'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => handleModeChange(m)}
              className={`
                px-4 py-1.5 rounded-md text-[11.7px] font-heading font-semibold uppercase tracking-widest transition-all duration-150
                ${mode === m ? 'bg-white/12 text-white' : 'text-text-muted hover:text-white/60'}
              `}
            >
              {m === 'image' ? 'Image' : 'Video'}
            </button>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 min-h-0">
        {mode === 'image' ? (
          <>
            {/* Drop zones */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-surface border border-border rounded-lg p-3 flex flex-col gap-2">
                <label className="text-[11.7px] font-heading font-semibold uppercase tracking-widest text-text-secondary">
                  References <span className="text-text-muted">(composition / mood)</span>
                </label>
                <DropZone label="+ Add refs" multiple files={refs} onFiles={setRefs} />
              </div>
              <div className="bg-surface border border-border rounded-lg p-3 flex flex-col gap-2">
                <label className="text-[11.7px] font-heading font-semibold uppercase tracking-widest text-text-secondary">
                  Product <span className="text-text-muted">(Brotherhood garment)</span>
                </label>
                <DropZone label="+ Add product" multiple files={products} onFiles={setProducts} />
              </div>
            </div>

            {/* Description */}
            <div className="bg-surface border border-border rounded-lg p-3 flex flex-col gap-2">
              <label className="text-[11.7px] font-heading font-semibold uppercase tracking-widest text-text-secondary">Brief Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder='Ej: "gorra en ola de playa, luz dorada al atardecer"'
                rows={2}
                className="w-full bg-transparent text-[14.7px] text-text-primary placeholder:text-text-muted font-sans leading-relaxed focus:outline-none"
              />
            </div>

            {/* Generate + history */}
            <div className="flex gap-2">
              <button
                onClick={handleGenerate}
                disabled={!canGenerate || generateStatus === 'loading'}
                className={`flex-1 py-3 rounded-lg font-heading font-semibold text-[14.7px] uppercase tracking-widest border transition-all duration-150 ${generateStatus === 'loading' ? 'border-accent/30 bg-accent/5 text-accent/50 cursor-not-allowed' : !canGenerate ? 'border-border text-text-muted cursor-not-allowed' : 'border-accent bg-accent text-bg hover:bg-accent/90 active:scale-[0.99]'}`}
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
              <button onClick={() => setShowHistory(true)} title="Prompt history" className="px-3 py-3 rounded-lg border border-border text-text-muted hover:text-text-primary hover:border-white/25 transition-all duration-150">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.25"/>
                  <path d="M7 4v3.5l2 1.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>

            {error && (
              <div className="bg-red-500/5 border border-red-500/20 rounded-lg px-4 py-3">
                <p className="text-[13.7px] text-red-400 font-mono">{error}</p>
              </div>
            )}

            {prompt && <PromptOutput prompt={prompt} />}

            {fireProgress.length > 0 && (
              <div className="bg-[#0f0f0f] border border-border rounded-lg px-3 py-2 max-h-[80px] overflow-y-auto flex-shrink-0">
                {fireProgress.map((line, i) => (
                  <p key={i} className="text-[11.7px] font-mono text-text-secondary leading-relaxed">{line}</p>
                ))}
              </div>
            )}

            {!prompt && generateStatus === 'idle' && (
              <div className="flex-1 flex items-center justify-center py-6">
                <p className="text-[11.7px] text-text-muted uppercase tracking-[0.2em] font-heading">Drop refs + product · Write brief · Generate</p>
              </div>
            )}
          </>
        ) : (
          <VideoMode
            prompt={videoPrompt}
            onPrompt={setVideoPrompt}
            frames={frames}
            onFrames={setFrames}
            progress={fireProgress}
          />
        )}
      </div>

      {/* Bottom bar */}
      <div className="flex-shrink-0 border-t border-border px-4 py-3">
        <HiggsfieldButton
          status={fireStatus}
          onClick={mode === 'video' ? handleFireVideo : handleFire}
          disabled={fireDisabled}
          mode={mode}
          provider={provider}
          onProvider={handleProviderChange}
          aspectRatio={aspectRatio}
          onAspectRatio={setAspectRatio}
          resolution={resolution}
          onResolution={setResolution}
          variations={variations as 1 | 2 | 3 | 4}
          onVariations={setVariations}
          videoModel={videoModel}
          onVideoModel={setVideoModel}
          videoAspectRatio={videoAspectRatio}
          onVideoAspectRatio={setVideoAspectRatio}
          videoResolution={videoResolution}
          onVideoResolution={setVideoResolution}
          duration={duration}
          onDuration={setDuration}
          generateAudio={generateAudio}
          onGenerateAudio={setGenerateAudio}
        />
      </div>

      {/* Footer */}
      <div className="flex-shrink-0 border-t border-border px-5 py-2 flex items-center justify-between">
        <span className="text-[12.7px] text-text-muted font-mono tracking-widest uppercase">{footerLabel}</span>
        <div className="flex items-center gap-3">
          {memoryStats && memoryStats.total > 0 && (
            <span className="text-[12.7px] font-mono text-text-muted">
              memory: {memoryStats.total} prompts · <span className="text-yellow-600/70">★ {memoryStats.fired} fired</span>
            </span>
          )}
          {credits && credits.credits !== null && <CreditsRing credits={credits.credits} plan={credits.plan ?? ''} />}
          <span className="text-[12.7px] text-text-muted font-mono">BMP v{appVersion || '—'}</span>
        </div>
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showHistory && (
        <PromptHistoryModal
          onUse={(p) => { setPrompt(p); setGenerateStatus('done') }}
          onClose={() => setShowHistory(false)}
        />
      )}
      {showLoginModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-surface border border-border rounded-xl p-6 w-80 flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="font-heading font-bold text-text-primary text-[14.7px] uppercase tracking-widest">Gemini Auth</span>
              <p className="text-[13.7px] text-text-secondary leading-relaxed">Agrega GEMINI_API_KEY a ~/.bmp.env para continuar.</p>
            </div>
            <button onClick={() => setShowLoginModal(false)} className="py-2 rounded-lg bg-white text-black text-[13.7px] font-heading font-semibold uppercase tracking-widest hover:bg-white/90 transition-colors">Listo</button>
          </div>
        </div>
      )}
    </div>
  )
}

const CREDITS_MAX = 1000
function CreditsRing({ credits, plan }: { credits: number; plan: string }) {
  const R = 6; const CIRC = 2 * Math.PI * R; const pct = Math.min(credits / CREDITS_MAX, 1); const dash = pct * CIRC
  return (
    <div className="flex items-center gap-1.5">
      <svg width="16" height="16" viewBox="0 0 16 16">
        <circle cx="8" cy="8" r={R} stroke="currentColor" strokeWidth="2" fill="none" className="text-white/10" />
        <circle cx="8" cy="8" r={R} stroke="currentColor" strokeWidth="2" fill="none" className="text-accent" strokeDasharray={`${dash} ${CIRC}`} strokeLinecap="round" transform="rotate(-90 8 8)"/>
      </svg>
      <span className="text-[12.7px] font-mono text-text-muted tabular-nums">{credits} cr</span>
      {plan && <span className="text-[12.7px] font-mono text-text-muted/40 uppercase tracking-widest">{plan}</span>}
    </div>
  )
}
