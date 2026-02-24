import type { ReactNode } from "react"

import { SiteHeader } from "./_components/site-header"

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader />
      <main className="flex-1">{children}</main>
    </div>
  )
}
