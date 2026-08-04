# Auditoría de completitud del MVP

Fecha de revisión: 2026-08-04. Alcance: requisitos del plan de producto y del motor de contenido, contrastados con código, pruebas y la matriz de trazabilidad.

## Resultado

La base operativa del MVP está implementada y comprobada localmente: edición diaria, sesión invitada y cuenta, quiz, crucigrama, progreso offline, cierre y soluciones, ranking, backoffice, PWA, consentimiento, analítica y motor de contenido. No es todavía un lanzamiento de producción firmado: las puertas que dependen de proveedores, credenciales, legal, dispositivos físicos y staging siguen abiertas y están registradas abajo.

## Evidencia funcional

| Área | Estado | Evidencia |
|---|---|---|
| Edición diaria, Madrid/DST y cierre idempotente | Implementada | `packages/domain/src/edition.ts`, `packages/database/src/editions.ts`, `apps/worker/src/jobs.ts` |
| Quiz y crucigrama públicos, guardado y revisión sin filtraciones | Implementada | `apps/web/app/jugar`, `apps/mobile`, pruebas E2E 2 y 3 |
| Sesión invitada, cuenta y migración | Implementada | `apps/api/src/app.ts`, E2E 4 |
| Racha, resultados, ranking y compartir seguro | Implementada | `packages/domain/src/scoring.ts`, `apps/api/src/app.ts` |
| PWA, caché segura y reconexión | Implementada | `apps/web/public/sw.js`, E2E 2 y 3 |
| Consentimiento, anuncios de prueba y analítica sin respuestas | Implementada | `packages/domain/src/consent.ts`, E2E 1 |
| Administración, calendario, auditoría, banco y revisión | Implementada | `apps/web/app/admin`, E2E 5 |
| Planificación, reserva y validación de contenido | Implementada | `packages/database/src/content-pipeline.ts`, `apps/worker/src/content-jobs.ts` |
| Cinco formatos en el motor | Implementada | `packages/domain/src/content-validation.ts`, `packages/domain/src/daily-games.ts`, `apps/worker/src/fake-content-generator.ts` |

## Decisión de alcance pendiente de completar en producto

El PRD y la hoja de ruta definen la primera experiencia pública como quiz y crucigrama. El motor ya genera, valida, reserva y muestra en administración también verdadero/falso, adivina la palabra y sopa de letras. Esos tres formatos no se seleccionan todavía para una edición pública ni tienen intento, puntuación o interfaz de juego. Por tanto:

- El requisito de generación de los cinco formatos está cubierto.
- El requisito más amplio de que los cinco sean jugables aún no está cubierto y será el siguiente bloque de trabajo, empezando por los contratos de juego e intentos para no exponer soluciones.
- La edición diaria actual mantiene solo los dos juegos cuya experiencia completa está validada; no se publicará contenido sin jugador ni verificación de puntuación.

## Verificación ejecutada el 2026-08-04

| Comprobación | Resultado |
|---|---|
| `pnpm test:e2e` | 5 de 5 pruebas correctas |
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

1. Convertir verdadero/falso, adivina la palabra y sopa de letras en juegos públicos completos con contratos de intento, progreso, solución posterior al cierre, puntuación servidor y E2E.
2. Integrarlos en la selección de la edición únicamente cuando cada tipo cumpla sus invariantes y pruebas de fuga.
3. Repetir la batería completa y actualizar la trazabilidad, operaciones y la preparación de release.
4. Preparar y verificar las puertas externas de staging sin inventar proveedores o credenciales.
