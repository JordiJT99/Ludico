# Preparación de release web y Android

Estado: `DRAFT-EVIDENCE` · La aplicación está preparada para staging; G5 no está firmada.

## Evidencia automatizada disponible

Última ejecución local: 2026-07-29. `pnpm check` validó 17 documentos, 32 tests de dominio, 37 de base de datos, 43 de API, 8 de worker, builds Next/Expo web+Android+iOS/API/worker y 5 E2E Chromium. `pnpm security:check` pasó el umbral alto/crítico con el residual moderado documentado.

| Área | Estado | Evidencia |
|---|---|---|
| especificación/trazabilidad | verificada | `pnpm docs:check` |
| formato, lint y tipos | verificada | `pnpm format:check`, `pnpm lint`, `pnpm typecheck` |
| CI remota | verificada | [GitHub Actions #30495177167](https://github.com/JordiJT99/Ludico/actions/runs/30495177167), SHA `07df1ce131c8250979e7e5c7057f640ef7db51c4`: jobs `secrets` y `check` correctos; `check` migró PostgreSQL 18 efímero y ejecutó `pnpm check` |
| dominio/API/DB/worker | verificada localmente | tests unitarios e integración PGlite serializados, más migración/seed, restore aislado y API diaria contra PostgreSQL 18 local |
| web/PWA | verificada | build Next + E2E Chromium online/offline, caché sensible excluida |
| Android/base iOS | verificada en compilación JS | Expo export Android/iOS/web; no equivale a build firmado ni prueba física |
| seguridad HTTP | verificada | CSP/cabeceras, CORS, CSRF, payload cap, safe errors, rate limit, correlation ID y métricas internas protegidas |
| supply chain | verificada con residual | audit sin altas/críticas; `uuid` moderado sólo en tooling Expo |
| SEO | verificada | robots y sitemap no incluyen admin/API/previews |
| accesibilidad | baseline automatizado | idioma, IDs, alternativas y nombres accesibles; falta auditoría WCAG manual |
| privacidad | verificada en producto | opt-in granular, retirada inmediata, ocho eventos allowlist web/native sin respuestas/PII, cuarentena sin payload/sujeto con TTL y anuncios deshabilitados/test |

## Puertas externas obligatorias para G5

### CI remota confirmada

La primera ejecución con evidencia ya está completada: [GitHub Actions #30495177167](https://github.com/JordiJT99/Ludico/actions/runs/30495177167) sobre `07df1ce131c8250979e7e5c7057f640ef7db51c4`, con `secrets` y `check` verdes. `check` instaló dependencias bloqueadas, aplicó las migraciones en PostgreSQL 18 efímero, ejecutó la comprobación de seguridad, instaló Chromium y terminó `pnpm check` correctamente.

Cada cambio posterior en `main` debe conservar ambos jobs verdes. Si el repositorio pasa a una organización que lo requiera, configurar `GITLEAKS_LICENSE` antes del siguiente push.

- Desplegar staging UE con PostgreSQL 18, TLS, secretos gestionados, backups/PITR y datos sintéticos aislados.
- Ejecutar migración desde el artefacto anterior, restore aislado y medir RPO/RTO; adjuntar fecha, operador y resultado.
- Configurar WAF/rate limit distribuido, observabilidad/tracing, dashboards SLO y alertas con runbook; ejecutar game day de DB, worker, IA y push.
- Ejecutar carga objetivo NFR-002, Lighthouse/Web Vitals móvil y matriz de dos navegadores estables; guardar percentiles, no promedios.
- Auditar WCAG 2.2 AA con teclado, lector de pantalla, zoom/reflow, contraste y Android físico low/mid tier; corregir todos los bloqueos críticos.
- Completar SAST/secret scan/DAST y pentest independiente; cero altas/críticas abiertas y aceptación formal de cualquier riesgo menor.
- Provisionar Supabase real, roles/MFA/reauth, DPA/subprocesadores/residencia, verificar que el outbox de borrado elimina el sujeto en Auth y todos los destinos/backups según SLA, y completar revisión legal RGPD/cookies.
- Crear proyecto EAS, credenciales FCM/APNs, builds firmados; probar push opt-in/deep link/baja en dispositivo físico y smoke Android. iOS sólo debe compilar en esta fase.
- Validar contenido/fuentes/licencias, reserva aprobada ≥7 días, alertas a 10 días y simulacro de fallback/publicación/cierre Madrid/DST.
- Completar ficha Google Play, política de privacidad, clasificación, Data Safety, screenshots, accesibilidad, revisión publicitaria y aprobación de negocio. Mantener ads reales deshabilitados hasta esa aprobación.

## Decisión

No promover mientras quede una puerta externa sin dueño, fecha y evidencia. El responsable de release registra commit, imágenes, migración, configuraciones no secretas, resultados, riesgos aceptados y rollback. Ante fallo de smoke: detener promoción, conservar la versión anterior y aplicar forward-fix; nunca editar migraciones ya desplegadas.
