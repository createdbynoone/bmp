import React, { useState, useEffect } from 'react'

interface Props {
  onClose: () => void
}

export function SettingsModal({ onClose }: Props) {
  const [outputPath, setOutputPath] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.bmp?.getOutputPath?.().then(setOutputPath)
  }, [])

  const handleBrowse = async () => {
    const chosen = await window.bmp?.openFolderDialog?.()
    if (chosen) {
      setOutputPath(chosen)
      setSaved(false)
    }
  }

  const handleSave = async () => {
    await window.bmp?.setOutputPath?.(outputPath)
    setSaved(true)
    setTimeout(onClose, 600)
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-surface border border-border rounded-xl p-6 w-[420px] flex flex-col gap-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="font-heading font-bold text-text-primary text-[14.7px] uppercase tracking-widest">Settings</span>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-secondary transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 2l10 10M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Output path */}
        <div className="flex flex-col gap-2">
          <label className="text-[11.7px] font-heading font-semibold uppercase tracking-widest text-text-secondary">
            Output Folder
          </label>
          <p className="text-[11.7px] text-text-muted leading-relaxed">
            Las imágenes generadas por Higgsfield se guardarán en esta carpeta.
          </p>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 min-w-0">
              <p className="text-[12.7px] font-mono text-text-secondary truncate" title={outputPath}>
                {outputPath || '—'}
              </p>
            </div>
            <button
              onClick={handleBrowse}
              className="flex-shrink-0 px-3 py-2 rounded-lg border border-border text-[11.7px] font-heading font-semibold uppercase tracking-widest text-text-secondary hover:border-white/30 hover:text-text-primary transition-colors"
            >
              Browse
            </button>
          </div>
        </div>

        {/* Save */}
        <button
          onClick={handleSave}
          disabled={!outputPath}
          className={`
            w-full py-2.5 rounded-lg font-heading font-semibold text-[13.7px] uppercase tracking-widest border transition-all duration-150
            ${saved
              ? 'border-green-500/40 bg-green-500/10 text-green-400'
              : !outputPath
              ? 'border-border text-text-muted cursor-not-allowed'
              : 'border-accent bg-accent text-bg hover:bg-accent/90 active:scale-[0.99]'
            }
          `}
        >
          {saved ? 'Saved ✓' : 'Save'}
        </button>

      </div>
    </div>
  )
}
