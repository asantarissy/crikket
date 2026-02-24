import { env } from "@crikket/env/web"

export function HeroDemo() {
  if (!env.NEXT_PUBLIC_DEMO_URL) {
    return null
  }

  return (
    <div className="rounded-none border-border/50 border-y bg-background/50 shadow-[0_0_40px_-10px_rgba(255,255,255,0.1)] backdrop-blur-xl sm:rounded-xl sm:border-x sm:p-4 dark:shadow-[0_0_40px_-10px_rgba(0,0,0,0.5)]">
      <div className="relative overflow-hidden border-border border-y bg-muted/20 sm:rounded-lg sm:border-x">
        <div className="pointer-events-none absolute inset-0 bg-linear-to-tr from-primary/10 via-transparent to-blue-500/10 opacity-50 mix-blend-overlay" />
        <iframe
          allow="camera; microphone; display-capture; autoplay; clipboard-write; clipboard-read"
          allowFullScreen
          className="aspect-9/16 min-h-[800px] w-full border-0 bg-background sm:aspect-16/10 sm:min-h-0 md:aspect-video"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          src={env.NEXT_PUBLIC_DEMO_URL}
          title="Crikket Live Demo"
        />
      </div>
    </div>
  )
}
