# Threat model y privacidad

Estado: `APPROVED` · Método: STRIDE + abuso de producto

## Activos, actores y fronteras

Activos críticos: soluciones no publicadas, credenciales/sesiones, PII/consentimiento, integridad de intentos/scores/rankings, contenido/fuentes, llaves de firma, publicación y auditoría. Actores: jugador legítimo, tramposo, bot/farm, atacante externo, admin comprometido, proveedor fallido/malicioso y operador accidental.

Fronteras: cliente↔CDN/API; público↔admin; API/worker↔DB; plataforma↔IA/auth/push/ads/analytics; CI↔producción. Cliente, IA, webhooks y archivos son no confiables.

## Amenazas y controles

| ID | Amenaza | Riesgo | Controles / prueba |
|---|---|---:|---|
| SEC-001 | extraer solución antes del cierre | Crítico | DTO allowlist, esquema/rol privado, gate servidor, cache-control, test estático/dinámico |
| SEC-002 | alterar respuesta/tiempo/score | Alto | score servidor, receivedAt, nonce/intento, heurística, test replay/tamper |
| SEC-003 | doble envío/replay | Alto | idempotencia+hash, unique constraints, máquina de estados, concurrencia |
| SEC-004 | robo/fijación de sesión | Alto | TLS, cookies seguras, PKCE, rotación/reuse detection, revocación, CSRF |
| SEC-005 | enumeración/credential stuffing | Alto | mensajes uniformes, rate/risk limits, breached-password check, MFA admin |
| SEC-006 | abuso admin/privilegios | Crítico | RBAC mínimo, MFA/reauth, separación prod, auditoría/alerta, revisión trimestral |
| SEC-007 | prompt injection/contenido dañino | Alto | salida schema, fuentes allowlist, sanitización, evaluador, sin herramientas privilegiadas |
| SEC-008 | XSS/SQLi/CSRF/CORS | Alto | escape, CSP, parametrización, schema, token CSRF, allowlist y tests DAST |
| SEC-009 | fuga por logs/analítica/backups | Alto | clasificación, scrub, cifrado, acceso/retención, canary scan y restore aislado |
| SEC-010 | bot/farming/ranking spam | Medio | cuotas escalonadas, reputación, challenge por riesgo, alias moderado, cuarentena |
| SEC-011 | supply chain/CI | Alto | lockfile, provenance, scanners, permisos mínimos, secretos OIDC, revisión dependencias |
| SEC-012 | DoS/coste IA | Alto | WAF/limits, payload cap, budgets, queue backpressure, circuit breaker |
| SEC-013 | publicación errónea/DST | Alto | idempotencia, lock, UTC+IANA, aprobación, reserva, tests DST |
| SEC-014 | webhook falso (auth/pagos futuro) | Alto | firma, timestamp, replay store, secreto rotado |
| SEC-015 | borrado incompleto | Medio | workflow/tombstone, inventario de procesadores, prueba periódica |

## Privacidad/RGPD

Minimización por defecto; perfiles privados; no contactos, fecha de nacimiento ni ubicación precisa en MVP. Registro de finalidad, base jurídica, versión, UI y prueba. Retirar es tan fácil como aceptar y actualiza SDKs. CMP/Consent Mode/ATT se validan contra jurisdicción y políticas vigentes antes de producción; este documento no sustituye asesoría legal.

Derechos: acceso, rectificación, portabilidad y borrado mediante flujo verificable; SLA y autenticación proporcional. DPIA antes de personalización/profiling o tratamiento de menores. DPA, subprocesadores, residencia/transferencias y SCC se inventarían antes de contratar. Incidentes: detectar, contener, preservar evidencia, evaluar notificación legal y comunicar sin ocultar.

El baseline ejecutable permite exportar los datos propios sin caché y obliga a reautenticar más una confirmación literal para borrar. La transacción elimina consentimientos, analítica first-party y push, pseudonimiza email/identidad/alias, conserva únicamente estadísticas sin identidad directa y publica una orden de borrado downstream. Antes de producción se verifican la eliminación del sujeto en Supabase y cada procesador, TTL/backups, SLA y una prueba periódica extremo a extremo; el outbox por sí solo no demuestra ese borrado externo.

## Secretos y claves

Gestor de secretos por entorno; CI con OIDC y credenciales efímeras; rotación documentada; jamás en bundle cliente salvo claves públicas/test IDs. Claves de cifrado separadas de datos, backup de claves y dual-read durante rotación. `.env.example` solo nombres/placeholders.

## Criterios de salida

Threat model revisado en cada frontera nueva; SAST/dependency/secret scan sin críticos; pentest antes de lanzamiento; autorización por endpoint cubierta; test automatizado SEC-001..008; restore y revocación ensayados; riesgo residual firmado por owner.

Baseline ejecutable de US-034: CORS allowlist en API, CSRF same-origin en BFF, CSP/frame denial/HSTS en producción, payload 256 KiB, validación cerrada, error 5xx sin detalle, correlation ID, rate limit local, métricas internas protegidas, audit de dependencias sin altas/críticas y Gitleaks de historial en CI. Riesgos residuales no aceptados todavía: límite distribuido/WAF, pentest/DAST, restore gestionado y `uuid` moderado presente sólo en tooling nativo Expo; se resuelven o firman en G5.
