/** True on phones that can hand this file to the OS share sheet. */
export function canShareFile(blob: Blob, filename: string): boolean {
  if (!window.matchMedia('(pointer: coarse)').matches || !navigator.canShare) return false
  return navigator.canShare({ files: [new File([blob], filename, { type: blob.type })] })
}

/** Must be called directly from a tap. */
export async function shareFile(blob: Blob, filename: string, title: string): Promise<'shared' | 'cancelled' | 'failed'> {
  try {
    await navigator.share({ files: [new File([blob], filename, { type: blob.type })], title })
    return 'shared'
  } catch (e) {
    return (e as DOMException).name === 'AbortError' ? 'cancelled' : 'failed'
  }
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** File-name-safe slug: "Acme Corp (Pune)" -> "acme-corp-pune". */
export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'all'
