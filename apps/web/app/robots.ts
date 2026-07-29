import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      allow: "/",
      disallow: ["/admin", "/api", "/jugar", "/offline"],
      userAgent: "*",
    },
    sitemap: `${publicOrigin()}/sitemap.xml`,
  };
}

function publicOrigin(): string {
  try {
    return new URL(process.env.PUBLIC_WEB_URL ?? "http://localhost:3000").origin;
  } catch {
    return "http://localhost:3000";
  }
}
