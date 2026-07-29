# Descubrimiento

Estado: `APPROVED`

## 1. Resumen ejecutivo

Lúdico será una plataforma española de retos breves que publica cada día un quiz y un crucigrama originales. Se podrá empezar sin cuenta, continuar offline, guardar progreso y volver al día siguiente para revisar soluciones y comparar resultados. El MVP valida un único hábito: **entrar, jugar, volver y revisar**. La automatización prepara y valida contenido con reserva suficiente para que un fallo de IA nunca deje una edición vacía.

La distribución inicial es web responsive/PWA y Android; el código mobile queda listo para compilar iOS, cuya publicación se posterga. Monetización: anuncios respetuosos en web y Android, consentimiento previo cuando corresponda y una futura suscripción sin ventajas competitivas.

## 2. Identidad provisional

**Nombre recomendado: Lúdico.** Es corto, español, amplio y no ata el producto a un juego. Antes de lanzamiento requiere búsqueda de marca, dominio y tiendas.

Alternativas:

- **Reto de Hoy**: muy descriptivo; menos diferenciable.
- **Mente al Día**: comunica hábito y aprendizaje; tono algo editorial.
- **Casilla Cero**: distintivo y visual; menos claro para quiz.

Personalidad: ingeniosa, cálida, serena y honesta. Promesa verbal: “Un rato para pensar, cada día”. Identidad visual original basada en tinta azul noche, acento coral y crema; sin imitar periódicos concretos.

## 3. Propuesta de valor

“Dos retos originales y bien explicados cada día, jugables en minutos y en cualquier dispositivo, con progreso privado, comparación justa y cero spoilers.”

Diferenciadores:

- calidad y explicación verificable, no volumen infinito;
- vuelta al día siguiente con aprendizaje, no castigo;
- experiencia anónima útil y registro opcional;
- publicidad fuera de la interacción principal;
- continuidad operativa mediante reserva validada.

## 4. Público objetivo

Primario: personas de 25–64 años en España que disfrutan de cultura general y pasatiempos breves, usan móvil a diario y valoran una experiencia clara. Secundario: estudiantes adultos, personas mayores digitalmente activas y familias que comparten resultados. No se diseña específicamente para menores; la edad mínima y el tratamiento legal se fijarán antes de producción.

Perfiles:

- **Elena, 42, hábito diario:** juega 8 minutos al desayunar; quiere continuidad y explicaciones.
- **Raúl, 29, competitivo casual:** comparte patrón y compara puntuación, sin pagar para ganar.
- **Pilar, 67, crucigramista:** necesita texto escalable, controles claros y teclado accesible.
- **Nora, 34, editora:** revisa excepciones, reserva y calendario; no debe operar cada edición manualmente.

## 5. Bucle principal

1. Descubre la edición del día.
2. Elige quiz o crucigrama y progresa sin registrarse.
3. Finaliza y obtiene resultado parcial sin soluciones protegidas.
4. Comparte un patrón sin spoilers y ve racha/progreso.
5. Al día siguiente revisa respuestas, explicación y comparación final.
6. Encuentra la edición nueva y repite.

Bucle semanal: completar al menos 4 días → resumen de mejora y clasificación semanal → objetivo moderado para la semana siguiente.

## 6. Alcance exacto del MVP

- Web SSR responsive y PWA instalable.
- Aplicación Android con Expo/React Native; proyecto compatible con iOS sin publicación inicial.
- Inicio anónimo, almacenamiento local y conversión segura a cuenta.
- Correo/contraseña, magic link, Google y Apple donde sea exigible.
- Una edición diaria con quiz de 5–15 preguntas y un crucigrama.
- Guardado local y remoto, offline para contenido ya descargado, sincronización idempotente.
- Cierre, puntuación, racha y ranking diario calculados por servidor.
- Soluciones y explicaciones solo tras cierre.
- Compartir resultado sin respuesta.
- Push básico: reto disponible y solución anterior, con consentimiento y quiet hours.
- AdSense/AdMob mediante adaptadores y exclusivamente IDs de prueba fuera de producción.
- Consentimiento RGPD, retirada, anuncios no personalizados y registro auditable.
- Backoffice dentro de la web: calendario, revisión, aprobación/rechazo, reserva, publicación manual y kill switch.
- Pipeline de quiz y crucigrama con validación, proveedor intercambiable, reintentos y reserva mínima de 7 días.
- Analítica esencial, logs, métricas, alertas y pruebas del flujo crítico.

