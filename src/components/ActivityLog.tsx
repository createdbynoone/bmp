import React, { useEffect, useRef } from 'react'

export interface LogEntry {
  ts: number
  line: string
}

interface ActivityLogProps {
  entries: LogEntry[]
  running: number
  onClear?: () => void
  className?: string
}

const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

function lineColor(line: string): string {
  const err = /error|failed|✗|not authenticated|no image|no video/i.test(line)
  const ok = /✓|saved:|generated\.|uploaded/i.test(line)
  if (err && ok) return 'text-orange-400'
  if (err) return 'text-red-400'
  if (ok) return 'text-green-400/90'
  if (line.startsWith('∠') || line.startsWith('▶')) return 'text-accent'
  if (/^(queued|processing|pending|running|waiting)/i.test(line)) return 'text-text-muted'
  return 'text-text-secondary'
}

export function ActivityLog({ entries, running, onClear, className = '' }: ActivityLogProps) {
  const bodyRef = useRef<HTMLDivElement>(null)
  // Stick to bottom unless the user scrolled up to read history
  const stickRef = useRef(true)

  useEffect(() => {
    const el = bodyRef.current
    if (el && stickRef.current) el.scrollTop = el.scrollHeight
  }, [entries, running])

  const handleScroll = () => {
    const el = bodyRef.current
    if (el) stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 28
  }

  return (
    <div className={`bg-[#0f0f0f] border border-border rounded-lg overflow-hidden flex flex-col min-h-0 ${className}`}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <span className="text-[11.7px] font-medium uppercase tracking-widest text-text-secondary font-heading">Activity</span>
          {running > 0 && (
            <span className="flex items-center gap-1.5 text-[11px] font-mono text-accent">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse flex-shrink-0" />
              {running > 1 ? `${running} tasks running` : 'task running'}
            </span>
          )}
        </div>
        {onClear && entries.length > 0 && running === 0 && (
          <button
            onClick={onClear}
            className="text-[11px] text-text-muted hover:text-text-secondary uppercase tracking-widest transition-colors"
          >
            Clear
          </button>
        )}
      </div>
      <div ref={bodyRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto px-4 py-2.5">
        {entries.length === 0 && running > 0 && (
          <p className="text-[11.7px] font-mono text-text-muted leading-relaxed">waiting for provider...</p>
        )}
        {entries.map((e, i) => (
          <div key={i} className="flex gap-2.5 items-baseline">
            <span className="text-[10.5px] font-mono text-white/25 tabular-nums flex-shrink-0 leading-[1.9]">{timeFmt.format(e.ts)}</span>
            <span className={`text-[11.7px] font-mono leading-[1.9] break-words min-w-0 ${lineColor(e.line)}`}>{e.line}</span>
          </div>
        ))}
        {running > 0 && <span className="inline-block w-[7px] h-[13px] bg-accent/70 animate-pulse ml-[52px] translate-y-[2px]" />}
      </div>
    </div>
  )
}
