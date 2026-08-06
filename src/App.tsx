import React, { useState, useEffect, useRef } from 'react'
import LockScreen from './components/LockScreen'
import { DropZone } from './components/DropZone'
import { PromptOutput } from './components/PromptOutput'
import { HiggsfieldButton } from './components/HiggsfieldButton'
import { UpdateBar } from './components/UpdateBar'
import { SettingsModal } from './components/SettingsModal'
import { PromptHistoryModal } from './components/PromptHistoryModal'
import { VideoMode } from './components/VideoMode'
import { ModelMode } from './components/ModelMode'
import { ActivityLog, type LogEntry } from './components/ActivityLog'
import type { Provider, Mode, ModelEngine, ModelGender } from './components/HiggsfieldButton'

type GenerateStatus = 'idle' | 'loading' | 'done' | 'error'
type FireResult = 'idle' | 'done' | 'error'

export interface ModelResult {
  sku: string
  gender: ModelGender
  full: string
  face: string
}

const LOG_CAP = 400

// Preselects the SMF/SMM SKU category from the pasted prompt; the toggle in the
// bottom bar can always override it ("woman" never matches \bman\b)
function detectGender(prompt: string): ModelGender | null {
  if (/\b(female|woman|women|girl|mujer|chica|femenin[ao]|she|her)\b/i.test(prompt)) return 'female'
  if (/\b(male|man|men|hombre|chico|masculin[ao]|guy|he|him)\b/i.test(prompt)) return 'male'
  return null
}

