"use client"

import { siteConfig } from "@crikket/shared/config/site"
import { ModeToggle } from "@crikket/ui/components/mode-toggle"
import { cn } from "@crikket/ui/lib/utils"
import { Github } from "lucide-react"
import Link from "next/link"
import { useEffect, useState } from "react"

const navLinks = [
  {
    title: "Documentation",
    href: "/docs",
  },
]

export function SiteHeader() {
  const [isScrolled, setIsScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 20)
    }
    window.addEventListener("scroll", handleScroll)
    return () => window.removeEventListener("scroll", handleScroll)
  }, [])

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 flex w-full justify-center transition-all duration-300 ease-in-out",
        isScrolled ? "py-4" : "py-4"
      )}
    >
      <div
        className={cn(
          "flex h-14 items-center justify-between transition-all duration-300 ease-in-out",
          isScrolled
            ? "w-[95%] max-w-5xl rounded-2xl border border-border/40 bg-background/95 px-6 shadow-sm backdrop-blur supports-backdrop-filter:bg-background/60"
            : "w-full max-w-6xl bg-transparent px-4"
        )}
      >
        <div className="flex items-center gap-6">
          <Link className="flex items-center space-x-2" href="/">
            <span className="font-bold tracking-tight">{siteConfig.name}</span>
          </Link>
          <nav className="hidden items-center gap-6 font-medium text-sm md:flex">
            {navLinks.map((item) => (
              <Link
                className="text-foreground/60 transition-colors hover:text-foreground/80"
                href={item.href}
                key={item.href}
              >
                {item.title}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <nav className="flex items-center gap-2">
            {navLinks.map((item) => (
              <Link
                className="mr-2 font-medium text-foreground/60 text-sm transition-colors hover:text-foreground/80 md:hidden"
                href={item.href}
                key={item.href}
              >
                {item.title === "Documentation" ? "Docs" : item.title}
              </Link>
            ))}
            <Link
              href={siteConfig.links.github}
              rel="noreferrer"
              target="_blank"
            >
              <div className="inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                <Github className="h-4 w-4" />
                <span className="sr-only">GitHub</span>
              </div>
            </Link>
            <ModeToggle />
          </nav>
        </div>
      </div>
    </header>
  )
}
