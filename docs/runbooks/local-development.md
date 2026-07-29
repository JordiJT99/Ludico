# Desarrollo y recuperación local

Estado: `APPROVED`

## Arranque

1. Instalar Node 24 y pnpm 11.9.
2. Copiar `.env.example` a `.env`; los adaptadores de IA y anuncios permanecen deshabilitados.
3. Ejecutar `docker compose up -d postgres` cuando Docker esté disponible. Alternativamente, usar PostgreSQL 18 local con una base `ludico` que coincida con `DATABASE_URL`.
4. Ejecutar `pnpm --filter @ludico/database db:migrate` y `pnpm --filter @ludico/database db:seed`.

La conversión de invitado a cuenta se habilita al definir `SUPABASE_URL` y `SUPABASE_PUBLISHABLE_KEY` en API y web. La API valida el access token contra `/auth/v1/user`; la web intercambia y renueva la sesión desde su BFF en cookies `HttpOnly`. Mobile necesita además `EXPO_PUBLIC_SUPABASE_URL` y `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; el SDK persiste la sesión en `SecureStore`. Sin configuración, el juego invitado sigue operativo y la cuenta responde `503` o no se muestra.
5. Ejecutar `pnpm dev` y, en otra terminal, `pnpm --filter @ludico/mobile dev`.

Sin Docker, `pnpm test` ejecuta migraciones, repositorios y pg-boss contra PGlite/PostgreSQL embebido. La suite de base se ejecuta deliberadamente en serie para no agotar memoria al crear varios runtimes PGlite; esto valida SQL y comportamiento, pero no sustituye la prueba de PostgreSQL 18 gestionado de staging. La migración y el seed también se verificaron contra PostgreSQL 18 local en Windows.

### Privacidad, analítica y publicidad local

El consentimiento opcional arranca desactivado, se guarda como historial append-only y acompaña al sujeto al migrar de invitado a cuenta. Web lo opera mediante el BFF sin exponer credenciales; Expo llama a la misma API con el token de `SecureStore`. La retirada debe hacer que el collector responda `{"accepted":0}` de inmediato.

`ADS_MODE=disabled` y `EXPO_PUBLIC_ADS_MODE=disabled` dejan el slot reservado pero vacío. Para comprobar exclusivamente el placeholder inerte puede usarse `test`; el texto debe ser “Anuncio de prueba”. No hay SDK, placement ni ID de proveedor en esta fase y nunca se deben introducir IDs reales en desarrollo, CI o E2E.

El build Next usa `cleanDistDir: false` porque las carpetas generadas dentro de OneDrive heredan un ACL que impide borrarlas en builds sucesivos. Los manifiestos del build vigente siguen siendo la fuente de rutas; si se necesita una limpieza total, debe hacerse fuera del flujo automatizado y sin alterar permisos del workspace.

El seed es repetible y publica un quiz y un crucigrama sintéticos para el día actual en `Europe/Madrid`. Para fijar otra edición, definir `SEED_DATE=AAAA-MM-DD` antes de ejecutarlo.

### Pipeline de contenido y backoffice

`AI_PROVIDER=disabled` es el valor seguro: el planner no crea ni envía trabajo y la API de planificación humana responde no disponible. `AI_PROVIDER=fake` habilita únicamente fixtures sintéticos de desarrollo, con coste cero y verificadores fake explícitos; nunca debe usarse como contenido real. `AI_JOB_BUDGET_MICROS` limita cada job y un exceso lo marca fallido. Cualquier proveedor distinto de `disabled|fake` impide arrancar hasta que exista un adapter revisado.

Cada adapter se ejecuta tras un circuit breaker separado por proveedor y tipo de juego: tres fallos consecutivos abren el circuito durante un minuto y después solo pasa una sonda. Los logs de generación incluyen el snapshot de contadores y estado, no el prompt ni el contenido. La similitud semántica se aplica a proveedores reales contra un máximo de 200 candidatos previos; los fixtures `fake` se exceptúan de esa comparación, pero no del hash exacto ni del resto de validaciones.

El worker planifica hasta 21 días, genera por cola con retry/DLQ y ensambla la edición siguiente con un quiz y un crucigrama aprobados. Sin ambos, la transacción no crea una edición parcial. El pipeline separa payload público/solución, conserva lineage, fuentes, hash, findings, coste, auditoría y outbox. Una fuente sintácticamente HTTPS no basta para autoaprobar: los puertos de verificación y evaluación deben devolver éxito; en otro caso el candidato queda `pending_review`.

El crucigrama `fake` usa un banco sintético embebido solo para desarrollo. El flujo real debe cargar desde `/admin` entradas españolas con fuente HTTPS comprobada; el constructor recibe únicamente las activas, aprobadas, con calidad mínima 70 y vigencia de un año. Cambiar una entrada o desactivarla requiere motivo y reautenticación, conserva historial y emite auditoría/outbox. La preview `/admin/content/{id}/preview.svg` se construye en servidor desde el payload público y nunca debe incluir la solución privada.

`/admin` requiere una cuenta Supabase cuyo `app_metadata.admin_role` esté provisionado por un proceso servidor. Para mutar, `admin_reauthenticated_at` debe haberse renovado de forma confiable en los 15 minutos anteriores. El flujo local fake prueba la UI, pero staging debe validar el hook/provisioning MFA real antes de habilitar operadores. No usar la llave `ADMIN_API_KEY` como cuenta humana.

El calendario marca reserva baja cuando quiz o crucigrama tienen menos de 10 días aprobados. Programar una edición completa exige un motivo y deja `actor_type=admin` con el ID verificado; la misma ruta conserva la alternativa `emergency_admin` para recuperación. Antes de usarla, confirmar fecha Madrid, ventana, dos juegos activos y soluciones presentes.

El feed de auditoría pide como máximo 200 registros recientes, no devuelve `metadata` y solo responde a `superadmin`; para otros roles `/admin` ignora el 403 del feed y conserva las herramientas autorizadas. La respuesta es siempre `private,no-store`. Los datos completos se conservan en PostgreSQL conforme a la política de auditoría, no en el navegador.

### Notificaciones push

El valor seguro es `PUSH_PROVIDER=disabled`: no se registra ningún token ni se programan jobs. Para una prueba local determinista puede usarse `fake` fuera de producción. Tanto `fake` como `expo` requieren `NOTIFICATION_TOKEN_KEY_BASE64`, una clave aleatoria de 32 bytes codificada en base64; rotarla exige un procedimiento de recifrado, no sustituirla en caliente. `expo` admite `EXPO_ACCESS_TOKEN` como credencial opcional del servicio.

La app nativa sólo muestra el diálogo del sistema tras activar expresamente los avisos. Requiere `EXPO_PUBLIC_PUSH_ENABLED=true`, `EXPO_PUBLIC_EAS_PROJECT_ID`, un development/release build y dispositivo físico. En Android 13 crea primero el canal `daily`. La configuración sigue la [guía oficial de Expo Push](https://docs.expo.dev/push-notifications/push-notifications-setup/) y la referencia de [`expo-notifications` para SDK 56](https://docs.expo.dev/versions/v56.0.0/sdk/notifications/).

El worker evalúa elegibilidad cada 15 minutos y entrega cada minuto. Combina edición nueva y solución anterior en un solo digest, respeta quiet hours en la zona IANA y limita a una entrega diaria y tres semanales. Un opt-out cancela la cola inmediatamente; `DeviceNotRegistered` desactiva el endpoint y los errores transitorios se reintentan hasta cinco intentos. Los logs contienen sólo contadores/job IDs, nunca tokens.

Prueba manual de staging: instalar el build en un dispositivo físico, iniciar cuenta, activar avisos, aceptar permiso y confirmar que la tabla almacena ciphertext sin token legible. Forzar una edición elegible, ejecutar scheduler/delivery y validar una sola notificación, el deep link permitido y el cap. Desactivar avisos, repetir y confirmar que no se entrega. Esta evidencia es obligatoria antes de cerrar US-031.

## Verificación

`pnpm check` valida documentación, formato, lint, tipos, pruebas, migración embebida, cola, builds web/mobile/API/worker y los E2E Chromium de consentimiento, quiz, crucigrama, PWA, seguridad web, SEO, baseline a11y y cuenta multidispositivo con proveedores fake explícitos. `pnpm security:check` debe informar cero vulnerabilidades altas/críticas. Instalar Chromium una vez con `pnpm exec playwright install chromium`; CI usa además `--with-deps`. `pnpm peers check` debe informar cero problemas. La API pública es `/v1/editions/today`; `/v1/games/{id}/solution` debe devolver 423 hasta el cierre.

`PUBLIC_WEB_URL` fija el origen confiable para CSRF y CORS. Los orígenes directos adicionales, separados por coma, van en `CORS_ALLOWED_ORIGINS`; no usar `*`. En producción, comprobar desde el dominio final CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` y `Permissions-Policy`. `/health` no toca DB; `/ready` debe devolver 200 sólo con PostgreSQL disponible. Configurar un `METRICS_TOKEN` privado de al menos 32 caracteres permite al scraper interno leer `/metrics`; no exponerlo en el navegador ni usar la llave administrativa. El rate limit local no sustituye WAF/edge cuando haya más de una réplica.

