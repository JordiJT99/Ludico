import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = publicOrigin();
  return ["", "/archivo", "/juegos/quiz", "/juegos/crucigrama"].map((path) => ({
    changeFrequency: path ? ("daily" as const) : ("always" as const),
    priority: path ? 0.8 : 1,
    url: `${origin}${path}`,
  }));
}

function publicOrigin(): string {
  try {
    return new URL(process.env.PUBLIC_WEB_URL ?? "http://localhost:3000").origin;
  } catch {
    return "http://localhost:3000";
  }
}
