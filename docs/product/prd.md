# Product Requirements Document

Estado: `APPROVED` · Owner: Product · Mercado: España · Idioma: `es-ES`

## Problema y oportunidad

La oferta de pasatiempos diarios está fragmentada entre productos con registro forzado, publicidad intrusiva, explicaciones pobres o poca continuidad entre web y móvil. Lúdico ofrece una sesión breve de calidad, accesible sin cuenta y con una razón sana para regresar: revisar y aprender del día anterior.

## Objetivo y no-objetivos

Objetivo MVP: demostrar que una edición diaria automatizada con quiz + crucigrama puede sostener retorno y completitud sin operación editorial diaria ni degradar confianza.

No-objetivos MVP: red social, economía virtual, torneos, personalización por IA, catálogo amplio, premium e iOS publicado. La descripción de perfiles, propuesta, journeys, monetización y fases está en [Descubrimiento](discovery.md).

## Journeys

### Anónimo

Abre enlace → acepta/rechaza consentimiento no esencial → ve edición → juega → progreso local inmediato → finaliza → API acepta intento invitado firmado → muestra puntuación provisional → invita a crear cuenta → vuelve mañana → revisa solución. Si está offline, juega contenido descargado y queda “pendiente de sincronizar”; solo entra al ranking si el servidor confirma recepción previa al cierre.

### Registrado

Inicia sesión → recupera progreso multidispositivo → juega → sincroniza eventos idempotentes → finaliza → ve racha/ranking provisional → recibe recordatorio elegido → revisa solución final. Al convertir una sesión invitada, el servidor vincula intentos sin sobreescribir progreso más avanzado ni duplicar resultados.

## Requisitos funcionales

| ID | Requisito | Prioridad | Aceptación resumida |
|---|---|---:|---|
| FR-001 | Edición diaria | Must | existe una edición publicable por fecha local; publicación/cierre repetibles no duplican efectos |
| FR-002 | Juego anónimo | Must | se inicia sin cuenta, guarda local y obtiene resultado |
| FR-003 | Cuenta y migración | Must | registro conserva intentos invitados válidos y revoca token invitado usado |
| FR-004 | Quiz | Must | 5–15 preguntas, 4 opciones, una correcta; cliente no recibe corrección antes de cierre |
| FR-005 | Crucigrama | Must | teclado/táctil/lector, progreso, validación final, tildes normalizadas y solución diferida |
| FR-006 | Progreso y offline | Must | guardado local inmediato, remoto idempotente y estado de sincronización visible |
| FR-007 | Cierre y soluciones | Must | envíos competitivos posteriores se rechazan; solución disponible desde `closesAt` |
| FR-008 | Puntuación | Must | servidor calcula fórmula versionada y explica desglose |
| FR-009 | Racha y ranking | Must | actualización única tras intento elegible; empate estable y privacidad por defecto |
| FR-010 | Compartir | Must | patrón no contiene letras, opciones ni claves de respuesta |
| FR-011 | Notificaciones básicas | Should | opt-in, quiet hours, límites y deep link correctos |
| FR-012 | Ads y consentimiento | Must | test IDs fuera de prod; rechazo no impide jugar; premium preparado por interfaz |
| FR-013 | Administración | Must | roles, calendario, revisión, reserva, publicación manual, kill switch y auditoría |
| FR-014 | Generación y validación | Must | proveedor desacoplado, trazabilidad, cuarentena y fallback con reserva |
| FR-015 | Analítica | Must | eventos versionados sin respuesta/PII innecesaria y consentimiento aplicado |
| FR-016 | Contingencia | Must | caída de IA no afecta a una edición con reserva; alertas por umbral |

## Requisitos no funcionales

| ID | Requisito | Objetivo verificable |
|---|---|---|
| NFR-001 | Rendimiento web | p75 móvil: LCP ≤2,5 s, INP ≤200 ms, CLS ≤0,1 en páginas clave |
| NFR-002 | API | p95 lectura ≤300 ms y escritura ≤500 ms sin terceros con 100 req/s lectura, 25 req/s escritura y ráfaga de 1.000 submits/min; recalibrar con tráfico real |
| NFR-003 | Disponibilidad | 99,9% mensual API/juego; publicación diaria SLO 99,95% |
| NFR-004 | Accesibilidad | WCAG 2.2 AA aplicable; cero bloqueos críticos automatizados/manuales |
| NFR-005 | Seguridad | cero vulnerabilidades críticas conocidas; secretos fuera de repo; mínimo privilegio |
| NFR-006 | Privacidad | minimización, consentimiento auditable, exportación/borrado y retención definida |
| NFR-007 | Compatibilidad | dos últimas versiones estables de navegadores principales; Android soportado por Expo SDK |
| NFR-008 | Resiliencia | RPO ≤15 min, RTO ≤4 h; restauración trimestral probada |
| NFR-009 | Observabilidad | cada petición/job tiene correlation ID; alertas accionables y runbook |
| NFR-010 | Mantenibilidad | límites modulares, contratos versionados, CI obligatoria y migraciones reversibles/forward-fix |
| NFR-011 | Internacionalización | texto UI externalizado, locale y zona explícitos; dominio no depende de castellano |
| NFR-012 | Operación | ≥7 días aprobados de reserva; alerta a 10; dashboard de salud |

## Fórmula de puntuación MVP

Quiz por pregunta: `round(100 × dificultad × exactitud + bonusTiempo)`, con dificultad `{fácil:1, media:1.25, difícil:1.5}` y `bonusTiempo = round(25 × dificultad × max(0, 1 - tiempo/objetivo))`. Sin penalización por error. Quiz completo: +100. El tiempo se limita por señales servidor/cliente y nunca produce puntuación negativa.

Crucigrama: `100 × letrasCorrectas + 50 × palabrasCompletas + 500 por completar − 100 × ayudas`, mínimo 0. La clasificación principal excluye intentos con ayudas que revelan letras y cualquier segunda oportunidad recompensada. Bonus multijuego diario: +200 XP, no puntuación competitiva. Fórmula y parámetros llevan `scoreVersion`.

## Métricas y decisión MVP

North Star y objetivos en descubrimiento. Tras 90 días con muestra suficiente:

- perseverar si D7 ≥10%, finalización ≥60% y revisión al día siguiente ≥20%;
- iterar si se cumplen dos de tres sin guardrails degradados;
- replantear el bucle si D7 <7% pese a estabilidad/calidad.

No optimizar ingresos antes de lograr la retención mínima. Cualquier experimento publicitario vigila finalización, D7, CLS y clic accidental.

## Criterios de lanzamiento

Los 20 criterios generales del encargo se convierten en `LAUNCH-01..20` en la matriz de trazabilidad. Además: revisión legal/tiendas aprobada, runbook de incidente ensayado, restauración verificada, datos de prueba aislados y cuentas publicitarias en modo producción solo mediante configuración protegida.

## Riesgos y dependencias

Riesgos en descubrimiento. Dependencias externas: proveedor cloud UE, DNS, correo transaccional, push, CMP, AdSense/AdMob, Apple/Google, proveedor IA y fuentes licenciadas. Cada integración tiene adaptador y degradación; ninguna salvo base de datos está en el camino mínimo para jugar contenido ya publicado.