## Artefactos OCI para staging

El `Dockerfile` raíz produce tres objetivos sin secretos ni base de datos embebida: `api` (puerto 4000), `worker` y `web` (puerto 3000). Construyen los paquetes compartidos antes de arrancar y los procesos de producción resuelven sólo sus artefactos `dist`; desarrollo, migraciones y pruebas conservan la condición `development` para usar TypeScript fuente.

```powershell
docker build --target api --tag ludico-api:local .
docker build --target worker --tag ludico-worker:local .
docker build --target web --tag ludico-web:local .
```

CI construye los tres objetivos después de `check`. Staging debe inyectar `DATABASE_URL`, `ADMIN_API_KEY`, `PUBLIC_WEB_URL`, `PUBLIC_API_URL`, `CORS_ALLOWED_ORIGINS` y los demás secretos desde el gestor elegido; nunca usar `compose.yaml` ni una imagen local para sustituir PostgreSQL gestionado, TLS, backups o control de acceso. La elección de proveedor UE sigue pendiente y no se codifica en estas imágenes.

## PWA y progreso offline

La web registra `/sw.js` en producción. El service worker conserva el shell, los assets versionados, las navegaciones ya visitadas y las lecturas públicas de juegos. Nunca intercepta sesiones invitadas, intentos, soluciones, administración ni autenticación. El quiz guarda únicamente contenido público, las respuestas del jugador y eventos pendientes; el token de invitado permanece en cookie HttpOnly o SecureStore.

