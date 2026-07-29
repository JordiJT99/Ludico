# Preparación de release web y Android

Estado: `DRAFT-EVIDENCE` · La aplicación está preparada para staging; G5 no está firmada.

## Evidencia automatizada disponible

Última ejecución local: 2026-07-29. `pnpm check` validó 17 documentos, 32 tests de dominio, 37 de base de datos, 43 de API, 8 de worker, builds Next/Expo web+Android+iOS/API/worker y 5 E2E Chromium. `pnpm security:check` pasó el umbral alto/crítico con el residual moderado documentado.

| Área | Estado | Evidencia |
|---|---|---|
| especificación/trazabilidad | verificada | `pnpm docs:check` |
| formato, lint y tipos | verificada | `pnpm format:check`, `pnpm lint`, `pnpm typecheck` |
| CI remota | configurada, sin evidencia | el worktree aún no tiene commits ni remoto; falta primer push y ejecución GitHub Actions |
| dominio/API/DB/worker | verificada localmente | tests unitarios e integración PGlite serializados, más migración/seed, restore aislado y API diaria contra PostgreSQL 18 local |
| web/PWA | verificada | build Next + E2E Chromium online/offline, caché sensible excluida |
| Android/base iOS | verificada en compilación JS | Expo export Android/iOS/web; no equivale a build firmado ni prueba física |
| seguridad HTTP | verificada | CSP/cabeceras, CORS, CSRF, payload cap, safe errors, rate limit, correlation ID y métricas internas protegidas |
| supply chain | verificada con residual | audit sin altas/críticas; `uuid` moderado sólo en tooling Expo |
| SEO | verificada | robots y sitemap no incluyen admin/API/previews |
| accesibilidad | baseline automatizado | idioma, IDs, alternativas y nombres accesibles; falta auditoría WCAG manual |
| privacidad | verificada en producto | opt-in granular, retirada inmediata, ocho eventos allowlist web/native sin respuestas/PII, cuarentena sin payload/sujeto con TTL y anuncios deshabilitados/test |

## Puertas externas obligatorias para G5

### Activación inicial de CI

Este worktree aún no tiene commits ni remoto. Antes de tratar los workflows como evidencia, el responsable debe revisar el estado, crear el primer commit intencional, conectar el repositorio privado y hacer push a `main`:

```powershell
git status --short
git add --all
git commit -m "chore: bootstrap ludico MVP"
git branch -M main
git remote add origin <URL_DEL_REPOSITORIO_PRIVADO>
git push -u origin main
```

La primera ejecución debe mostrar verdes los jobs `secrets` y `check`; este último aplica las migraciones contra PostgreSQL 18 efímero antes de ejecutar la suite. Si el repositorio pertenece a una organización, configurar `GITLEAKS_LICENSE` antes del push. Conservar el enlace de la ejecución, SHA, logs de migración y resultado de los jobs como evidencia de G5.

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
