import { useEffect, useRef, useState } from 'react'

interface Props {
  initialLockUntil: number
  onUnlocked: () => void
}

export default function LockScreen({ initialLockUntil, onUnlocked }: Props) {
  const [key, setKey]         = useState('')
  const [error, setError]     = useState(false)
  const [shake, setShake]     = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [lockUntil, setLockUntil]   = useState(initialLockUntil)
  const [now, setNow]         = useState(Date.now())
  const inputRef = useRef<HTMLInputElement>(null)

  const locked = lockUntil > now

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!locked) return
    const t = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(t)
  }, [locked])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (locked || submitting || !key) return
    setSubmitting(true)
    try {
      const res = await window.bmp.auth.unlock(key)
      if (res.ok) {
        onUnlocked()
        return
      }
      setLockUntil(res.lockUntil)
      setError(true)
      setShake(true)
      setKey('')
      setTimeout(() => setShake(false), 400)
    } finally {
      setSubmitting(false)
    }
  }

  const secondsLeft = Math.max(0, Math.ceil((lockUntil - now) / 1000))

  return (
    <div className="titlebar-drag w-full h-screen flex flex-col items-center justify-center bg-bg">
      <form onSubmit={handleSubmit} className={`titlebar-nodrag flex flex-col items-center gap-8 max-w-sm w-full px-8 ${shake ? 'animate-shake' : ''}`}>
        <div className="text-center">
          <h1 className="font-heading text-[19px] font-semibold text-text-primary tracking-tight uppercase">
            Locked
          </h1>
          <p className="text-[12.7px] text-text-secondary mt-1">
            Enter the key to unlock BMP
          </p>
        </div>

        <div className="w-full flex flex-col gap-3">
          <input
            ref={inputRef}
            type="password"
            value={key}
            onChange={e => { setKey(e.target.value); setError(false) }}
            disabled={locked || submitting}
            autoComplete="off"
            spellCheck={false}
            placeholder="Key"
            className="w-full px-4 py-3 rounded-xl bg-surface border border-border text-text-primary text-[14.7px] tracking-widest text-center placeholder:text-text-muted focus:outline-none focus:border-accent/60 disabled:opacity-40 transition-colors"
          />
          <button
            type="submit"
            disabled={locked || submitting || !key}
            className="w-full px-5 py-3 rounded-xl bg-accent text-bg font-medium text-[13.7px] hover:bg-accent/90 active:scale-[0.99] transition-all disabled:opacity-40"
          >
            {locked ? `Try again in ${secondsLeft}s` : submitting ? 'Checking…' : 'Unlock'}
          </button>
        </div>

        {error && !locked && (
          <p className="text-[12.7px] text-red-400 text-center px-2 -mt-2">Incorrect key</p>
        )}
      </form>
    </div>
  )
}
