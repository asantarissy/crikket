import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const widgetCssPath = fileURLToPath(
  new URL("../src/ui/widget.css", import.meta.url)
)

describe("capture widget CSS isolation", () => {
  it("defines shared theme tokens only inside the widget root", () => {
    const widgetCss = readFileSync(widgetCssPath, "utf8")

    expect(widgetCss).toContain(":host {")
    expect(widgetCss).toContain("color-scheme: light dark;")
    expect(widgetCss).toContain("@media (prefers-color-scheme: dark)")
    expect(widgetCss).toContain(".crikket-capture-root {")
    expect(widgetCss).toContain("--foreground:")
    expect(widgetCss).toContain('--font-sans: "Inter Variable", sans-serif;')
    expect(widgetCss).not.toContain(":root {")
    expect(widgetCss).not.toContain("--crikket-capture-")
  })
})