export default function App() {
  // ── Image mode state ──────────────────────────────────────────────────────
  const [refs, setRefs] = useState<string[]>([])
  const [products, setProducts] = useState<string[]>([])
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const [generateStatus, setGenerateStatus] = useState<GenerateStatus>('idle')
  const [error, setError] = useState('')
  const [memoryId, setMemoryId] = useState<string | null>(null)
  const [provider, setProvider] = useState<Provider>('nanobanana')
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

  // ── Model mode state (AI model creation) ──────────────────────────────────
  const [modelPrompt, setModelPrompt] = useState('')
  const [modelEngine, setModelEngine] = useState<ModelEngine>('nb2')
  const [modelAspectRatio, setModelAspectRatio] = useState('4:5')
  const [modelResolution, setModelResolution] = useState('2k')
  const [modelGender, setModelGender] = useState<ModelGender>('female')
  const [modelResults, setModelResults] = useState<ModelResult[]>([])

  const handleModelPrompt = (p: string) => {
    setModelPrompt(p)
    const g = detectGender(p)
    if (g) setModelGender(g)
  }

  // ── Shared state ──────────────────────────────────────────────────────────
  // Fire tasks are ref-counted per mode: nothing in the UI (generating a new
  // prompt, switching provider/tab, firing another batch) resets or hides an
  // in-flight task — it strictly runs until it finishes. Status is derived:
  // loading while any task is active, otherwise the last settled result.
  const [mode, setMode] = useState<Mode>('image')
  const [imageTasks, setImageTasks] = useState(0)
  const [videoTasks, setVideoTasks] = useState(0)
  const [modelTasks, setModelTasks] = useState(0)
  const [imageResult, setImageResult] = useState<FireResult>('idle')
  const [videoResult, setVideoResult] = useState<FireResult>('idle')
  const [modelResult, setModelResult] = useState<FireResult>('idle')
  const [imageLog, setImageLog] = useState<LogEntry[]>([])
  const [videoLog, setVideoLog] = useState<LogEntry[]>([])
  const [modelLog, setModelLog] = useState<LogEntry[]>([])
  const [memoryStats, setMemoryStats] = useState<{ total: number; fired: number } | null>(null)
  const [credits, setCredits] = useState<{ credits: number | null; plan: string | null } | null>(null)
  const [appVersion, setAppVersion] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [showLoginModal, setShowLoginModal] = useState(false)

  const [authState, setAuthState] = useState<'checking' | 'locked' | 'unlocked'>('checking')
  const [lockUntil, setLockUntil] = useState(0)

  // Guard against accidental double-clicks now that fire stays enabled
  // while other batches run in parallel
  const lastFireRef = useRef(0)
  const fireGate = () => {
    const now = Date.now()
    if (now - lastFireRef.current < 600) return false
    lastFireRef.current = now
    return true
  }

  const logSetters = { image: setImageLog, video: setVideoLog, model: setModelLog } as const

  const pushLog = (scope: 'image' | 'video' | 'model', line: string) => {
    logSetters[scope]((prev) => [...prev.slice(-LOG_CAP), { ts: Date.now(), line }])
  }

  const imageFireStatus = imageTasks > 0 ? 'loading' : imageResult
  const videoFireStatus = videoTasks > 0 ? 'loading' : videoResult
  const modelFireStatus = modelTasks > 0 ? 'loading' : modelResult

  useEffect(() => {
    window.bmp.auth.status().then(res => {
      if (res.locked) { setLockUntil(res.lockUntil); setAuthState('locked') }
      else setAuthState('unlocked')
    })
  }, [])

  useEffect(() => {
    if (!window.bmp || authState !== 'unlocked') return
    const cleanup = window.bmp.onHiggsfieldProgress((evt) => {
      const set = logSetters[evt.scope] ?? setImageLog
      set((prev) => [...prev.slice(-LOG_CAP), { ts: Date.now(), line: evt.line }])
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
    // Seedream 5.0 Pro tops out at 2K — only Nano Banana Pro goes to 4K.
    // Running tasks captured their provider at fire time; never reset them here.
    if (p === 'seedream' && resolution === '4k') setResolution('2k')
  }

  // Switching tabs only changes the view — running tasks keep going in background
  const handleModeChange = (m: Mode) => setMode(m)

  // ── Image: generate prompt ────────────────────────────────────────────────
  const canGenerate = refs.length > 0 && products.length > 0 && description.trim().length > 0

  const handleGenerate = async () => {
    if (!canGenerate) return
    // Only prompt-generation state is touched here — any fire task in flight
    // keeps its log and status untouched and runs to completion
    setGenerateStatus('loading'); setPrompt(''); setError('')
    pushLog('image', '▶ Claude · generating prompt...')
    try {
      const result = await window.bmp.generatePrompt({ refs, products, description })
      setPrompt(result.prompt); setMemoryId(result.memoryId); setGenerateStatus('done')
      pushLog('image', 'Prompt ready ✓')
      window.bmp?.getMemoryStats?.().then((s: { total: number; fired: number }) => setMemoryStats(s))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Generation failed'
      setError(msg); setGenerateStatus('error')
      pushLog('image', `Prompt generation failed — ${msg}`)
    }
  }

  // ── Image: fire ───────────────────────────────────────────────────────────
  const markFired = (id: string | null) => {
    if (!id) return
    window.bmp?.markPromptFired?.({ id, aspectRatio })
    window.bmp?.getMemoryStats?.().then((s: { total: number; fired: number }) => setMemoryStats(s))
  }

  // Fire N prompts in parallel with the active provider (both go through Runware).
  // Product refs are prepared ONCE and shared across tasks — re-encoding the
  // same images per parallel task wastes work (max 14 refs per request)
  const fireBatch = async (prompts: string[]): Promise<number> => {
    let refUrls: string[] | undefined
    if (products.length > 0 && prompts.length > 1) {
      const { urls } = await window.bmp.uploadPoyoRefs({ products })
      refUrls = urls
    }
    const settled = await Promise.allSettled(
      prompts.map((p) =>
        window.bmp.firePoyoImage({ prompt: p, products, aspectRatio, resolution, provider, imageUrls: refUrls })
      )
    )
    return settled.filter((s) => s.status === 'fulfilled' && s.value.success).length
  }

  const handleFire = async () => {
    if (!prompt || !fireGate()) return
    const firedMemoryId = memoryId
    setImageTasks((n) => n + 1)
    pushLog('image', `▶ ${provider === 'seedream' ? 'Seedream 5.0' : 'Nano Banana Pro'} ×${variations} · ${aspectRatio} · ${resolution.toUpperCase()}`)
    try {
      const succeeded = await fireBatch(Array.from({ length: variations }, () => prompt))
      const failed = variations - succeeded
      if (variations > 1) {
        pushLog('image', failed === 0 ? `All ${variations} variations generated.` : succeeded === 0 ? `All ${variations} variations failed.` : `${succeeded}/${variations} generated — ${failed} failed.`)
      }
      setImageResult(succeeded > 0 ? 'done' : 'error')
      if (succeeded > 0) markFired(firedMemoryId)
    } catch (err) {
      setImageResult('error'); pushLog('image', err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setImageTasks((n) => n - 1)
    }
  }

  // ── Model: fire (AI model creation — full shot + auto macro face + SKU) ───
  const handleFireModel = async () => {
    if (!modelPrompt.trim() || !fireGate()) return
    const gender = modelGender
    setModelTasks((n) => n + 1)
    pushLog('model', `▶ ${modelEngine === 'recraft' ? 'Recraft v4.1 Pro' : 'Nano Banana 2'} · ${modelAspectRatio}${modelEngine === 'nb2' ? ` · ${modelResolution.toUpperCase()}` : ' · 4MP'} · ${gender === 'male' ? 'SMM' : 'SMF'}`)
    try {
      const result = await window.bmp.fireModel({
        prompt: modelPrompt,
        engine: modelEngine,
        aspectRatio: modelAspectRatio,
        resolution: modelResolution,
        gender,
      })
      if (result.success && result.outputPath) {
        setModelResults((prev) => [{ sku: result.sku, gender, full: result.outputPath, face: result.facePath }, ...prev])
      }
      setModelResult(result.success ? 'done' : 'error')
    } catch (err) {
      setModelResult('error'); pushLog('model', err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setModelTasks((n) => n - 1)
    }
  }

  // ── Video: fire ───────────────────────────────────────────────────────────
  const handleFireVideo = async () => {
    if (!videoPrompt.trim() || !fireGate()) return
    setVideoTasks((n) => n + 1)
    pushLog('video', `▶ Seedance 2 (${videoModel === 'seedance-2' ? 'PRO' : 'FAST'}) · ${videoAspectRatio} · ${videoResolution} · ${duration}s`)
    try {
      const result = await window.bmp.fireVideo({
        prompt: videoPrompt,
        products: frames,
        videoModel,
        aspectRatio: videoAspectRatio,
        resolution: videoResolution,
        duration,
      })
      setVideoResult(result.success ? 'done' : 'error')
    } catch (err) {
      setVideoResult('error'); pushLog('video', err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setVideoTasks((n) => n - 1)
    }
  }

  const reset = () => {
    if (mode === 'image') {
      setRefs([]); setProducts([]); setDescription(''); setPrompt(''); setGenerateStatus('idle'); setMemoryId(null); setVariations(1); setError('')
      // Keep the log alive if tasks are still running — they finish regardless
      if (imageTasks === 0) { setImageResult('idle'); setImageLog([]) }
    } else if (mode === 'model') {
      setModelPrompt(''); setModelResults([])
      if (modelTasks === 0) { setModelResult('idle'); setModelLog([]) }
    } else {
      setVideoPrompt(''); setFrames([])
      if (videoTasks === 0) { setVideoResult('idle'); setVideoLog([]) }
    }
  }

  const footerLabel = mode === 'video'
    ? `seedance-2 · ${videoAspectRatio} · ${videoResolution} · ${duration}s`
    : mode === 'model'
      ? `${modelEngine === 'recraft' ? 'recraft-v4.1-pro' : 'nano-banana-2'} · ${modelAspectRatio}${modelEngine === 'nb2' ? ` · ${modelResolution.toUpperCase()}` : ' · 4MP'} · ${modelGender === 'male' ? 'SMM' : 'SMF'} + face macro`
      : `${provider === 'seedream' ? 'seedream-5.0-pro' : 'nano-banana-pro'} · ${aspectRatio} · ${resolution.toUpperCase()}`

  const fireDisabled = mode === 'video' ? !videoPrompt.trim() : mode === 'model' ? !modelPrompt.trim() : !prompt

  const showImageLog = imageLog.length > 0 || imageTasks > 0

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
          {(['image', 'video', 'model'] as Mode[]).map((m) => {
            const busy = m === 'image' ? imageTasks > 0 : m === 'model' ? modelTasks > 0 : videoTasks > 0
            return (
              <button
                key={m}
                onClick={() => handleModeChange(m)}
                className={`
                  flex items-center gap-1.5 px-4 py-1.5 rounded-md text-[11.7px] font-heading font-semibold uppercase tracking-widest transition-all duration-150
                  ${mode === m ? 'bg-white/12 text-white' : 'text-text-muted hover:text-white/60'}
                `}
              >
                {m === 'image' ? 'Image' : m === 'video' ? 'Video' : 'Model'}
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
            <div className="grid grid-cols-2 gap-3 flex-shrink-0">
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
            <div className="bg-surface border border-border rounded-lg p-3 flex flex-col gap-2 flex-shrink-0">
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
            <div className="flex gap-2 flex-shrink-0">
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
              <div className="bg-red-500/5 border border-red-500/20 rounded-lg px-4 py-3 flex-shrink-0">
                <p className="text-[13.7px] text-red-400 font-mono">{error}</p>
              </div>
            )}

            {/* Prompt + activity share the remaining height — no dead space.
                flex-basis 0 keeps each panel scrolling internally instead of
                stretching the page */}
            {prompt && (
              <PromptOutput prompt={prompt} className={showImageLog ? 'flex-[3] min-h-[140px]' : 'flex-1 min-h-[140px]'} />
            )}

            {showImageLog && (
              <ActivityLog
                entries={imageLog}
                running={imageTasks}
                onClear={() => { setImageLog([]); setImageResult('idle') }}
                className={prompt ? 'flex-[2] min-h-[110px]' : 'flex-1 min-h-[110px]'}
              />
            )}

            {!prompt && !showImageLog && generateStatus === 'idle' && (
              <div className="flex-1 flex items-center justify-center py-6">
                <p className="text-[11.7px] text-text-muted uppercase tracking-[0.2em] font-heading">Drop refs + product · Write brief · Generate</p>
              </div>
            )}
          </>
        ) : mode === 'model' ? (
          <ModelMode
            prompt={modelPrompt}
            onPrompt={handleModelPrompt}
            results={modelResults}
            entries={modelLog}
            running={modelTasks}
            onClearLog={() => { setModelLog([]); setModelResult('idle') }}
          />
        ) : (
          <VideoMode
            prompt={videoPrompt}
            onPrompt={setVideoPrompt}
            frames={frames}
            onFrames={setFrames}
            entries={videoLog}
            running={videoTasks}
            onClearLog={() => { setVideoLog([]); setVideoResult('idle') }}
          />
        )}
      </div>

      {/* Bottom bar */}
      <div className="flex-shrink-0 border-t border-border px-4 py-3">
        <HiggsfieldButton
          status={mode === 'video' ? videoFireStatus : mode === 'model' ? modelFireStatus : imageFireStatus}
          running={mode === 'video' ? videoTasks : mode === 'model' ? modelTasks : imageTasks}
          onClick={mode === 'video' ? handleFireVideo : mode === 'model' ? handleFireModel : handleFire}
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
          modelEngine={modelEngine}
          onModelEngine={setModelEngine}
          modelAspectRatio={modelAspectRatio}
          onModelAspectRatio={setModelAspectRatio}
          modelResolution={modelResolution}
          onModelResolution={setModelResolution}
          modelGender={modelGender}
          onModelGender={setModelGender}
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
              <span className="font-heading font-bold text-text-primary text-[14.7px] uppercase tracking-widest">Runware Auth</span>
              <p className="text-[13.7px] text-text-secondary leading-relaxed">Agrega RUNWARE_API_KEY a ~/.bmp.env para continuar.</p>
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