Para una comprobación manual reproducible, arrancar la API y `next start`, abrir un quiz y responder al menos una pregunta. Detener primero la API permite comprobar el indicador `pendiente de sincronizar`; al recuperarla, `Sincronizar` debe vaciar la cola incluso tras un conflicto de versión. Después de una carga completa, detener también la web y recargar la ruta: el quiz descargado debe reaparecer, aceptar respuestas y conservarlas localmente. Volver a arrancar ambos servicios y sincronizar antes del cierre.

## Backup local

Crear un directorio fuera del repositorio y ejecutar:

```powershell
docker compose exec -T postgres pg_dump -Fc -U ludico -d ludico > C:\backups\ludico-local.dump
```

No guardar dumps en Git. Comprobar que el archivo no está vacío y registrar versión de PostgreSQL y fecha.

Con PostgreSQL 18 nativo en Windows, la alternativa equivalente es:

```powershell
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$env:PGPASSWORD = '<contraseña-local>'
& "$pgBin\pg_dump.exe" -Fc -h localhost -p 5432 -U postgres -d ludico -f C:\backups\ludico-local.dump
```

## Restauración ensayada

Restaurar siempre en una base aislada:

```powershell
docker compose exec -T postgres createdb -U ludico ludico_restore
Get-Content -Raw C:\backups\ludico-local.dump | docker compose exec -T postgres pg_restore -U ludico -d ludico_restore --clean --if-exists
docker compose exec -T postgres psql -U ludico -d ludico_restore -c "select count(*) from daily_editions"
```

La prueba formal de RPO/RTO se ejecutará en staging con PITR antes de lanzamiento. Nunca restaurar sobre producción para probar.

Con PostgreSQL nativo, crear una base temporal distinta y restaurar mediante:

```powershell
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$env:PGPASSWORD = '<contraseña-local>'
& "$pgBin\createdb.exe" -h localhost -p 5432 -U postgres ludico_restore_check
& "$pgBin\pg_restore.exe" --clean --if-exists -h localhost -p 5432 -U postgres -d ludico_restore_check C:\backups\ludico-local.dump
& "$pgBin\psql.exe" -h localhost -p 5432 -U postgres -d ludico_restore_check -c "select count(*) from daily_editions"
& "$pgBin\dropdb.exe" -h localhost -p 5432 -U postgres --if-exists ludico_restore_check
```

## Publicación

El worker configura una reconciliación cada minuto. Una edición `scheduled` pasa a `published` solo dentro de su ventana; una `published` pasa a `closed` al alcanzar el límite exclusivo. El cierre copia la solución privada a la proyección pública en la misma transacción y emite outbox/auditoría. Repetir el job no crea transiciones ni eventos nuevos.

## Fallos

- Reserva por debajo de 10 días: el job nocturno cuenta solo candidatos aprobados, no seleccionados y con fecha de hoy o posterior en Madrid; emite `CONTENT_RESERVE_LOW` con ambas cantidades. Revisar candidatos pendientes, aprobar una reserva completa o programarla manualmente antes de las 00:00 Europe/Madrid.
- Sin edición pública: la API devuelve 404 y los clientes muestran estado de preparación.
- Sin base de datos: API y worker no arrancan; no se simula contenido de producción.
- Worker detenido: reiniciar; la reconciliación recupera publicación/cierre pendiente.
- Edición programada ya vencida sin publicar: no se publica automáticamente; seleccionar una reserva `approved` completa mediante el comando administrativo de programación.

## Acciones de emergencia

La API requiere `ADMIN_API_KEY` de al menos 32 caracteres, almacenada como secreto y enviada como Bearer, además de `Idempotency-Key` y un motivo de 10–500 caracteres. Los comandos disponibles son `POST /v1/admin/editions/{id}/schedule` y `POST /v1/admin/games/{id}/disable`. Ambos son idempotentes y escriben auditoría/outbox. Esta credencial de servicio no sustituye el RBAC/MFA del backoffice de US-022.