## 7. Fuera del MVP

- iOS publicado, premium, compras, rewarded ads, amigos, ligas, torneos y duelos.
- Economía virtual, misiones complejas, personalización algorítmica y contenido por país.
- Más juegos, comentarios sociales, perfiles públicos y contactos.
- Microservicios, Kafka, Kubernetes, Redis, data warehouse propio y CMS independiente.

Se añaden solo tras señales de retención, escala o ingresos que justifiquen su coste.

## 8. Arquitectura recomendada

Monorepo TypeScript con `pnpm`: `apps/web` (Next.js 16, incluye backoffice), `apps/mobile` (Expo SDK 56/React Native), `apps/api` (Fastify 5 modular) y `apps/worker`. Paquetes compartidos solo para dominio, contratos, motores, UI tokens y testing. PostgreSQL 18 como fuente de verdad, Drizzle para SQL/migraciones y `pg-boss` para cola/scheduler, eliminando Redis del MVP. Object storage S3-compatible solo para previews/recursos. API REST `/v1`, OpenAPI generado desde esquemas, adaptadores de auth, IA, publicidad, push y analítica.

Despliegue inicial gestionado en región UE: web edge/CDN, API y worker como procesos independientes, PostgreSQL gestionado con PITR, almacenamiento UE y Expo EAS para binarios. El proveedor concreto se confirma al comparar precio, residencia, DPA y soporte en el momento de contratar.

## 9. Comparación web y mobile

| Opción | SEO | Reutilización | AdMob/nativo | Offline | Coste/risgo | Decisión |
|---|---:|---:|---:|---:|---:|---|
| Next.js + Expo RN | Excelente | Media-alta (dominio/contratos/tokens) | Excelente | Buena | Medio | Elegida |
| Next.js + Capacitor | Excelente | Muy alta | Buena con plugins | Buena | Bajo-medio | Reserva si Android no exige UX nativa |
| Flutter + web separada | Web separada | Baja con TS backend | Excelente | Excelente | Alto para equipo TS | Descartada |
| Solo PWA | Excelente | Máxima | Sin AdMob/tiendas pleno | Buena | Mínimo | No cumple distribución móvil |

Se comparte lógica, no componentes interactivos complejos: el crucigrama tendrá vistas web y native optimizadas sobre el mismo modelo de dominio.

## 10. Monetización

- MVP: AdSense responsive en home/resultado/archivo y AdMob banner/intersticial con límites; nunca durante escritura ni sobre controles.
- Primer intersticial tras 3 sesiones y al terminar un juego, máximo 1 cada 10 minutos y 2 por sesión; valores remotos y conservadores.
- Consentimiento por finalidad antes de personalización; fallback no personalizado o sin anuncio.
- Patrocinios identificados se consideran tras validar audiencia.
- Fase 2: premium sin anuncios, archivo ampliado, estadísticas y temas; rewarded ads solo en modos casuales.

## 11. Pipeline de contenido

`Planificar → generar esquema estricto → reglas deterministas → verificar fuentes/vigencia → evaluación semántica independiente → similitud/bloqueos → construir cuadrícula → validar invariantes → puntuar calidad → aprobar automáticamente solo bajo riesgo → guardar borrador → seleccionar → publicar idempotentemente`.

Todo artefacto conserva prompt/configuración, modelo, versión, fuentes, huella, resultado de validación y auditoría. La publicación elige primero contenido aprobado; si falla usa reserva, luego banco de emergencia y finalmente alerta/publicación manual. Nunca genera en el camino crítico de las 00:00.

