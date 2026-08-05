# Contratos API v1

Estado: `APPROVED` · Base: `/v1` · JSON UTF-8

## Convenciones

Auth Bearer mobile o cookie web; `X-Correlation-Id`; `Idempotency-Key` obligatorio en comandos marcados; paginación cursor. Error `application/problem+json`: `{type,title,status,code,detail?,instance,correlationId,errors?}`. Fechas RFC 3339, edición `YYYY-MM-DD`, locale BCP 47. OpenAPI es artefacto generado/verificado desde esquemas compartidos.

La implementación actual devuelve siempre `X-Correlation-Id` (conserva uno cliente válido o genera UUID), limita JSON a 256 KiB y usa códigos seguros sin stack en errores inesperados. `/health` comprueba sólo proceso; `/ready` ejecuta la comprobación de dependencia crítica y devuelve `503` si PostgreSQL no responde. `429` incluye `Retry-After`. `/metrics` queda oculto sin `METRICS_TOKEN` y, con `Bearer`, expone únicamente contadores HTTP agregados por método/ruta/estado para scraping interno. CORS sólo refleja orígenes configurados en `PUBLIC_WEB_URL`/`CORS_ALLOWED_ORIGINS`.

Las rutas privadas de juego aceptan exactamente un propietario: `X-Guest-Token` o `Authorization: Bearer <JWT Supabase>`. La API verifica el JWT, lo resuelve a `user_id` y mantiene el mismo intento competitivo por juego en web, Android e iOS. La web no expone esos tokens a JavaScript: su BFF usa cookies `HttpOnly`; mobile los conserva en `SecureStore`.

## Endpoints públicos/jugador

| Método/ruta | Propósito | Notas |
|---|---|---|
| POST `/guest-sessions` | crear/rotar invitado | `origin`; header opcional `X-Guest-Token`; no-store y secreto una vez |
| DELETE `/guest-sessions/current` | revocar invitado | idempotente; no revela existencia |
| POST `/auth/register|login|magic-link|oauth/exchange|refresh|logout` | identidad | respuestas anti-enumeración; PKCE mobile |
| POST `/auth/migrate-guest` | vincular invitado | JWT Supabase verificado por Auth, token invitado, idempotente y no-store |
| GET/PATCH `/me`, `/me/settings` | perfil/ajustes | ETag/version para PATCH |
| GET `/me/data-export` | acceso/portabilidad | JSON descargable con perfil, intentos, progreso, consentimientos, preferencias y analítica; `private,no-store` |
| DELETE `/me` | borrado de cuenta | sólo tras reautenticación del cliente, confirmación `ELIMINAR` e idempotency key; pseudonimiza y propaga por outbox |
| GET/DELETE `/me/devices/{id}` | sesiones | revocación inmediata |
| GET `/consents/current` | consentimiento efectivo | propietario invitado/cuenta; por defecto todo opcional desactivado; `private,no-store` |
| POST `/consents` | cambiar consentimiento | append-only; `ads` y `analytics` independientes, versión de política e idempotency key |
| GET/PATCH `/me/notification-preferences` | granular | sólo cuenta; casos independientes, quiet hours + zona IANA; PATCH cancela entregas pendientes |
| GET `/editions/today` | home | DTO público + progreso autorizado |
| GET `/editions/{date}` | edición/archivo | ventana MVP de 7 días; 404 si futura, fuera de ventana o no publicada |
| GET `/games/{id}` | payload jugable | jamás solución; ETag |
| POST `/games/{id}/attempts` | iniciar/reanudar | idempotente |
| PUT `/attempts/{id}/progress` | lote de eventos | clientEventId/version; 409 con canónico |
| POST `/attempts/{id}/hints` | revelar una celda de crucigrama | privado/no-store; deduplicado; vuelve el intento no competitivo |
| POST `/attempts/{id}/submit` | sellar | idempotente; servidor puntúa |
| GET `/attempts/{id}` | progreso/resultado | detalle condicionado por cierre |
| GET `/attempts/{id}/review` | score y comparación personal | exige sujeto propietario; `423` antes de cierre; `private,no-store` |
| GET `/games/{id}/solution` | solución/revisión | `423 SOLUTION_LOCKED` antes de cierre; medias y porcentajes por pregunta/palabra sólo con cohorte competitiva ≥20 |
| GET `/leaderboards/{game|daily|weekly}/{id|date}` | ranking | posición/percentil privado; tabla nominal solo con alias + opt-in |
| GET `/me/streaks` | racha | cuenta; fecha local Madrid, un día por edición elegible |
| GET `/me/previous-results` | resumen personal de ayer | sólo cuenta; hasta quiz y crucigrama, puntos y puesto final si fue competitivo; `private,no-store` |
| GET/PATCH `/me/leaderboard-settings` | alias y opt-in | privado/no-store; auditado |
| GET `/me/achievements` | progreso | XP total, nivel `xp-v1` y logros cosméticos derivados; privado/no-store, disponible para invitado o cuenta |
| POST `/share-results` | payload seguro | exige intento propietario; servidor genera solo juego, puntos, modo y URL pública sin `attemptId` |
| POST `/devices/push-token` | registrar token Expo | sólo cuenta; Android/iOS, idempotente por hash; secreto cifrado y respuesta no-store |
| GET `/config/public` | flags/placements seguros | firmado/ETag, sin secretos |
| POST `/analytics/events` | ingestión permitida | batch ≤100, UUID deduplicado, schema/propiedades allowlist y consentimiento actual |

