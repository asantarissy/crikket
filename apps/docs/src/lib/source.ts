import { docs } from "fumadocs-mdx:collections/server"
import { siteConfig } from "@crikket/shared/config/site"
import { type InferPageType, loader } from "fumadocs-core/source"
import { lucideIconsPlugin } from "fumadocs-core/source/lucide-icons"

// See https://fumadocs.dev/docs/headless/source-api for more info
export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
  plugins: [lucideIconsPlugin()],
})

export function getPageImage(page: InferPageType<typeof source>) {
  const segments = [...page.slugs, "image.png"]
  const path = `/og/docs/${segments.join("/")}`

  return {
    segments,
    path,
    url: new URL(path, siteConfig.url.public).toString(),
  }
}

export async function getLLMText(page: InferPageType<typeof source>) {
  const processed = await page.data.getText("processed")

  return `# ${page.data.title}

${processed}`
}
