import React, { useState, useEffect } from 'react'
import LockScreen from './components/LockScreen'
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
  const [provider, setProvider] = useState<Provider>('poyo')
  const [aspectRatio, setAspectRatio] = useState('4:5')
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

  // ── Shared state ──────────────────────────────────────────────────────────
  // Fire status + progress are scoped per mode so switching tabs never
  // interrupts or hides an in-flight task — it keeps running in background
  const [mode, setMode] = useState<Mode>('image')
  const [imageFireStatus, setImageFireStatus] = useState<FireStatus>('idle')
  const [videoFireStatus, setVideoFireStatus] = useState<FireStatus>('idle')
  const [imageProgress, setImageProgress] = useState<string[]>([])
  const [videoProgress, setVideoProgress] = useState<string[]>([])
  const [memoryStats, setMemoryStats] = useState<{ total: number; fired: number } | null>(null)
  const [credits, setCredits] = useState<{ credits: number | null; plan: string | null } | null>(null)
  const [appVersion, setAppVersion] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [showLoginModal, setShowLoginModal] = useState(false)

  const [authState, setAuthState] = useState<'checking' | 'locked' | 'unlocked'>('checking')
  const [lockUntil, setLockUntil] = useState(0)

  useEffect(() => {
    window.bmp.auth.status().then(res => {
      if (res.locked) { setLockUntil(res.lockUntil); setAuthState('locked') }
      else setAuthState('unlocked')
    })
  }, [])

  useEffect(() => {
    if (!window.bmp || authState !== 'unlocked') return
    const cleanup = window.bmp.onHiggsfieldProgress((evt) => {
      if (evt.scope === 'video') setVideoProgress((prev) => [...prev, evt.line])
      else setImageProgress((prev) => [...prev, evt.line])
    })
    return cleanup
  }, [authState])

  useEffect(() => {
    if (authState !== 'unlocked') return
    window.bmp?.checkHiggsfieldAuth?.().then((res: { authenticated: boolean }) => {
      if (!res.authenticated) { setShowLoginModal(true); window.bmp?.higgsfieldLogin?.() }
    })
    window.bmp?.getMemoryStats?.().then((s: { total: number; fired: number }) => setMemoryStats(s))
    window.bmp?.getHiggsfieldCredits?.().then((c) => setCredits(c))
    window.bmp?.getVersion?.().then((v) => setAppVersion(v))
  }, [authState])

  const handleProviderChange = (p: Provider) => {
    setProvider(p)
    // Both providers accept all IMAGE_RATIOS — only HF lacks 4k
    if (p === 'higgsfield' && resolution === '4k') setResolution('2k')
    setImageFireStatus('idle'); setImageProgress([])
  }

  // Switching tabs only changes the view — running tasks keep going in background
  const handleModeChange = (m: Mode) => setMode(m)

  // ── Image: generate prompt ────────────────────────────────────────────────
  const canGenerate = refs.length > 0 && products.length > 0 && description.trim().length > 0

  const handleGenerate = async () => {
    if (!canGenerate) return
    setGenerateStatus('loading'); setPrompt(''); setError(''); setImageFireStatus('idle'); setImageProgress([])
    try {
      const result = await window.bmp.generatePrompt({ refs, products, description })
      setPrompt(result.prompt); setMemoryId(result.memoryId); setGenerateStatus('done')
      window.bmp?.getMemoryStats?.().then((s: { total: number; fired: number }) => setMemoryStats(s))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed'); setGenerateStatus('error')
    }
  }

  // ── Image: fire ───────────────────────────────────────────────────────────
  const markFired = () => {
    if (!memoryId) return
    window.bmp?.markPromptFired?.({ id: memoryId, aspectRatio })
    window.bmp?.getMemoryStats?.().then((s: { total: number; fired: number }) => setMemoryStats(s))
  }

  // Fire N prompts in parallel with the active provider. For POYO, product refs
  // are uploaded ONCE and their URLs shared across tasks — re-uploading the same
  // images per parallel task bursts POYO's rate limits (max 14 refs per request)
  const fireBatch = async (prompts: string[]): Promise<number> => {
    let poyoUrls: string[] | undefined
    if (provider === 'poyo' && products.length > 0 && prompts.length > 1) {
      const { urls } = await window.bmp.uploadPoyoRefs({ products })
      poyoUrls = urls
    }
    const settled = await Promise.allSettled(
      prompts.map((p) =>
        provider === 'poyo'
          ? window.bmp.firePoyoImage({ prompt: p, products, aspectRatio, resolution, imageUrls: poyoUrls })
          : window.bmp.fireHighsfield({ prompt: p, aspectRatio, products, resolution })
      )
    )
    return settled.filter((s) => s.status === 'fulfilled' && s.value.success).length
  }

  const handleFire = async () => {
    if (!prompt) return
    setImageFireStatus('loading'); setImageProgress([])
    try {
      const succeeded = await fireBatch(Array.from({ length: variations }, () => prompt))
      const failed = variations - succeeded
      if (variations > 1) {
        setImageProgress((prev) => [...prev, failed === 0 ? `All ${variations} variations generated.` : succeeded === 0 ? `All ${variations} variations failed.` : `${succeeded}/${variations} generated — ${failed} failed.`])
      }
      setImageFireStatus(succeeded > 0 ? 'done' : 'error')
      if (succeeded > 0) markFired()
    } catch (err) {
      setImageFireStatus('error'); setImageProgress((prev) => [...prev, err instanceof Error ? err.message : 'Unknown error'])
    }
  }

  // ── Image: fire 4 angle variations (Claude rewrites camera work) ──────────
  const handleFireAngles = async () => {
    if (!prompt) return
    setImageFireStatus('loading'); setImageProgress(['Generating angle variations with Claude...'])
    try {
      const { variants } = await window.bmp.generateAngleVariations({ prompt })
      setImageProgress((prev) => [...prev, ...variants.map((v) => `∠ ${v.label}`), `Firing ${variants.length} angles...`])
      const succeeded = await fireBatch(variants.map((v) => v.prompt))
      setImageProgress((prev) => [...prev, succeeded === variants.length ? `All ${variants.length} angles generated.` : succeeded === 0 ? `All ${variants.length} angles failed.` : `${succeeded}/${variants.length} angles generated.`])
      setImageFireStatus(succeeded > 0 ? 'done' : 'error')
      if (succeeded > 0) markFired()
    } catch (err) {
      setImageFireStatus('error'); setImageProgress((prev) => [...prev, err instanceof Error ? err.message : 'Unknown error'])
    }
  }

  // ── Video: fire ───────────────────────────────────────────────────────────
  const handleFireVideo = async () => {
    if (!videoPrompt.trim()) return
    setVideoFireStatus('loading'); setVideoProgress([])
    try {
      const result = await window.bmp.fireVideo({
        prompt: videoPrompt,
        products: frames,
        videoModel,
        aspectRatio: videoAspectRatio,
        resolution: videoResolution,
        duration,
      })
      setVideoFireStatus(result.success ? 'done' : 'error')
    } catch (err) {
      setVideoFireStatus('error'); setVideoProgress((prev) => [...prev, err instanceof Error ? err.message : 'Unknown error'])
    }
  }

  const reset = () => {
    if (mode === 'image') {
      setRefs([]); setProducts([]); setDescription(''); setPrompt(''); setGenerateStatus('idle'); setMemoryId(null); setVariations(1); setError('')
      setImageFireStatus('idle'); setImageProgress([])
    } else {
      setVideoPrompt(''); setFrames([])
      setVideoFireStatus('idle'); setVideoProgress([])
    }
  }

  const footerLabel = mode === 'video'
    ? `seedance-2 · ${videoAspectRatio} · ${videoResolution} · ${duration}s`
    : `${provider === 'higgsfield' ? 'higgsfield' : 'nano-banana-2'} · ${aspectRatio} · ${resolution.toUpperCase()}`

  const fireDisabled = mode === 'video' ? !videoPrompt.trim() : !prompt

  if (authState === 'checking') return null

  if (authState === 'locked') {
    return <LockScreen initialLockUntil={lockUntil} onUnlocked={() => setAuthState('unlocked')} />
  }

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
          {(['image', 'video'] as Mode[]).map((m) => {
            const busy = m === 'image' ? imageFireStatus === 'loading' : videoFireStatus === 'loading'
            return (
              <button
                key={m}
                onClick={() => handleModeChange(m)}
                className={`
                  flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[11.7px] font-heading font-semibold uppercase tracking-widest transition-all duration-150
                  ${mode === m ? 'bg-white/12 text-white' : 'text-text-muted hover:text-white/60'}
                `}
              >
                {m === 'image' ? 'Image' : 'Video'}
                {busy && <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse flex-shrink-0" />}
              </button>
            )
          })}
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

            {imageProgress.length > 0 && (
              <div className="bg-[#0f0f0f] border border-border rounded-lg px-3 py-2 max-h-[80px] overflow-y-auto flex-shrink-0">
                {imageProgress.map((line, i) => (
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
            progress={videoProgress}
          />
        )}
      </div>

      {/* Bottom bar */}
      <div className="flex-shrink-0 border-t border-border px-4 py-3">
        <HiggsfieldButton
          status={mode === 'video' ? videoFireStatus : imageFireStatus}
          onClick={mode === 'video' ? handleFireVideo : handleFire}
          onAngles={handleFireAngles}
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
              <span className="font-heading font-bold text-text-primary text-[14.7px] uppercase tracking-widest">POYO Auth</span>
              <p className="text-[13.7px] text-text-secondary leading-relaxed">Agrega POYO_API_KEY a ~/.bmp.env para continuar.</p>
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
