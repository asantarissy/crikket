"use client"

import { cn } from "@crikket/ui/lib/utils"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { useCallback, useEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { Button } from "./ui/button"

interface ModeToggleProps extends React.ComponentPropsWithoutRef<"button"> {
  duration?: number
}

export const ModeToggle = ({
  className,
  duration = 400,
  ...props
}: ModeToggleProps) => {
  const [isDark, setIsDark] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const { resolvedTheme, setTheme } = useTheme()

  useEffect(() => {
    setIsDark(resolvedTheme === "dark")
  }, [resolvedTheme])

  const toggleTheme = useCallback(async () => {
    if (!buttonRef.current) return
    const newTheme = isDark ? "light" : "dark"

    if (document.startViewTransition) {
      await document.startViewTransition(() => {
        flushSync(() => {
          setTheme(newTheme)
          setIsDark(newTheme === "dark")
        })
      }).ready
    } else {
      flushSync(() => {
        setTheme(newTheme)
        setIsDark(newTheme === "dark")
      })
    }

    const { top, left, width, height } =
      buttonRef.current.getBoundingClientRect()
    const x = left + width / 2
    const y = top + height / 2
    const maxRadius = Math.hypot(
      Math.max(left, window.innerWidth - left),
      Math.max(top, window.innerHeight - top)
    )

    document.documentElement.animate(
      {
        clipPath: [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${maxRadius}px at ${x}px ${y}px)`,
        ],
      },
      {
        duration,
        easing: "ease-in-out",
        pseudoElement: "::view-transition-new(root)",
      }
    )
  }, [duration, isDark, setTheme])

  return (
    <Button
      className={cn(className)}
      onClick={toggleTheme}
      ref={buttonRef}
      size="icon"
      variant="ghost"
      {...props}
    >
      {isDark ? <Sun /> : <Moon />}
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
