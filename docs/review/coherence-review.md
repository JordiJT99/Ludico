# Revisión de coherencia

Estado: `APPROVED` · Fecha: 2026-07-28

## Alcance revisado

PRD, funcional, UX, técnica, datos, API, analítica, seguridad, pruebas, ADR, roadmap y trazabilidad. Esta revisión debe pasar a `APPROVED` antes de US-002.

## Hallazgos resueltos

1. **Premium en MVP vs Fase 2.** El encargo lo incluye en monetización y un criterio de lanzamiento, pero el MVP prioriza validar el bucle y la Fase 2 vuelve a incluirlo. Resolución: contrato de entitlement y comportamiento sin anuncios preparados; compra, restore y suscripción se implementan en Fase 2. Si premium es condición comercial de v1, se añade historia antes de aprobar G2.
2. **iOS en alcance vs Fase 2.** MVP pide base iOS y fases posteriores “iOS completo”. Resolución: un proyecto Expo común debe compilar iOS, pero publicación, QA de tienda, ATT y pulido final son Fase 2.
3. **Cierre a 23:59:59.** Un segundo final crea huecos/fracciones y problemas DST. Resolución: intervalo semiabierto y `closesAt` igual a medianoche local siguiente convertido a UTC.
4. **Resultado inmediato vs soluciones diferidas.** Resolución: estado/puntuación total provisional sin detalle correctivo; respuesta correcta, acierto por pregunta y explicación solo tras cierre.
5. **“Solución única” de crucigrama.** Sin un vocabulario acotado no es demostrable universalmente. Resolución: unicidad respecto del banco/versionado y restricciones del puzzle; definición guardada con el artefacto.
6. **Redis recomendado vs mínima operación.** Resolución: pg-boss/rate limit en PostgreSQL para MVP; Redis solo por evidencia de contención/escala.
7. **Panel separado recomendado.** Resolución: rutas admin dentro de web con API/RBAC separados; extraer únicamente si cadence/seguridad lo exige.
8. **Moderación automática vs calidad.** Resolución: autopublicación solo riesgo bajo y score/validadores concordantes; cualquier fuente sensible, discrepancia o edición manual requiere cola editorial.

## Cobertura

- `FR-001..016`: todos tienen historia y prueba principal.
- `NFR-001..012`: todos tienen owner/evidencia de release.
- `SEC-001..015`: todos tienen control y estrategia de prueba.
- `LAUNCH-01..20`: trazados; LAUNCH-13 queda explícitamente condicionado a Fase 2.
- Cada historia MVP declara descripción, dependencias, aceptación, pruebas, riesgos y DoD.

## Decisiones pendientes no bloqueantes para desarrollo local

| Decisión | Límite para resolver | Criterio |
|---|---|---|
| nombre/marca/dominio | antes de contenido público | búsqueda legal, dominio y tiendas |
| proveedor auth | antes de US-015 | DPA UE, export, MAU, métodos, SLA |
| hosting/Postgres/storage | antes de staging persistente | región/DPA, PITR, conexiones pg-boss, coste |
| CMP/analítica/ads | antes de US-032 | políticas España/UE y SDK compatibles |
| edad mínima/titular legal | antes de beta externa | asesoría, tiendas y privacidad |
| herramienta E2E mobile | spike US-014 | TalkBack/VoiceOver, estabilidad CI y coste |

## Comprobaciones de aprobación G2

- Enlaces Markdown locales e IDs validados el 2026-07-28: sin ausencias.
- DTO SEO público y comparación privada separados; caché condicionada a `publishedAt`.
- Matriz exacta de permisos añadida a contratos API; denegación por defecto.
- NFR-002 cuantificado inicialmente en 100 lecturas/s, 25 escrituras/s y ráfaga de 1.000 submits/min.
- Premium/iOS diferidos se aceptan como supuesto por la regla del encargo de usar el valor razonable cuando no sea crítico; se mantienen puertas explícitas antes de producción.

## Veredicto

No quedan contradicciones o huecos críticos que impidan implementar el MVP local. G0, G1 y G2 quedan aprobadas; se autoriza US-002 y, tras su verificación, US-003/US-010.