Amigos/ligas/challenges, suscripción y compras quedan reservados a `/v1` de Fase 2 y no se publican como endpoints vacíos.

Contratos previstos al activar Fase 2: `GET/POST/DELETE /friends`, `POST /friend-invitations`, `GET/POST/PATCH /leagues`, `POST/DELETE /leagues/{id}/members`, `GET/POST /challenges`, `POST /challenges/{id}/accept`, `GET /subscriptions/catalog`, `POST /subscriptions/verify`, `POST /subscriptions/restore`, `GET /me/entitlements` y webhooks firmados internos por proveedor. Su schema se versionará y aprobará en su historia; esta reserva solo fija recursos y semántica, no payload especulativo.

## Administración

Prefijo `/v1/admin`, MFA/RBAC/auditoría: `GET /editions/calendar`, `GET/PATCH /editions/{id}`, `POST /editions/{id}/approve|reject|schedule|publish|close`, `GET /reserve`, `POST /content/generation-jobs`, `GET /content/{id}/validations`, `POST /content/{id}/approve|reject|regenerate`, `GET/POST /blocked-terms`, `GET/PATCH /publication-settings`, `GET/PATCH /feature-flags/{key}`, `GET /audit`, `POST /games/{id}/disable`, `POST /emergency/use-reserve`. Publicar/cerrar/desactivar exige `Idempotency-Key`, motivo y reauth reciente.

`disable` acepta una credencial Bearer de servicio de emergencia rotatoria, conservada en el gestor de secretos, más idempotency key y motivo. `schedule` acepta esa misma vía de recuperación o una sesión humana editor/superadmin con reautenticación reciente; la auditoría distingue `emergency_admin` de `admin` y conserva el ID humano. Nunca se mezclan ambas identidades.

El corte ejecutable de US-022 expone `GET /admin/editions/calendar`, `POST /admin/editions/{id}/schedule`, `GET/PATCH /admin/publication-settings`, `GET /admin/content`, `GET /admin/content/health`, `GET /admin/content/{id}/preview.svg`, `POST /admin/content/plan`, `PATCH /admin/content/{id}`, `POST /admin/content/{id}/approve|reject|regenerate`, `GET/POST /admin/blocked-terms`, `POST /admin/blocked-terms/{id}/deactivate`, `GET/POST /admin/word-bank`, `POST /admin/word-bank/{id}/deactivate`, `GET /admin/analytics/dashboard?days=1..30` y `GET /admin/audit?limit=1..200`. La configuración de publicación controla apertura, cierre, hora de planificación y reserva entre 7 y 21 días; solo superadmin reautenticado puede cambiarla y cada cambio deja auditoría/outbox. La salud de contenido resume reserva por tipo, cola, fallos en 24 horas, coste del día y preparación de mañana; nunca devuelve payloads, respuestas ni soluciones. La edición recibe payload público, solución privada, fuentes y motivo; vuelve a validar y crea una versión `pending_review`, conservando la anterior como rechazada y enlazada en auditoría. El SVG se deriva exclusivamente del payload público y no contiene letras. El banco recibe palabra, pista, categoría, dificultad, variantes, calidad, fuente HTTPS, fecha de comprobación, estado y motivo; solo devuelve entradas curadas elegibles. El dashboard devuelve únicamente agregados por día Madrid y totales, con owner, definición y freshness, sin identificadores de sujeto o intento. El feed de auditoría, exclusivo de superadmin, omite `metadata` y limita su salida reciente. Regenerar rechaza la versión anterior y devuelve su job a `queued` de forma repetible para el siguiente despacho del worker. La identidad humana procede de un JWT Supabase ya validado; solo se confía en `app_metadata.admin_role`, nunca en `user_metadata`. Los comandos humanos requieren `app_metadata.admin_reauthenticated_at` con antigüedad máxima de 15 minutos, motivo e idempotency key. Todas las respuestas con preview/solución/métricas/auditoría son `private,no-store`; la llave de emergencia solo autoriza programación y kill switch, no lecturas humanas.

