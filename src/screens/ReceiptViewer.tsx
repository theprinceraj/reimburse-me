import { ChevronLeft, ChevronRight, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { IconButton } from '../components/ui'
import { useObjectUrl } from '../hooks'
import { overlayView, track } from '../lib/analytics'
import { useBackLayer } from '../lib/backstack'

/** Full-screen receipt photo on dark ink, with paging and remove. */
export function ReceiptViewer({ blobs, start, onClose, onDelete }: { blobs: Blob[]; start: number; onClose: () => void; onDelete?: (i: number) => void }) {
  const [i, setI] = useState(start)
  const url = useObjectUrl(blobs[i])
  useBackLayer(true, onClose)

  useEffect(() => {
    track('receipt_view', { receipt_count: blobs.length })
    return overlayView('receipt')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        onClose()
      }
      if (e.key === 'ArrowRight') setI((x) => Math.min(blobs.length - 1, x + 1))
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [blobs.length, onClose])

  return (
    <div className="fixed inset-0 z-[60] flex animate-fade-in flex-col bg-[#1B1A17]" role="dialog" aria-label="Receipt">
      <div className="flex items-center justify-between px-2 pt-[max(8px,env(safe-area-inset-top))] text-inverse-ink">
        <IconButton label="Close" onClick={onClose} className="text-inverse-ink active:bg-white/10">
          <X size={22} />
        </IconButton>
        <span className="t-num-sm text-inverse-ink/70">
          {i + 1} / {blobs.length}
        </span>
        {onDelete ? (
          <IconButton label="Remove receipt" onClick={() => onDelete(i)} className="text-inverse-ink active:bg-white/10">
            <Trash2 size={20} />
          </IconButton>
        ) : (
          <span className="size-10" />
        )}
      </div>
      <div className="relative flex flex-1 items-center justify-center overflow-hidden p-4">
        {url && <img src={url} alt="Receipt" className="max-h-full max-w-full rounded-field object-contain" />}
        {i > 0 && (
          <IconButton label="Previous" onClick={() => setI(i - 1)} className="absolute left-2 bg-white/10 text-inverse-ink">
            <ChevronLeft size={22} />
          </IconButton>
        )}
        {i < blobs.length - 1 && (
          <IconButton label="Next" onClick={() => setI(i + 1)} className="absolute right-2 bg-white/10 text-inverse-ink">
            <ChevronRight size={22} />
          </IconButton>
        )}
      </div>
    </div>
  )
}
