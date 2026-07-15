"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

type Ripple = { id: number; x: number; y: number }

const INTERACTIVE =
  "a, button, [role='button'], input, textarea, select, label, summary, [data-cursor='interactive']"

function useFinePointer() {
  const [fine, setFine] = React.useState(false)

  React.useEffect(() => {
    const mq = window.matchMedia("(pointer: fine)")
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setFine(mq.matches && !reduce.matches)
    update()
    mq.addEventListener("change", update)
    reduce.addEventListener("change", update)
    return () => {
      mq.removeEventListener("change", update)
      reduce.removeEventListener("change", update)
    }
  }, [])

  return fine
}

export function CustomCursor() {
  const enabled = useFinePointer()
  const pos = React.useRef({ x: -100, y: -100 })
  const target = React.useRef({ x: -100, y: -100 })
  const hoveringRef = React.useRef(false)
  const pressedRef = React.useRef(false)
  const ringRef = React.useRef<HTMLDivElement>(null)
  const dotRef = React.useRef<HTMLDivElement>(null)
  const [hovering, setHovering] = React.useState(false)
  const [ripples, setRipples] = React.useState<Ripple[]>([])
  const rippleId = React.useRef(0)

  React.useEffect(() => {
    if (!enabled) return

    document.documentElement.classList.add("has-custom-cursor")

    let frame = 0
    const tick = () => {
      pos.current.x += (target.current.x - pos.current.x) * 0.22
      pos.current.y += (target.current.y - pos.current.y) * 0.22
      const { x, y } = pos.current
      const scale = pressedRef.current ? 0.7 : hoveringRef.current ? 1.55 : 1
      if (ringRef.current) {
        ringRef.current.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) scale(${scale})`
      }
      if (dotRef.current) {
        const opacity = hoveringRef.current ? 0 : 1
        dotRef.current.style.opacity = String(opacity)
        dotRef.current.style.transform = `translate3d(${target.current.x}px, ${target.current.y}px, 0) translate(-50%, -50%)`
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    const onMove = (event: MouseEvent) => {
      target.current = { x: event.clientX, y: event.clientY }
      const el = (event.target as Element | null)?.closest?.(INTERACTIVE)
      const next = Boolean(el && !el.hasAttribute("disabled"))
      hoveringRef.current = next
      setHovering(next)
    }

    const onDown = (event: MouseEvent) => {
      pressedRef.current = true
      const id = ++rippleId.current
      setRipples((prev) => [
        ...prev.slice(-4),
        { id, x: event.clientX, y: event.clientY },
      ])
      window.setTimeout(() => {
        setRipples((prev) => prev.filter((r) => r.id !== id))
      }, 550)
    }

    const onUp = () => {
      pressedRef.current = false
    }

    const onLeave = () => {
      target.current = { x: -100, y: -100 }
      hoveringRef.current = false
      pressedRef.current = false
      setHovering(false)
    }

    window.addEventListener("mousemove", onMove, { passive: true })
    window.addEventListener("mousedown", onDown)
    window.addEventListener("mouseup", onUp)
    window.addEventListener("mouseleave", onLeave)

    return () => {
      cancelAnimationFrame(frame)
      document.documentElement.classList.remove("has-custom-cursor")
      window.removeEventListener("mousemove", onMove)
      window.removeEventListener("mousedown", onDown)
      window.removeEventListener("mouseup", onUp)
      window.removeEventListener("mouseleave", onLeave)
    }
  }, [enabled])

  if (!enabled) return null

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[9998] hidden md:block"
    >
      <div
        ref={ringRef}
        className={cn(
          "fixed top-0 left-0 size-8 rounded-full border border-primary/70 bg-transparent will-change-transform",
          "transition-[border-color,background-color] duration-200 ease-out",
          hovering && "border-primary bg-primary/12"
        )}
      />
      <div
        ref={dotRef}
        className="fixed top-0 left-0 size-1.5 rounded-full bg-primary will-change-transform"
      />
      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          className="cursor-click-ripple fixed top-0 left-0 rounded-full border-2 border-primary"
          style={{
            transform: `translate3d(${ripple.x}px, ${ripple.y}px, 0) translate(-50%, -50%)`,
          }}
        />
      ))}
    </div>
  )
}