### Matriz de autorización administrativa

| Recurso/acción | Superadmin | Editor | Moderador | Analista | Soporte | Lectura |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| calendario/contenido/validaciones: leer | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| contenido: editar/aprobar/rechazar/regenerar | ✓ | ✓ | — | — | — | — |
| banco léxico: leer / curar-desactivar | ✓ / ✓ | ✓ / ✓ | ✓ / — | ✓ / — | — / — | ✓ / — |
| programar/publicar/cerrar/usar reserva | ✓ | ✓ | — | — | — | — |
| kill switch/publication settings | ✓ | — | — | — | — | — |
| términos bloqueados/moderar alias | ✓ | leer | ✓ | — | — | leer |
| métricas/experimentos: leer | ✓ | ✓ | ✓ | ✓ | resumen | ✓ |
| crear/cambiar experimento o flag no crítico | ✓ | — | — | ✓ | — | — |
| usuarios: lookup mínimo/ayuda/revocar sesión | ✓ | — | — | — | ✓ | — |
| roles, secretos, borrado, export y auditoría completa | ✓ | — | — | — | — | — |

La denegación es el valor por defecto; “lectura” no incluye PII ni solución anterior al cierre salvo que el trabajo editorial la requiera y quede auditado. Editor no puede cambiar su propio rol ni reducir requisitos de aprobación.

## DTO de juego seguro

`QuizPublic`: ids opacos, enunciado, opciones `{id,text}`, categoría, dificultad declarada, reglas y orden; excluye `correctOptionId`, explicación evaluativa y campos internos. `CrosswordPublic`: dimensiones, máscara/bloques, números, pistas, direcciones y reglas; excluye letras de solución, answers y hashes reversibles. Se generan por allowlist y se prueban contra lista de campos prohibidos.

El progreso de crucigrama usa eventos `{clientEventId,cellId,value,elapsedMs,clientOccurredAt?}`; `value` es vacío para borrar o una letra NFC. La ayuda recibe `{clientEventId,cellId}` y devuelve solo esa letra, contador de ayudas, versión canónica y `competitive:false`. Nunca se cachea y no habilita una lectura general de la solución.

`SolutionPublic` se genera en el cierre desde una proyección separada, recibe `publishedAt`, `contentVersion` y URL canónica, y puede cachearse públicamente solo cuando `publishedAt <= now`. La API de intento añade comparación personal bajo `private,no-store`; la página SEO consume únicamente agregados con umbral y la proyección pública. Así, indexación histórica y privacidad no comparten DTO ni caché.

## Ejemplos críticos

```json
POST /v1/consents
Idempotency-Key: 01J...
X-Client-Platform: web
{"ads":false,"analytics":true,"policyVersion":"2026-07-01"}

200
{"ads":false,"analytics":true,"policyVersion":"2026-07-01","recordedAt":"2026-07-29T12:00:00.000Z"}
```

Una versión distinta de la vigente devuelve `409 CONSENT_POLICY_OUTDATED`. Revocar analítica inserta una nueva decisión; desde ese commit, `/analytics/events` acepta cero elementos sin registrar el payload. Un envelope que no cumple el contrato se descarta en el borde. Un evento con ventana temporal o propiedades no permitidas devuelve `422 INVALID_ANALYTICS_EVENT`, revierte el lote completo y conserva únicamente metadatos sanitizados de cuarentena sin payload ni sujeto.

```json
POST /v1/attempts/01.../submit
Idempotency-Key: 01J...
{"attemptVersion":7,"clientSubmittedAt":"2026-07-28T21:03:04.120Z"}

202
{"attemptId":"01...","status":"accepted","competitive":true,"provisional":{"score":780,"completed":true},"solutionAvailableAt":"2026-07-29T22:00:00Z"}
```

```json
GET /v1/games/01.../solution
423
{"type":"https://ludico.example/problems/solution-locked","title":"Solución aún no disponible","status":423,"code":"SOLUTION_LOCKED","correlationId":"..."}
```

Tras el cierre devuelve un snapshot autocontenido `{gameId,game,publishedAt,payload}`. `game` conserva el enunciado público versionado y `payload` contiene solo la proyección publicable: preguntas, opción correcta y explicación para quiz; entradas y respuestas para crucigrama. Metadatos internos de generación y unicidad no se copian.

## Compatibilidad y límites

Cambio aditivo compatible; retirada con deprecation header y al menos dos versiones mobile soportadas. Cambios incompatibles crean `/v2`. Límite inicial: JSON 256 KiB, analítica batch 100 eventos, progreso 200 eventos; valores revisables. Rate limits por sujeto/IP/riesgo sin revelar cuentas; `429` con `Retry-After`. Los clientes no reintentan 4xx salvo 409 resoluble/429; 5xx con backoff y misma clave.
