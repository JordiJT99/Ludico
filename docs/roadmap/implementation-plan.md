# Plan de implementación

Estado: `APPROVED`. Una historia no entra en desarrollo sin aceptación aprobada. DoD común: criterios demostrados; código/migración revisados; lint/tipos/tests/build verdes; seguridad, accesibilidad, errores, offline, analítica, observabilidad, documentación y changelog aplicables; deploy staging y sin deuda crítica oculta.

## Estado de ejecución

| Historia | Estado | Evidencia / pendiente |
|---|---|---|
| US-001 | completada | G0–G2 aprobadas, docs check y trazabilidad |
| US-002 | completada | `pnpm check`, hooks, `.env.example`, builds web/Expo/API/worker, comprobación de imports compilados y objetivos OCI API/worker/web sin secretos; [CI remota verde](https://github.com/JordiJT99/Ludico/actions/runs/30499913479) en `7d5962e` con SCA, secret scan, las tres imágenes construidas y smoke tests de API/web |
| US-003 | en progreso | migración/seed y restore aislado verificados en PGlite y PostgreSQL 18 local; CI PostgreSQL 18 confirmada, pg-boss/retry/DLQ/singleton; falta restore real PostgreSQL 18 en staging |
| US-010 | en progreso | DST, publish/close idempotente, reserva manual, horarios de apertura/cierre/planificación configurables y auditados, kill switch, outbox/audit, solution gate, API/web/mobile y edición diaria contra PostgreSQL 18 local; quiz y crucigrama comprobados manualmente en navegador contra esa API; falta E2E completo con PostgreSQL 18/staging |
| US-011 | en progreso | token 256-bit/hash, rotación con sujeto estable por linaje, expiración, revocación, cookie HttpOnly, SecureStore y XOR de GameAttempt verificado; la web renueva una sesión invitada inválida al reanudar; falta E2E en dispositivo |
| US-012 | en progreso | contrato 5–15×4, score servidor antifraude, progreso deduplicado/versionado, submit idempotente, resultado sin soluciones, UI web/native y E2E web con teclado, offline y reconexión; quiz completado manualmente en navegador contra PostgreSQL 18 local; faltan E2E en dispositivo y auditoría a11y completa |
| US-013 | en progreso | gate 423/no-store, publicación idempotente de proyección sin metadatos internos, snapshot histórico autocontenido, ruta web noindex antes de cierre, revisión pública + comparación personal web/native, destacado de ayer, archivo de 7 días web/native y medias/porcentajes por pregunta o palabra sólo con cohorte ≥20; falta auditoría manual web/dispositivo de la revisión completa |
| US-014 | en progreso | modelo público/privado, máscara, cruces, numeración, NFC/Ñ, score v1, celdas/eventos versionados, ayuda casual, UI web/native de cuadrícula + campos, revisión pública/personal resuelta y E2E web offline, teclado/táctil y pulsaciones rápidas bajo red lenta; persistencia de letra comprobada al recargar en navegador contra PostgreSQL 18 local; faltan E2E offline en dispositivo y lector manual |
| US-015 | en progreso | identidad Supabase verificada, migración/merge transaccional, propietario XOR, reanudación por `user_id`, web con access/refresh `HttpOnly`, Expo con `SecureStore`, exportación y baja reautenticada/pseudonimizada web/native, UI accesible y E2E de cuenta; faltan borrado verificado en Supabase/procesadores, DPA/config real de staging y prueba manual en dispositivo |
| US-016 | completada | duración verificable, ranking por juego/diario/semanal derivado con desempate estable, percentil privado, alias opt-in auditado, racha por fecha local, resumen personal de ayer web/native, share server-side sin spoilers y finalización atómica de intentos con evento de cierre |
| US-020 | en progreso | reserva dinámica de 14 días por tipo más candidato en curso, emergencia determinista validada, presupuesto/coste, adapter intercambiable, schema/invariantes, fuentes HTTPS por ítem, bloqueos, duplicado exacto y similitud tokenizada acotada, cuarentena de riesgo, puertos de verificación/evaluación, alertas estructuradas y circuit breaker por proveedor/tipo con contadores; `deterministic` rota un banco curado verificable y `disabled` evita IA externa sin interrumpir la reserva. El adaptador OpenAI usa Responses con JSON schema, timeout y fallback curado; sus borradores siguen en revisión hasta contar con verificador factual. Faltan credenciales/DPA real, verificador externo y proveedor alternativo probado. |
| US-021 | completada | banco curado versionado con procedencia/estado y gestión auditada, constructor determinista con tiempo/nodos acotados, conectividad/cruces/densidad/numeración, verificador real de alternativas, recomposición por semilla y preview SVG sin solución; pruebas de semillas, fallo limpio, persistencia y E2E editorial |
| US-022 | en progreso | `/admin` noindex, BFF no-store, calendario/reserva con alerta <10 y programación humana auditada, preview público+privado/SVG, plan, banco léxico, revisión inmutable, decisiones, bloqueos y feed de auditoría acotado solo superadmin; RBAC desde `app_metadata`, actor humano/emergencia separado y reauth <15 min con E2E; faltan provisioning/hook MFA real y matriz completa manual |
| US-030 | en progreso | manifest, atajos e iconos propios web/Android/iOS, service worker sin caché sensible, actualización elegida por la persona, shell recargable sin servidor, localStorage/SQLite para ambos juegos y reconciliación serializada sin bloquear la entrada verificados; falta validación en dispositivos |
| US-031 | en progreso | preferencias de cuenta, opt-in explícito Android/iOS, token Expo cifrado, quiet hours IANA/DST, digest de dos casos, cap 1/día y 3/semana, dedupe, baja inmediata, deep link validado, retry y token stale desactivado; faltan credenciales/proyecto EAS reales y E2E manual en dispositivo físico |
| US-032 | en progreso | consentimiento append-only versionado para invitado/cuenta, migración de sujeto, elecciones independientes web/native, retirada inmediata, slot estable y anuncio inerte solo con `ADS_MODE=test`, sin SDK/ID real, más E2E T-E2E-006; faltan revisión legal, adapter/caps reales aprobados y auditoría a11y/perf/dispositivo |
| US-033 | en progreso | collector first-party con allowlist estricta, schemas compartidos, dedupe por UUID, ventana temporal, filtro por consentimiento, ocho eventos MVP web/native sin respuestas/PII, cuarentena sin payload/identidad con TTL y volumen visible, retención diaria auditable y dashboard RBAC de agregados/dedupe/freshness sin sujetos; falta borrado verificado en destinos/backups |
| US-034 | en progreso | límite JSON 256 KiB, validación/errores seguros, correlation ID, CORS/CSRF, CSP y cabeceras, rate limit local, health/readiness DB, métricas HTTP internas protegidas, robots/sitemap, baseline a11y E2E, Lighthouse local de build de producción (99 rendimiento, 100 accesibilidad, 96 buenas prácticas, 100 SEO), objetivos OCI reproducibles y audit sin vulnerabilidades altas; faltan proveedor/secretos/observabilidad de staging, edge limit multi-réplica, OTel/alertas, carga y Lighthouse en staging/dispositivo, auditoría WCAG/dispositivos, restore staging, pentest y aprobaciones legal/tiendas |

## Épica E0 — Especificación y fundaciones

### US-001 — Baseline documental

**Descripción:** completar y aprobar documentos, ADR y trazabilidad. **Dependencias:** ninguna. **Aceptación:** G0–G2 sin bloqueos; todo FR/NFR/SEC enlaza historia/prueba; supuestos y puertas producción visibles. **Pruebas:** enlaces/docs lint y revisión cruzada. **Riesgos:** falsa completitud; mitigar checklist/matriz. **DoD:** común documental, sin código de producto.

### US-002 — Monorepo reproducible

**Descripción:** workspace mínimo, apps/packages decididos, CI y entornos. **Dependencias:** US-001. **Aceptación:** clone→install→lint→types→test→build documentado; Node/pnpm fijados; `.env.example` sin secretos; CI bloquea fallo crítico; commits/hooks y changelog. **Pruebas:** CI limpia y secret scan. **Riesgos:** scaffolding excesivo; crear solo módulos del primer slice. **DoD:** común.

### US-003 — Persistencia y operación base

**Descripción:** PostgreSQL, migrador, audit/outbox/idempotency y pg-boss. **Dependencias:** US-002. **Aceptación:** migración up en vacío y desde versión previa; seed sintético; job singleton/retry/DLQ; backup/restore local documentado. **Pruebas:** T-INT-001/002. **Riesgos:** pool/queue compiten; budgets y métricas. **DoD:** común.

## Épica E1 — Bucle diario vertical

### US-010 — Edición, publicación y cierre

**Descripción:** crear, programar, publicar/cerrar una edición desde admin/API/worker y mostrar estado web/mobile mínimo. **Dependencias:** US-003. **Aceptación:** FR-001/007; fecha Madrid/DST; doble job no duplica; kill switch; reserva manual; soluciones bloqueadas. **Pruebas:** T-UNIT-002/003, T-INT-002, T-E2E-004, T-SEC-001. **Riesgos:** carrera/reloj/fuga. **DoD:** común + runbook publicación.

### US-011 — Sesión invitada

**Descripción:** entrar, jugar/guardar identidad local y reanudar. **Dependencias:** US-010. **Aceptación:** FR-002; token hash/rotación; sujeto XOR; privacidad; borrado/expiración. **Pruebas:** authz, expiración y dos dispositivos simulados. **Riesgos:** pérdida storage/abuso; UX y limits. **DoD:** común.

### US-012 — Quiz completo

**Descripción:** contenido, UI web/native, progreso, submit y resultado provisional. **Dependencias:** US-011. **Aceptación:** FR-004/006/008; 5–15×4×1; sin corrección; score servidor/versionado; navegación/a11y; offline descargado. **Pruebas:** T-UNIT-001, T-E2E-001/008, T-A11Y-001. **Riesgos:** leak/cache/conflicto. **DoD:** común.

### US-013 — Revisión y resultado anterior

**Descripción:** publicar snapshot y detalle explicativo tras cierre. **Dependencias:** US-012, US-010. **Aceptación:** FR-007; antes 423 y sin bytes secretos; después selección/correcta/explicación/estadística con umbral; home destaca ayer. **Pruebas:** T-E2E-004, T-SEC-001. **Riesgos:** caché/indexación prematura. **DoD:** común + SEO noindex pre-cierre.

### US-014 — Crucigrama jugable

**Descripción:** modelo/cuadrícula, UI web/native, accesibilidad, progreso y submit. **Dependencias:** US-011, US-010. **Aceptación:** FR-005/006/008; teclado/táctil/lista accesible; NFC/Ñ; guardado; ayudas casuales; revisión post-cierre. **Pruebas:** T-UNIT-004/005, T-E2E-003/008, T-A11Y-001. **Riesgos:** a11y/rendimiento mobile. **DoD:** común.

### US-015 — Cuenta y migración

**Descripción:** auth gestionado, perfil y migración de invitado. **Dependencias:** US-011/012/014. **Aceptación:** FR-003; métodos acordados; enumeración segura; migración transaccional/repetible; progreso más avanzado preservado; revocación. **Pruebas:** T-E2E-002 y SEC-004/005. **Riesgos:** proveedor/merge. **DoD:** común + DPA/config por entorno para prod.

### US-016 — Racha, ranking y compartir

**Descripción:** finalización competitiva, snapshots, percentil y share seguro. **Dependencias:** US-012/014/015. **Aceptación:** FR-009/010; una racha/día; tie-break estable; opt-in; patrón sin spoilers; pagos/ads no dan ventaja. **Pruebas:** T-UNIT-002/007, T-E2E-004, leak test share. **Riesgos:** fraude/privacidad. **DoD:** común.

## Épica E2 — Contenido autónomo

### US-020 — Generación/validación de quiz

**Descripción:** adapter IA, schemas, fuentes, evaluación, similitud y reserva. **Dependencias:** US-003/012. **Aceptación:** FR-014/016; lineage/coste; rechazos definidos; riesgo alto manual; provider caído usa reserva ≥7 días. **Pruebas:** T-UNIT-006, T-INT-003, T-E2E-005. **Riesgos:** falsedad/coste/licencia. **DoD:** común + alertas/dashboard.

### US-021 — Banco y generador de crucigramas

**Descripción:** entradas validadas, construcción determinista y preview. **Dependencias:** US-014/020. **Aceptación:** invariantes de sección funcional, timeout limpio, recomposición por semilla, pista/fuente auditada, reserva. **Pruebas:** T-UNIT-004/005 property tests, serialización y carga. **Riesgos:** NP-hard/calidad; límites y banco curado. **DoD:** común.

### US-022 — Backoffice mínimo

**Descripción:** calendario/revisión/reserva/emergencia y roles. **Dependencias:** US-010/020/021/015. **Aceptación:** FR-013; RBAC por API, MFA/reauth, motivo/auditoría, preview, publish/disable idempotente. **Pruebas:** matriz authz, SEC-006, E2E admin crítico. **Riesgos:** privilegio/error humano. **DoD:** común + manual operador.

## Épica E3 — Distribución, ingresos y lanzamiento

### US-030 — PWA y sincronización robusta

**Descripción:** instalación, cache segura, IndexedDB/SQLite, cola/conflictos. **Dependencias:** US-012/014/015. **Aceptación:** FR-006, manifest/service worker/offline page, no cache sensible, indicador y dedupe. **Pruebas:** T-E2E-008/T-INT-004. **Riesgos:** service-worker stale/leak. **DoD:** común.

### US-031 — Notificaciones

**Descripción:** opt-in, preferencias y dos casos básicos. **Dependencias:** US-015/010. **Aceptación:** FR-011; quiet hours/zone, cap, deep link, dedupe, unsubscribe. **Pruebas:** adapter contract, DST y E2E permiso. **Riesgos:** spam/token stale. **DoD:** común.

### US-032 — Consentimiento y publicidad de prueba

**Descripción:** CMP/adapters/placements y caps en web/Android. **Dependencias:** US-012/014/015. **Aceptación:** FR-012; retirar funciona; no personalizado/no ad; test IDs no-prod; no bloqueo/CLS/ventaja; flag global. **Pruebas:** T-E2E-006, policy config, a11y/perf. **Riesgos:** RGPD/políticas/retención. **DoD:** revisión legal requerida solo para producción.

### US-033 — Analítica y experimentación base

**Descripción:** collector, eventos MVP, dashboards y flags sin experimento activo. **Dependencias:** slices instrumentados, US-032. **Aceptación:** FR-015; schema CI, dedupe, consentimiento, métricas definidas, sin respuestas/PII. **Pruebas:** contracts/consent/data quality. **Riesgos:** datos engañosos/fuga. **DoD:** diccionario y dashboard.

### US-034 — Hardening y release web/Android

**Descripción:** rendimiento, seguridad, a11y, resiliencia, SEO/ASO, observabilidad y tiendas. **Dependencias:** todas MVP. **Aceptación:** NFR-001..012, SEC-001..015 y LAUNCH-01..20; test IDs sustituidos solo por secretos/config prod tras aprobación; iOS compila pero no publica. **Pruebas:** T-A11Y/PERF/DR, pentest, load, compatibility y restore. **Riesgos:** rechazo tienda/incidente. **DoD:** G5 firmado.

## Fase 2

iOS publicado → archivo avanzado/estadísticas/logros → social privado → rewarded ads casuales → premium/restore → experimentos. Cada bloque se reespecifica con señales MVP. Fase 3: más juegos, torneos/patrocinios, países/idiomas, recomendación, invitados y widgets.
