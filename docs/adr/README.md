# Architecture Decision Records

Estado global: `ACCEPTED` en G2. ADR-009 y ADR-010 conservan la elección contractual de proveedor como decisión diferida, sin cambiar sus límites técnicos. Cada migración exige compatibilidad de datos/contratos.

## ADR-001 — Web: Next.js 16 App Router

- **Contexto:** SEO, PWA, páginas públicas históricas y juego interactivo.
- **Opciones:** Next.js, Remix/React Router, SPA Vite, SvelteKit.
- **Decisión/motivo:** Next.js por SSR/ISR, ecosistema React compartido y hosting flexible; el juego sigue client-side.
- **Consecuencias:** convenciones/caching complejos; admin vive en la misma app con límites de ruta.
- **Riesgos:** dependencia de framework/hosting y fuga por caché.
- **Migración:** conservar REST y dominio; exportar frontend a React Router/Svelte sin tocar API.

## ADR-002 — Mobile: Expo SDK 56 + React Native

- **Contexto:** Android MVP, iOS posterior, AdMob/push/secure storage y buen crucigrama.
- **Opciones:** Expo RN, bare RN, Capacitor, Flutter.
- **Decisión/motivo:** Expo RN ofrece integración nativa y operación de builds con equipo TypeScript.
- **Consecuencias:** UI no se comparte 1:1 con web; requiere development builds.
- **Riesgos:** compatibilidad de módulos/tiendas y calendario Expo.
- **Migración:** `prebuild`/bare RN; Capacitor solo si la UX web demuestra equivalencia.

## ADR-003 — Monorepo pnpm

- **Contexto:** cuatro apps y contratos/dominio compartidos por equipo pequeño.
- **Opciones:** monorepo pnpm, Nx/Turborepo, repos separados.
- **Decisión/motivo:** workspaces pnpm con scripts recursivos; Turborepo solo si CI necesita caché.
- **Consecuencias:** cambios atómicos y un lockfile; CI por filtros.
- **Riesgos:** acoplamiento accidental.
- **Migración:** paquetes publicables/versionados permiten separar repos.

## ADR-004 — Backend: Fastify modular monolith

- **Contexto:** API separada, validación estricta, jobs y despliegue independiente.
- **Opciones:** Fastify, NestJS, Next route handlers, serverless functions.
- **Decisión/motivo:** Fastify 5 por superficie pequeña, JSON Schema y rendimiento; módulos por dominio.
- **Consecuencias:** menos estructura impuesta; reglas de dependencia en lint.
- **Riesgos:** disciplina del equipo.
- **Migración:** OpenAPI + puertos permiten extraer servicio o cambiar host.

## ADR-005 — PostgreSQL 18 + Drizzle

- **Contexto:** transacciones, rankings, publicación, auditoría y migraciones.
- **Opciones:** PostgreSQL/Drizzle, Prisma, Supabase directo, document DB.
- **Decisión/motivo:** PostgreSQL como autoridad y Drizzle por SQL visible/tipos; SQL manual crítico.
- **Consecuencias:** operar conexiones/migraciones; gran consistencia.
- **Riesgos:** ORM gaps, upgrades mayores.
- **Migración:** SQL estándar, repositorios y export lógico; proveedor Postgres intercambiable.

## ADR-006 — Cola: pg-boss, sin Redis MVP

- **Contexto:** publicación, IA, retries y outbox con mínima infraestructura.
- **Opciones:** pg-boss, BullMQ/Redis, SQS, Kafka.
- **Decisión/motivo:** pg-boss usa PostgreSQL, singleton/retry/DLQ/cron y transacción existente.
- **Consecuencias:** una dependencia operativa menos; carga de jobs comparte DB.
- **Riesgos:** contención/throughput y conexión worker.
- **Migración:** `JobPort` y outbox; pasar tareas pesadas a SQS/BullMQ al superar SLO/DB budget.

## ADR-007 — Scheduler: cron de pg-boss + reconciliador

- **Contexto:** DST y publicación exacta sin doble efecto.
- **Opciones:** cron cloud, pg_cron, pg-boss schedule, Temporal.
- **Decisión/motivo:** schedule de pg-boss y job reconciliador cada pocos minutos; comandos idempotentes.
- **Consecuencias:** worker siempre activo; catch-up automático.
- **Riesgos:** reloj/configuración y parada prolongada.
- **Migración:** cron cloud puede invocar los mismos comandos; Temporal solo para workflows complejos medidos.

## ADR-008 — IA: puerto multi-proveedor y validación independiente

- **Contexto:** contenido estructurado, coste/calidad variables y continuidad.
- **Opciones:** proveedor único, broker, modelos propios, edición humana.
- **Decisión/motivo:** `ContentGeneratorPort` con proveedor primario configurable y secundario; schemas y evaluador desacoplado.
- **Consecuencias:** prompts/telemetría versionados; reserva obligatoria.
- **Riesgos:** fallos correlacionados, licencias/fuentes y coste.
- **Migración:** cambiar adapter/config; banco curado permite operar sin IA.

