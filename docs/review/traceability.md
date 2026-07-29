# Matriz de trazabilidad

Estado: `APPROVED`

## Requisitos funcionales y seguridad

| Requisito | Historias | Pruebas principales |
|---|---|---|
| FR-001, FR-007 | US-010, US-013 | T-UNIT-002/003, T-INT-002, T-E2E-004, T-SEC-001 |
| FR-002 | US-011 | authz/expiry, T-E2E-001 |
| FR-003 | US-015 | T-E2E-002, SEC-004/005 |
| FR-004 | US-012 | T-UNIT-001/006, T-E2E-001 |
| FR-005 | US-014, US-021 | T-UNIT-004/005, T-E2E-003, T-A11Y-001 |
| FR-006 | US-012/014/030 | T-E2E-008, T-INT-004 |
| FR-008 | US-012/014 | T-UNIT-001, tamper tests |
| FR-009 | US-016 | T-UNIT-002/007, T-E2E-004 |
| FR-010 | US-016 | share leak test |
| FR-011 | US-031 | adapter/DST/deep-link tests |
| FR-012 | US-032 | T-E2E-006, a11y/perf/policy checks |
| FR-013 | US-022 | RBAC matrix, SEC-006, admin E2E |
| FR-014, FR-016 | US-020/021/022 | T-UNIT-005/006, T-INT-003, T-E2E-005 |
| FR-015 | US-033 | schema, dedupe, privacy tests |
| SEC-001..015 | US-010..034 según frontera | T-SEC-001, authz/replay/DAST/SAST/SCA/pentest/DR |

## No funcionales

| Requisito | Historia propietaria | Evidencia |
|---|---|---|
| NFR-001/002 | US-034 | T-PERF-001 y dashboard p75/p95 |
| NFR-003/009/012 | US-010/020/034 | SLOs, alertas, reserva y game day |
| NFR-004/007 | US-012/014/034 | T-A11Y-001 y matriz compatibilidad |
| NFR-005/006 | US-015/032/034 | threat model, pentest, flujo de derechos |
| NFR-008 | US-003/034 | T-DR-001, registro RPO/RTO |
| NFR-010 | US-002/003 | CI, boundaries, migrations, docs |
| NFR-011 | US-002/012/014 | locale externo y tests Madrid/UTC |

## Criterios generales de lanzamiento

| ID | Criterio | Historias/evidencia |
|---|---|---|
| LAUNCH-01 | publicación automática diaria | US-010, T-UNIT-003/T-E2E-004 |
| LAUNCH-02 | varios días de reserva | US-020/021, dashboard y T-E2E-005 |
| LAUNCH-03 | solución inaccesible antes del cierre | US-010/013, SEC-001/T-SEC-001 |
| LAUNCH-04 | cierre/publicación idempotentes | US-010, T-UNIT-003/T-INT-002 |
| LAUNCH-05 | fallo IA no impide publicar | US-020, T-E2E-005 |
| LAUNCH-06 | progreso conservado | US-012/014/030, T-E2E-008 |
| LAUNCH-07 | juego sin registro | US-011/012/014, T-E2E-001/003 |
| LAUNCH-08 | registro conserva invitado | US-015, T-E2E-002 |
| LAUNCH-09 | comportamiento esencial web/app | US-012/014/034, E2E web/mobile |
| LAUNCH-10 | experiencia mobile fluida | US-014/034, T-PERF-001/T-A11Y-001 |
| LAUNCH-11 | anuncios de prueba | US-032, validación de configuración/E2E |
| LAUNCH-12 | consentimiento operativo | US-032, T-E2E-006 |
| LAUNCH-13 | premium sin anuncios | Fase 2; entitlement contract en US-032 y compra/restore antes de afirmar este criterio |
| LAUNCH-14 | métricas instrumentadas | US-033, contrato/dashboard |
| LAUNCH-15 | E2E críticos | US-034, informe CI |
| LAUNCH-16 | alertas operativas | US-020/034, game day |
| LAUNCH-17 | accesibilidad auditada | US-034, T-A11Y-001 |
| LAUNCH-18 | sin vulnerabilidades críticas conocidas | US-034, scanners/pentest |
| LAUNCH-19 | documentación mantenible | US-001/002/034, onboarding dry run |
| LAUNCH-20 | desactivación remota | US-010/022, E2E kill switch |

**Coherencia detectada:** el encargo incluye premium en criterios generales pero lo excluye del alcance funcional MVP salvo “suscripción premium opcional”. Decisión: `EntitlementPort` y exclusión de anuncios se preparan; compra/restore y la afirmación LAUNCH-13 son puerta de Fase 2, no bloquean el lanzamiento gratuito MVP. Si negocio exige premium en v1, se crea historia antes de G2.
