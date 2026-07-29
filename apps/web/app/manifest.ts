import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Lúdico · Retos diarios",
    short_name: "Lúdico",
    description: "Quiz y pasatiempos diarios en español.",
    start_url: "/",
    display: "standalone",
    background_color: "#fff9ef",
    theme_color: "#17233c",
    lang: "es-ES",
    orientation: "portrait-primary",
    shortcuts: [
      {
        name: "Quiz diario",
        short_name: "Quiz",
        url: "/juegos/quiz",
        icons: [{ src: "/icons/ludico-192.png", sizes: "192x192", type: "image/png" }],
      },
      {
        name: "Crucigrama diario",
        short_name: "Crucigrama",
        url: "/juegos/crucigrama",
        icons: [{ src: "/icons/ludico-192.png", sizes: "192x192", type: "image/png" }],
      },
    ],
    icons: [
      { src: "/icons/ludico-192.png", sizes: "192x192", type: "image/png" },
      {
        src: "/icons/ludico-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
