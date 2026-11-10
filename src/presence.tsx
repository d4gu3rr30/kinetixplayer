import { useEffect, useRef, useState, type ReactNode } from 'react'

export function usePresence(open: boolean, duration = 240) {
  const [mounted, setMounted] = useState(open)
  useEffect(() => {
    if (open) { setMounted(true); return }
    if (!mounted) return
    const timer = setTimeout(() => setMounted(false), duration)
    return () => clearTimeout(timer)
  }, [open, mounted, duration])
  return { mounted, closing: mounted && !open }
}

export function Presence({ open, children, duration = 240 }: { open: boolean; children: ReactNode; duration?: number }) {
  const { mounted, closing } = usePresence(open, duration)
  const cached = useRef<ReactNode>(children)
  if (open) cached.current = children
  if (!mounted) return null
  return <div className={closing ? 'presence presence-closing' : 'presence'}>{cached.current}</div>
}
