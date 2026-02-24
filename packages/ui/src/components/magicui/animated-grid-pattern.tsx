"use client"

import { cn } from "@crikket/ui/lib/utils"
import { motion } from "motion/react"
import {
  type ComponentPropsWithoutRef,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react"

export interface AnimatedGridPatternProps
  extends ComponentPropsWithoutRef<"svg"> {
  width?: number
  height?: number
  x?: number
  y?: number
  strokeDasharray?: number
  numSquares?: number
  maxOpacity?: number
  duration?: number
  repeatDelay?: number
}

type Square = {
  id: number
  pos: [number, number]
  iteration: number
}

export function AnimatedGridPattern({
  width = 40,
  height = 40,
  x = -1,
  y = -1,
  strokeDasharray = 0,
  numSquares = 50,
  className,
  maxOpacity = 0.5,
  duration = 4,
  repeatDelay = 0.5,
  ...props
}: AnimatedGridPatternProps) {
  const id = useId()
  const containerRef = useRef<SVGSVGElement | null>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })
  const [squares, setSquares] = useState<Square[]>([])

  const getPos = useCallback((): [number, number] => {
    return [
      Math.floor((Math.random() * dimensions.width) / width),
      Math.floor((Math.random() * dimensions.height) / height),
    ]
  }, [dimensions.height, dimensions.width, height, width])

  const generateSquares = useCallback(
    (count: number) => {
      return Array.from({ length: count }, (_, i) => ({
        id: i,
        pos: getPos(),
        iteration: 0,
      }))
    },
    [getPos]
  )

  const updateSquarePosition = useCallback(
    (squareId: number) => {
      setSquares((currentSquares) => {
        const current = currentSquares[squareId]
        if (!current || current.id !== squareId) return currentSquares

        const nextSquares = currentSquares.slice()
        nextSquares[squareId] = {
          ...current,
          pos: getPos(),
          iteration: current.iteration + 1,
        }

        return nextSquares
      })
    },
    [getPos]
  )

  useEffect(() => {
    if (dimensions.width && dimensions.height) {
      setSquares(generateSquares(numSquares))
    }
  }, [dimensions.width, dimensions.height, generateSquares, numSquares])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions((currentDimensions) => {
          const nextWidth = entry.contentRect.width
          const nextHeight = entry.contentRect.height
          if (
            currentDimensions.width === nextWidth &&
            currentDimensions.height === nextHeight
          ) {
            return currentDimensions
          }
          return { width: nextWidth, height: nextHeight }
        })
      }
    })

    resizeObserver.observe(element)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  return (
    <svg
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 h-full w-full fill-gray-400/30 stroke-gray-400/30",
        className
      )}
      ref={containerRef}
      {...props}
    >
      <defs>
        <pattern
          height={height}
          id={id}
          patternUnits="userSpaceOnUse"
          width={width}
          x={x}
          y={y}
        >
          <path
            d={`M.5 ${height}V.5H${width}`}
            fill="none"
            strokeDasharray={strokeDasharray}
          />
        </pattern>
      </defs>
      <rect fill={`url(#${id})`} height="100%" width="100%" />
      <svg className="overflow-visible" x={x} y={y}>
        {squares.map(({ pos: [squareX, squareY], id, iteration }, index) => (
          <motion.rect
            animate={{ opacity: maxOpacity }}
            fill="currentColor"
            height={height - 1}
            initial={{ opacity: 0 }}
            key={`${id}-${iteration}`}
            onAnimationComplete={() => updateSquarePosition(id)}
            strokeWidth="0"
            transition={{
              duration,
              repeat: 1,
              delay: index * 0.1,
              repeatType: "reverse",
              repeatDelay,
            }}
            width={width - 1}
            x={squareX * width + 1}
            y={squareY * height + 1}
          />
        ))}
      </svg>
    </svg>
  )
}
