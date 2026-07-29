import Link from "next/link";

export default function OfflinePage() {
  return (
    <main>
      <p className="eyebrow">Sin conexión</p>
      <h1>Los retos descargados siguen disponibles.</h1>
      <p>Vuelve al inicio o abre un quiz que ya hayas comenzado en este dispositivo.</p>
      <Link className="button-link" href="/">
        Volver al inicio
      </Link>
    </main>
  );
}
