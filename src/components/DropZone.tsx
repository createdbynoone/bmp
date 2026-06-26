import React, { useCallback, useState } from 'react'

interface DropZoneProps {
  label: string
  multiple?: boolean
  files: string[]
  onFiles: (paths: string[]) => void
}

export function DropZone({ label, multiple = false, files, onFiles }: DropZoneProps) {
  const [dragging, setDragging] = useState(false)

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      const dropped = Array.from(e.dataTransfer.files).map((f) => f.path)
      if (!dropped.length) return
      onFiles(multiple ? [...files, ...dropped] : dropped)
    },
    [files, multiple, onFiles]
  )

  const removeFile = (idx: number) => {
    onFiles(files.filter((_, i) => i !== idx))
  }

  return (
    <div className="flex flex-col gap-2 h-full">
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`
          flex-1 flex flex-col items-center justify-center gap-2 rounded-lg border
          transition-all duration-150 cursor-pointer min-h-[120px]
          ${dragging
            ? 'border-accent bg-accent/5 scale-[1.01]'
            : 'border-border bg-surface hover:border-[#2e2e2e] hover:bg-[#161616]'
          }
        `}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" className={dragging ? 'text-accent' : 'text-text-secondary'}>
          <path d="M10 2v12M4 8l6-6 6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M3 16h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
        <span className="text-[13.7px] font-medium text-text-secondary uppercase tracking-widest">
          {label}
        </span>
        <span className="text-[11.7px] text-text-muted">
          {multiple ? 'Drop multiple images' : 'Drop an image'}
        </span>
      </div>

      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5 max-h-[80px] overflow-y-auto">
          {files.map((path, idx) => {
            const name = path.split('/').pop() ?? path
            return (
              <div
                key={idx}
                className="group relative flex items-center gap-1 bg-[#161616] border border-border rounded px-2 py-1"
              >
                <div className="w-6 h-6 rounded overflow-hidden flex-shrink-0 bg-[#1e1e1e]">
                  <img
                    src={`localfile://${path}`}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                </div>
                <span className="text-[11.7px] text-text-secondary max-w-[80px] truncate">{name}</span>
                <button
                  onClick={() => removeFile(idx)}
                  className="ml-0.5 text-text-muted hover:text-text-primary transition-colors opacity-0 group-hover:opacity-100"
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                    <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                  </svg>
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
