import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AccountPanel } from "./account-panel";
import { ConsentPanel } from "./consent-panel";
import { ServiceWorkerRegister } from "./service-worker-register";
import "./editorial.css";

export const metadata: Metadata = {
  applicationName: "Lúdico",
  metadataBase: publicWebUrl(),
  description: "Un rato para pensar, cada día.",
  icons: {
    apple: "/icons/ludico-192.png",
    icon: "/icons/ludico-192.png",
  },
  manifest: "/manifest.webmanifest",
  openGraph: {
    description: "Quiz y crucigrama diarios en español.",
    locale: "es_ES",
    siteName: "Lúdico",
    title: "Lúdico",
    type: "website",
  },
  title: { default: "Lúdico", template: "%s · Lúdico" },
};

export const viewport: Viewport = { themeColor: "#17233c" };

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="es">
      <body>
        {children}
        <ConsentPanel adsMode={process.env.ADS_MODE === "test" ? "test" : "disabled"} />
        <AccountPanel />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}

function publicWebUrl(): URL {
  try {
    return new URL(process.env.PUBLIC_WEB_URL ?? "http://localhost:3000");
  } catch {
    return new URL("http://localhost:3000");
  }
}
