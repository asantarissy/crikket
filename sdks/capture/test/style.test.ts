import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const launcherCssPath = fileURLToPath(
  new URL("../src/ui/launcher.css", import.meta.url)
)
const widgetCssPath = fileURLToPath(
  new URL("../src/ui/widget.css", import.meta.url)
)

const sharedLauncherRules = [
  "gap: 6px;",
  "padding: 0 14px;",
  "border: 1px solid transparent;",
  "border-radius: 8px;",
  "font-size: 14px;",
  "font-weight: 500;",
  "white-space: nowrap;",
  "box-shadow: 0 1px 2px rgb(0 0 0 / 0.08);",
  "transform: translateY(-1px);",
  "outline: 2px solid var(--ring);",
  "opacity: 0.5;",
] as const

const readCss = (path: string): string => readFileSync(path, "utf8")

describe("capture SDK styles", () => {
  it("defines shared widget theme tokens only inside the widget root", () => {
    const widgetCss = readCss(widgetCssPath)

    expect(widgetCss).toContain(":host {")
    expect(widgetCss).toContain("color-scheme: light dark;")
    expect(widgetCss).toContain("@media (prefers-color-scheme: dark)")
    expect(widgetCss).toContain(".crikket-capture-root {")
    expect(widgetCss).toContain("--foreground:")
    expect(widgetCss).toContain('--font-sans: "Inter Variable", sans-serif;')
    expect(widgetCss).not.toContain(":root {")
    expect(widgetCss).not.toContain("--crikket-capture-")
  })

  it("ships app-style launcher theme tokens inside the launcher shadow root", () => {
    const launcherCss = readCss(launcherCssPath)

    expect(launcherCss).toContain(":host {")
    expect(launcherCss).toContain("color-scheme: light dark;")
    expect(launcherCss).toContain("@media (prefers-color-scheme: dark)")
    expect(launcherCss).toContain("--primary:")
    expect(launcherCss).toContain('--font-sans: "Inter Variable", sans-serif;')
    expect(launcherCss).toContain("background: var(--primary);")
    expect(launcherCss).not.toContain(":root {")
  })

  it("keeps the lazy launcher and widget launcher visually aligned", () => {
    const launcherCss = readCss(launcherCssPath)
    const widgetCss = readCss(widgetCssPath)

    for (const rule of sharedLauncherRules) {
      expect(launcherCss).toContain(rule)
      expect(widgetCss).toContain(rule)
    }
  })
})
