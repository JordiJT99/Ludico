# Estrategia de pruebas

Estado: `APPROVED`

## Pirámide y puertas

Dominio usa unitarias rápidas y property-based donde los invariantes lo justifican; repositorios/jobs con PostgreSQL real efímero; contratos contra OpenAPI; pocos E2E críticos. No snapshots como oráculo principal. Toda regresión deja el test mínimo en la capa de causa.

PR obligatorio: formato/lint, TypeScript, unitarias, integración afectada, contrato y build. Main: E2E web y migración desde última release. Nightly: mobile, accesibilidad ampliada, resiliencia y carga pequeña. Release: seguridad, compatibilidad, rendimiento, restore y smoke producción con datos sintéticos.

El workflow CI está configurado para aplicar las migraciones sobre un PostgreSQL 18 efímero antes de la suite, ejecutar `pnpm security:check` —que falla ante vulnerabilidades altas/críticas de dependencias de producción— y Gitleaks sobre todo el historial. La migración y el seed ya se comprobaron además contra PostgreSQL 18 local; la primera ejecución remota requiere el primer commit y push del repositorio. La suite PGlite de base limita a un worker para evitar agotamiento de memoria por runtimes embebidos concurrentes, y los E2E reservan el fake API en `:4100` para no reutilizar la API de desarrollo en `:4000`. En organizaciones, configurar el secreto `GITLEAKS_LICENSE` exigido por la acción oficial. Los overrides de `sharp` y `postcss` mantienen corregida la cadena transitiva de Next; el riesgo moderado de `uuid` dentro del tooling de build Expo se registra hasta que Expo/xcode adopten una versión compatible. Dependabot revisa el workspace semanalmente.

## Catálogo

| ID/rango | Cobertura |
|---|---|
| T-UNIT-001 | puntuación por versión, límites, ayudas, elegibilidad |
| T-UNIT-002 | rachas, fechas Europe/Madrid, año nuevo y DST marzo/octubre |
| T-UNIT-003 | máquinas de edición/intento, publicación/cierre idempotentes |
| T-UNIT-004 | normalización NFC, tildes, Ñ, variantes y términos bloqueados |
| T-UNIT-005 | crucigrama: conectividad, letras, numeración, densidad, tamaño, unicidad, semilla y roundtrip |
| T-UNIT-006 | validación de quiz: schema, ambigüedad señalada, fuente, longitud, duplicidad exacta/semántica y sensible |
| T-UNIT-007 | RBAC, consentimiento, experimentos, idempotencia/hash |
| T-UNIT-008 | XP `xp-v1`, umbrales de nivel y reglas cosméticas derivadas |
| T-INT-001 | repositorios/constraints/migraciones y concurrencia de submit |
| T-INT-002 | pg-boss: schedule, retry/backoff, DLQ, singleton y reanudación |
| T-INT-003 | adapters IA/push/auth/ads/analytics con sandbox/fake contractual y circuit breaker por proveedor/tipo |
| T-INT-005 | preferencias push, cifrado, scheduler/dedupe/cap, retry y endpoint stale |
| T-INT-006 | exportación completa, borrado transaccional, pseudonimización y evento downstream |
| T-INT-007 | términos bloqueados: normalización, RBAC, activación/desactivación, auditoría y consumo por validador |
| T-INT-008 | retención: TTL de analítica/idempotencia/push/outbox sin borrar auditoría ni pendientes |
| T-INT-009 | banco léxico: procedencia/vigencia, metadatos, umbral, alta/baja lógica, auditoría y alimentación del constructor |
| T-INT-010 | dashboard analítico: días Madrid, ventana acotada, dedupe de intento, tasa vacía, freshness y ausencia de IDs |
| T-INT-011 | auditoría administrativa: orden reciente, límite, proyección sin metadata y acceso exclusivo superadmin |
| T-INT-012 | cuarentena analítica: rollback atómico, metadatos sin valores/sujeto, conteo agregado y TTL 30 días |
| T-INT-013 | ledger XP: finalización idempotente, bonus de dos tipos, migración invitado→cuenta y consulta privada |
| T-INT-004 | caché/ETag y garantía de no cachear solución/PII |
| T-E2E-001 | invitado completa quiz y resultado no filtra respuestas |
| T-E2E-002 | registro migra progreso sin duplicarlo |
| T-E2E-003 | crucigrama teclado/táctil, cola sin pérdida bajo red lenta y finalización |
| T-E2E-004 | cierre, solución siguiente y ranking final |
| T-E2E-005 | IA falla y se publica reserva |
| T-E2E-006 | retirar consentimiento detiene destinos no esenciales |
| T-E2E-007 | premium futuro sin ads (se habilita Fase 2) |
| T-E2E-008 | offline, cola, reconexión y conflicto |
| T-E2E-009 | cuenta descarga sus datos, reautentica y confirma el borrado irreversible |
| T-E2E-010 | backoffice alerta por reserva baja, programa, edita JSON, revalida, conserva versión y audita antes de aprobar |
| T-E2E-011 | consentimiento gobierna el catálogo analítico y ningún evento contiene respuestas/soluciones |
| T-SEC-001 | inspección de JS/API/cache no descubre solución |
| T-A11Y-001 | axe + teclado + lector manual web/mobile |
| T-PERF-001 | CWV y API p95 bajo perfil objetivo |
| T-DR-001 | restauración y RPO/RTO medidos |

## Oráculos del crucigrama

Las pruebas recorren semillas deterministas y verifican: cada entrada tiene ≥2 letras, toda letra pertenece a entrada, grafo conectado, cruce coincide, numeración fila/columna estable, serializar/deserializar conserva estructura, solución satisface pistas vinculadas, sin bloqueados y búsqueda por backtracking de alternativas produce exactamente una bajo el vocabulario permitido. Los límites de nodos y tiempo devuelven un fallo tipado, nunca una cuadrícula parcial. La preview se prueba contra respuestas y nombres de campos privados para impedir filtraciones.

## Datos y entornos

Factories deterministas, sin PII real. Reloj y RNG inyectables en dominio. Integración usa PostgreSQL de la versión objetivo; no SQLite como sustituto. Proveedores: fake local, sandbox en integración programada y contrato grabado sin secretos/PII. Seeds incluyen edición antes/durante/después de cierre y cuadrículas accesibles.

## Calidad no funcional

- Accesibilidad: automatización + teclado, TalkBack, VoiceOver antes de iOS y NVDA/VoiceOver web; zoom/reflow/reduced motion.
- Rendimiento: dispositivos/red móviles de referencia, bundle budgets, LCP/INP/CLS y cuadrícula grande.
- Carga: home, progress y submit; carrera a cierre; worker backlog.
- Seguridad: SAST, SCA, secrets, DAST, authz matrix, replay, payload/fuzz y pentest.
- Resiliencia: cortar IA/push/storage/DB brevemente, kill worker, duplicar jobs y verificar recuperación.
- Compatibilidad: matriz NFR-007 y Android low/mid tier.

## Definition of Done por historia

Criterios aceptados; código/revisión; migración y rollback/forward plan; unit/integration/E2E proporcionales; analítica validada; accesibilidad/errores/offline aplicables; docs/OpenAPI/changelog actualizados; lint/types/tests/build verdes; seguridad/observabilidad; feature flag seguro; demo en staging y sin deuda crítica no registrada.
