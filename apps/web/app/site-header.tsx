import Link from "next/link";

type Section = "archive" | "today";

export function SiteHeader({ active = "today" }: Readonly<{ active?: Section }>) {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link aria-label="Lúdico, inicio" className="wordmark" href="/">
          Lúdico
        </Link>
        <nav aria-label="Navegación principal" className="site-nav">
          <Link aria-current={active === "today" ? "page" : undefined} href="/">
            Hoy
          </Link>
          <Link aria-current={active === "archive" ? "page" : undefined} href="/archivo">
            Archivo
          </Link>
        </nav>
        <span aria-label="Retos diarios" className="header-note">
          Retos diarios
        </span>
      </div>
    </header>
  );
}
