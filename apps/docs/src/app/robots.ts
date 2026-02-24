import { siteConfig } from "@crikket/shared/config/site"
import type { MetadataRoute } from "next"

const isProduction = process.env.NODE_ENV === "production"

export default function robots(): MetadataRoute.Robots {
  const host = new URL(siteConfig.url.public).origin

  return {
    rules: isProduction
      ? [
          {
            userAgent: "*",
            allow: "/",
          },
        ]
      : [
          {
            userAgent: "*",
            disallow: "/",
          },
        ],
    sitemap: `${host}/sitemap.xml`,
    host,
  }
}
