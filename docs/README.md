# Lúdico — baseline de especificación

Estado: `APPROVED`
Fecha de corte: 2026-07-28
Zona horaria de negocio: `Europe/Madrid`

Este directorio es la fuente de verdad del producto. No se inicia el scaffolding ni la implementación hasta que todos los documentos estén en estado `APPROVED` y la revisión de coherencia no tenga bloqueos.

## Documentos

1. [Descubrimiento](product/discovery.md)
2. [PRD](product/prd.md)
3. [Especificación funcional](specs/functional.md)
4. [Especificación UX/UI](specs/ux-ui.md)
5. [Especificación técnica](architecture/technical.md)
6. [Modelo de datos](architecture/data-model.md)
7. [Contratos API](api/contracts.md)
8. [Plan de analítica](analytics/tracking-plan.md)
9. [Threat model](security/threat-model.md)
10. [Estrategia de pruebas](testing/strategy.md)
11. [ADR](adr/README.md)
12. [Plan de implementación](roadmap/implementation-plan.md)
13. [Matriz de trazabilidad](review/traceability.md)
14. [Revisión de coherencia](review/coherence-review.md)
15. [Desarrollo y recuperación local](runbooks/local-development.md)

## Puertas de calidad

- `G0 Descubrimiento`: alcance, supuestos y riesgos definidos.
- `G1 Especificación`: requisitos con identificadores y aceptación verificable.
- `G2 Coherencia`: **aprobada 2026-07-28**; trazabilidad requisito → historia → prueba sin huecos críticos.
- `G3 Scaffolding`: herramientas, entornos, CI, migraciones y arranque reproducibles.
- `G4 Slice`: cada historia pasa lint, tipos, unitarias, integración, E2E y build aplicables.
- `G5 Lanzamiento`: seguridad, accesibilidad, resiliencia, consentimiento y operación aprobados.

La evidencia y las puertas pendientes de G5 se mantienen en [`runbooks/release-readiness.md`](runbooks/release-readiness.md); “compila” o “pasa CI” no sustituye staging, dispositivo, restore, pentest ni aprobación de tienda.

## Convenciones

- Requisitos: `FR-*` funcionales, `NFR-*` no funcionales, `SEC-*` seguridad.
- Historias: `US-*`; pruebas: `T-*`; ADR: `ADR-*`.
- Fechas persistidas en UTC; reglas de edición calculadas con `Europe/Madrid` y zona IANA, incluidas transiciones DST.
- El servidor es la autoridad de publicación, cierre, soluciones y puntuación competitiva.
- Una decisión no confirmada se registra como supuesto; ningún supuesto actual es bloqueante.