## 12. Supuestos

- España y castellano son el único mercado/idioma del MVP.
- Día editorial: `[00:00:00, 24:00:00)` de `Europe/Madrid`; el cierre se representa como límite exclusivo del día siguiente.
- Ranking principal solo admite intentos sincronizados antes del cierre y sin ayudas que alteren respuesta.
- Una persona o equipo pequeño opera el producto; presupuesto y proveedor cloud aún no están fijados.
- No existe contenido previo, marca registrada, cuentas publicitarias ni contratos de proveedor.
- Moderación automática con cola manual por excepción, no revisión humana obligatoria de todo.
- Reserva objetivo 14 días, alerta a 10 y bloqueo operativo crítico a menos de 7.

## 13. Riesgos principales

| Riesgo | Prob. | Impacto | Mitigación |
|---|---:|---:|---|
| Contenido falso/ambiguo | Alta | Crítico | fuentes, doble evaluación, reglas, cuarentena, auditoría |
| Filtración de soluciones | Media | Crítico | payload público separado, cifrado/ACL, endpoint temporal y pruebas |
| Crucigrama inviable | Alta | Alto | banco curado, generador determinista, timeout, reserva |
| Baja retención | Alta | Alto | MVP pequeño, cohortes D1/D7, revisión del día anterior |
| Rechazo de anuncios/tienda | Media | Alto | CMP, test IDs, revisión de políticas antes de release |
| Complejidad operativa | Media | Alto | monolito modular, PostgreSQL para cola, servicios gestionados |
| Fraude en ranking | Media | Medio | reloj servidor, idempotencia, señales de abuso, ranking no monetizable |
| DST/cierre incorrecto | Media | Alto | zona IANA, límites exclusivos, pruebas marzo/octubre |
| Dependencia de IA | Media | Alto | adaptadores, reserva, circuit breaker y publicación manual |
| Accesibilidad del crucigrama | Media | Alto | diseño semántico temprano y auditoría con usuarios/AT |

## 14. Métricas

North Star: **usuarios semanales que completan un reto en ≥3 días distintos (W3C)**.

MVP: activación (primer juego completado), finalización por juego, retorno D1/D7/D30, revisión de solución al día siguiente, juegos/DAU, racha mediana, registro tras juego, errores/sesión, LCP/INP/CLS, sincronizaciones fallidas, días de reserva, rechazo de contenido y coste IA/edición. Monetización: ARPDAU, impresiones/sesión, fill rate, eCPM y efecto en finalización/retención. Guardrails: accesibilidad, crashes, reclamaciones, retiradas de consentimiento y clics accidentales.

Objetivos de validación a 90 días (hipótesis, no promesas): ≥60% finalización de juegos iniciados, D1 ≥25%, D7 ≥10%, ≥20% revisión del día anterior entre jugadores retornados, crash-free ≥99,5%, reserva ≥7 días y 0 filtraciones de solución.

## 15. Roadmap resumido

- **Fase 0 — Especificar (actual):** baseline, coherencia, prototipo técnico de riesgos sin producción.
- **Fase 1A — Fundaciones:** monorepo, edición/publicación, anónimo, quiz y resultados.
- **Fase 1B — MVP:** crucigrama, cuenta/sync, racha/ranking, pipeline, admin, notificaciones, ads, analítica, hardening y lanzamiento Android/web.
- **Fase 2:** iOS, archivo avanzado, logros, social privado, rewarded, premium y experimentos.
- **Fase 3:** más juegos, torneos, patrocinios, internacionalización y personalización.

## 16. Preguntas bloqueantes

Ninguna para especificar o construir localmente. Antes de producción sí serán bloqueantes: titular legal y edad mínima, presupuesto/país de facturación, dominios/marca, proveedores con DPA y cuentas de Apple/Google/AdSense/AdMob. Se documentan como puertas de lanzamiento, no detienen el MVP local.