## ADR-009 — Autenticación: servicio gestionado europeo detrás de adapter

- **Contexto:** password, magic link, Google/Apple, mobile y RGPD; decisión contractual pendiente.
- **Opciones:** Supabase Auth, Clerk/Auth0, Better Auth propio, Keycloak.
- **Decisión/motivo:** seleccionar en scaffolding por DPA/residencia/precio; baseline Supabase Auth UE, tokens verificados por API.
- **Consecuencias:** menos riesgo criptográfico, dependencia externa; perfil/autorización siguen propios.
- **Riesgos:** lock-in, outage, costes MAU.
- **Migración:** identidad externa se mapea a `UserIdentity`; export/múltiples issuers durante transición.

## ADR-010 — Hosting: gestionado y región UE

- **Contexto:** equipo pequeño, SSR, procesos persistentes y cumplimiento.
- **Opciones:** Vercel+Render/Fly, AWS, GCP, plataforma única.
- **Decisión/motivo:** web CDN gestionada y API/worker/Postgres gestionados en UE; proveedor se adjudica por matriz antes de prod.
- **Consecuencias:** bajo toil, varios contratos potenciales.
- **Riesgos:** egress, residencia real, límites serverless.
- **Migración:** contenedores OCI, IaC y S3/Postgres portables.

## ADR-011 — Almacenamiento: S3-compatible UE

- **Contexto:** previews y recursos, no estado transaccional.
- **Opciones:** S3-compatible, DB bytea, filesystem.
- **Decisión/motivo:** bucket privado + URLs firmadas; recursos públicos versionados separados.
- **Consecuencias:** lifecycle/CORS; backups independientes.
- **Riesgos:** ACL o URL mal configurada.
- **Migración:** copiar objetos y cambiar endpoint mediante `ObjectStoragePort`.

## ADR-012 — Analítica: first-party events + proveedor gestionado UE

- **Contexto:** producto/ads con consentimiento y esquema estable.
- **Opciones:** PostHog EU, Amplitude, GA4/Firebase, warehouse propio.
- **Decisión/motivo:** collector propio ligero y export a PostHog EU baseline; Firebase solo para métricas mobile necesarias.
- **Consecuencias:** control de schema/consentimiento; operar buffer/outbox.
- **Riesgos:** IDs cruzados, coste/retención.
- **Migración:** replay permitido por política desde outbox corto; adapter a otro destino.

## ADR-013 — Notificaciones: FCM/APNs vía Expo Push inicialmente

- **Contexto:** Android MVP, iOS posterior y deep links.
- **Opciones:** Expo Push, FCM/APNs directos, OneSignal.
- **Decisión/motivo:** Expo Push reduce integración; preferencias/frecuencia viven en backend.
- **Consecuencias:** receipts y invalidación de tokens en worker.
- **Riesgos:** dependencia/latencia y límites.
- **Migración:** `NotificationPort` a FCM/APNs directos sin cambiar casos de uso.

## ADR-014 — Pagos: fuera del MVP; RevenueCat Fase 2

- **Contexto:** suscripción cross-store/restauración; web puede requerir PSP.
- **Opciones:** RevenueCat, StoreKit/Play Billing directo, Stripe web.
- **Decisión/motivo:** no implementar aún; evaluar RevenueCat + Stripe cuando premium esté validado.
- **Consecuencias:** `EntitlementPort` solo devuelve free/ad-free preparado, sin tablas especulativas activas.
- **Riesgos:** políticas/comisiones/sincronización.
- **Migración:** ledger de entitlement por transaction id externo permite cambiar agregador.

## ADR-015 — Publicidad: adapters AdSense/AdMob

- **Contexto:** formatos/plataformas y consentimiento distintos.
- **Opciones:** Google directo, mediación, sin ads.
- **Decisión/motivo:** AdSense web y AdMob native detrás de placement/config; test IDs no-prod.
- **Consecuencias:** UI reserva slots y aplica caps; eventos normalizados.
- **Riesgos:** políticas, CLS, ingreso vs retención.
- **Migración:** apagar por flag o añadir mediación sin tocar dominio competitivo.

## ADR-016 — CMS/admin: rutas protegidas en web

- **Contexto:** revisión especializada y pocas personas operadoras.
- **Opciones:** app admin propia, headless CMS, panel dentro de web.
- **Decisión/motivo:** panel en `apps/web/app/admin`; casos/API propios, sin CMS genérico.
- **Consecuencias:** un despliegue UI; fuerte separación auth/cache.
- **Riesgos:** exposición accidental de bundles/rutas.
- **Migración:** mover rutas a `apps/admin` consumiendo la misma API.
