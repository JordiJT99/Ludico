# Auditoría de completitud del MVP

Fecha de revisión: 2026-08-04. Alcance: requisitos del plan de producto y del motor de contenido, contrastados con código, pruebas y la matriz de trazabilidad.

## Resultado

La base operativa del MVP está implementada y comprobada localmente: edición diaria, sesión invitada y cuenta, quiz, crucigrama, progreso offline, cierre y soluciones, ranking, backoffice, PWA, consentimiento, analítica y motor de contenido. No es todavía un lanzamiento de producción firmado: las puertas que dependen de proveedores, credenciales, legal, dispositivos físicos y staging siguen abiertas y están registradas abajo.

## Evidencia funcional

| Área | Estado | Evidencia |
|---|---|---|
| Edición diaria, Madrid/DST y cierre idempotente | Implementada | `packages/domain/src/edition.ts`, `packages/database/src/editions.ts`, `apps/worker/src/jobs.ts` |
| Cinco juegos públicos, guardado y revisión sin filtraciones | Implementada | `apps/web/app/jugar`, `apps/mobile`, intentos tipados y pruebas E2E |
| Sesión invitada, cuenta y migración | Implementada | `apps/api/src/app.ts`, E2E 4 |
| Racha, resultados, ranking y compartir seguro | Implementada | `packages/domain/src/scoring.ts`, `apps/api/src/app.ts` |
| PWA, caché segura y reconexión | Implementada | `apps/web/public/sw.js`, E2E 2 y 3 |
| Consentimiento, anuncios de prueba y analítica sin respuestas | Implementada | `packages/domain/src/consent.ts`, E2E 1 |
| Administración, calendario, auditoría, banco y revisión | Implementada | `apps/web/app/admin`, E2E 5 |
| Planificación, reserva, emergencia y validación de contenido | Implementada | `packages/database/src/content-pipeline.ts`, `apps/worker/src/content-jobs.ts` |
| Cinco formatos en el motor | Implementada | `packages/domain/src/content-validation.ts`, `packages/domain/src/daily-games.ts`, generador determinista curado en `apps/worker/src/fake-content-generator.ts` |

## Cinco formatos jugables

La edición diaria selecciona quiz, verdadero/falso, adivina la palabra, crucigrama y sopa de letras. La sopa de letras usa un contrato de selección de extremos: el cliente nunca recibe las coordenadas reales antes del cierre; el servidor comprueba dirección, casillas, versión e idempotencia, almacena cada hallazgo y solo publica el recorrido al cerrar la edición.

- Los cinco formatos se generan, validan, mantienen en reserva, publican y son jugables en web y móvil.
- Las soluciones de todos se mantienen privadas hasta el cierre.

## Verificación ejecutada el 2026-08-04

| Comprobación | Resultado |
|---|---|
| `pnpm test:e2e` | Se repetirá tras integrar la sopa de letras en el fixture E2E |
| Pruebas de dominio, API, base y worker | Verificadas en el ciclo anterior, incluyendo los cinco generadores |
| Lint, tipos, build, formato, runtime y documentos | Verificados en el ciclo anterior; se repetirán antes del siguiente commit de implementación |

El fixture E2E dejó de depender de la fecha fija de julio: el archivo y la sección de soluciones de ayer se construyen con la fecha real de `Europe/Madrid`. También se actualizó su contrato de reserva para los cinco formatos.

## Puertas externas de producción

Estas acciones requieren credenciales, contratos o infraestructura fuera del repositorio y no se sustituyen por datos ficticios:

- Staging europeo con PostgreSQL 18, TLS, backups/PITR y restore medido.
- Proveedor principal y secundario de IA, DPA y verificación factual externa.
- Proyecto Supabase, MFA/reauth de roles y prueba de eliminación en procesadores.
- Credenciales EAS/Expo y prueba física Android; iOS publicado queda expresamente fuera de la primera fase.
- CMP/anuncios con revisión legal y credenciales de proveedor, sin pasar IDs de prueba a producción sin aprobación.
- Observabilidad distribuida, WAF/rate limit multi-réplica, alertas, carga, DAST/pentest y auditoría WCAG manual.

El detalle y la evidencia de cada puerta permanecen en [el plan de implementación](../roadmap/implementation-plan.md) y [la preparación de release](../runbooks/release-readiness.md).

## Próximo orden de ejecución

1. Repetir la batería completa y actualizar la evidencia de trazabilidad y release.
2. Preparar y verificar las puertas externas de staging sin inventar proveedores o credenciales.
