import { siteConfig } from "@crikket/shared/config/site"
import type { MetadataRoute } from "next"

import { source } from "@/lib/source"

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date()
  const routes = new Set(["/", "/docs"])

  for (const page of source.getPages()) {
    routes.add(page.url)
  }

  return [...routes].map((route) => ({
    url: new URL(route, siteConfig.url.public).toString(),
    lastModified: now,
  }))
}
