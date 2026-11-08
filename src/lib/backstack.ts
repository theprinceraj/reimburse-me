import { useEffect, useRef } from 'react'

/**
 * One history stack shared by every closable layer (sheets, photo viewer), so the Android back
 * gesture closes the top layer only, and a layer closed by its own button removes its history
 * entry without the pending `history.back()` closing whatever opens next.
 */
type Layer = { onBack: () => void }

const stack: Layer[] = []
const deferred: (() => void)[] = []
let expectedPops = 0

window.addEventListener('popstate', () => {
  if (expectedPops > 0) {
    expectedPops--
    if (expectedPops === 0) for (const push of deferred.splice(0)) push()
    return
  }
  stack.pop()?.onBack()
})

/** Adds a history entry for a layer. Returns a release function for closes not caused by back. */
function pushLayer(onBack: () => void): () => void {
  const layer: Layer = { onBack }
  const push = () => {
    history.pushState({ layer: true }, '')
    stack.push(layer)
  }
  if (expectedPops > 0) deferred.push(push)
  else push()
  return () => {
    const i = stack.indexOf(layer)
    if (i === -1) {
      const d = deferred.indexOf(push)
      if (d !== -1) deferred.splice(d, 1)
      return
    }
    stack.splice(i, 1)
    expectedPops++
    history.back()
  }
}

/**
 * While `open`, the back gesture calls `onBack` instead of leaving the page. Bump `generation`
 * to re-arm after a back press that was intercepted (e.g. to ask "discard changes?").
 */
export function useBackLayer(open: boolean, onBack: () => void, generation = 0) {
  const ref = useRef(onBack)
  ref.current = onBack
  useEffect(() => {
    if (!open) return
    let poppedByBack = false
    const release = pushLayer(() => {
      poppedByBack = true
      ref.current()
    })
    return () => {
      if (!poppedByBack) release()
    }
  }, [open, generation])
}
