import React, { useState } from 'react'

interface PromptOutputProps {
  prompt: string
}

export function PromptOutput({ prompt }: PromptOutputProps) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative bg-surface border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <span className="text-[10px] font-medium uppercase tracking-widest text-text-secondary font-heading">
          Generated Prompt
        </span>
        <button
          onClick={copy}
          className={`
            flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest
            px-2.5 py-1 rounded border transition-all duration-150
            ${copied
              ? 'border-accent text-accent bg-accent/10'
              : 'border-border text-text-secondary hover:border-[#2e2e2e] hover:text-text-primary'
            }
          `}
        >
          {copied ? (
            <>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <path d="M1.5 5l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Copied
            </>
          ) : (
            <>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect x="3" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M7 3V2a1 1 0 00-1-1H2a1 1 0 00-1 1v4a1 1 0 001 1h1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              Copy
            </>
          )}
        </button>
      </div>
      <pre className="prompt-output p-4 text-xs font-mono text-text-primary leading-relaxed whitespace-pre-wrap overflow-auto max-h-[200px]">
        {prompt}
      </pre>
    </div>
  )
}
