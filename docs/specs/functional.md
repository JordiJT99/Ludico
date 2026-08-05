# Especificación funcional

Estado: `APPROVED`

## Estados y reglas globales

- `DailyEdition`: `draft → validating → approved → scheduled → published → closed → archived`; `rejected|cancelled` son terminales. Solo una edición no cancelada por `(market, localDate)`.
- `GameAttempt`: `in_progress → submitted → accepted|rejected → finalized`; un intento competitivo aceptado por usuario/sesión, juego y edición.
- El límite de cierre es exclusivo: se acepta si `serverReceivedAt < closesAt`. Nunca se modela `23:59:59`.
- Reintentos de comando usan `Idempotency-Key`; misma clave+huella devuelve el resultado original, distinta huella da `409`.
- Los DTO públicos de juego se construyen desde tablas/vistas sin soluciones. No se “ocultan” campos tras serializar la entidad completa.

## Identidad, perfil y ajustes (`FR-002`, `FR-003`)

El primer arranque crea `GuestSession` aleatoria, rotatoria y guardada de forma segura. La API conserva solo SHA-256 del secreto de 256 bits; web lo encapsula en cookie HttpOnly/SameSite mediante su BFF y mobile usa SecureStore. Caduca a los 30 días, puede rotarse transaccionalmente y revocarse sin revelar si existía. Cuenta: email/password, magic link, Google y Apple. Email se normaliza, no se revela existencia, contraseña con Argon2id si el proveedor no la gestiona, MFA obligatoria para administración. Perfil público desactivado; alias moderado. Ajustes: tema, texto, movimiento, sonido, idioma, juegos/categorías favoritas y zona/horario de avisos.

Conversión: autenticar → demostrar token invitado → bloquear sesión → vincular dispositivos/intentos en transacción → resolver por versión/eventos (submitted gana; si ambos in_progress, mayor progreso válido) → marcar sesión migrated → emitir auditoría. Repetir es inocuo.

Derechos de cuenta: la persona reautenticada puede descargar JSON con perfil, intentos, respuestas/celdas, preferencias, consentimientos y eventos analíticos. El borrado exige escribir `ELIMINAR`; en una transacción elimina consentimiento, analítica y dispositivos, desvincula sesiones migradas, retira identificadores/alias y emite `UserDeletionRequested` para procesadores. Los intentos y scores permanecen sólo bajo un sujeto pseudonimizado para conservar agregados; no pueden volver a mostrarse como perfil ni ranking nominal.

## Edición y juegos (`FR-001`, `FR-004`, `FR-005`)

Home devuelve edición vigente, disponibilidad y progreso, resultado anterior ya público y reserva nunca visible. Un juego desactivado aparece “temporalmente no disponible” sin romper la edición.

Quiz: orden de preguntas/opciones fijado por intento con semilla; una opción por pregunta; modificar antes de enviar; temporizador opcional monotónico local solo para UX, verificado con ventanas servidor. Al enviar, se sella el intento. Antes del cierre solo se devuelve aciertos/puntos cuando el modo lo permita sin revelar qué pregunta; decisión MVP: puntuación total provisional y estado completado, no detalle por pregunta.

Crucigrama: selección de celda/palabra, alternancia horizontal/vertical, flechas, Tab, Backspace y entrada táctil; `Ñ` distinta, tildes se muestran pero comparación usa forma NFC y política declarada. Guardado contiene letras del usuario, nunca solución. “Comprobar” solo valida formato antes del cierre; finalizar sella. Ayudas reveladoras convierten el intento en casual.

## Progreso, offline y conflictos (`FR-006`)

Cada cambio se guarda localmente y se agrupa para API con `clientEventId`, `attemptVersion` y tiempo del dispositivo. El service worker cachea shell, manifiesto y DTO público de edición; nunca endpoints de solución/auth/admin. Al reconectar, FIFO por intento. Servidor deduplica evento, valida transición y devuelve versión canónica. Conflicto: `submitted` es inmutable; en progreso se fusionan respuestas por último evento servidor y celdas por secuencia, registrando conflicto. Acciones online-only: ranking, inicio de nueva cuenta, anuncios, solución no descargada y finalización competitiva después de que no pueda probarse recepción previa.

## Cierre, resultado y revisión (`FR-007`)

Job `close-edition(localDate)` adquiere lock lógico, fija `closedAt`, bloquea nuevos envíos competitivos, finaliza scores, rachas y rankings en transacciones idempotentes, publica snapshot de soluciones y emite eventos. Fallo parcial reanuda por checkpoints. Revisión de quiz: selección, correcta, explicación, fuente pública, porcentaje, dificultad empírica, tiempo mediano, puntos. Crucigrama: solución, diferencias, pistas, duración, ayudas, comparación y palabras más falladas; solo con umbrales de privacidad.

## Puntuación, rachas y ranking (`FR-008`, `FR-009`)

Fórmula del PRD, ejecutada por paquete de dominio en servidor. Se conserva entrada, salida, versión y elegibilidad. Racha: un día cuenta si completa cualquier juego elegible; actualización por fecha local única; recuperación limitada queda fuera de MVP. Ranking diario por juego y combinado, semanal derivado; orden: puntos desc, duración verificada asc, `submittedAt` asc, id estable asc. Alias y opt-in; anónimos ven percentil pero no tabla nominal.

XP se registra en un ledger separado de la puntuación competitiva. El corte MVP concede 100 XP por cada finalización válida y 200 XP una sola vez al completar dos tipos distintos de juego en la misma edición; nivel es una función `xp-v1` del XP acumulado. Las reglas cosméticas iniciales son `first-game` (primera finalización) y `daily-double` (bonus multijuego), derivadas exclusivamente de transacciones confirmadas. Una corrección de score emite transacción compensatoria, nunca reescribe silenciosamente el historial. XP, nivel y logros no alteran score, ranking ni anuncios.

## Compartir (`FR-010`)

Texto incluye marca, fecha, tipo, puntuación/tiempo, patrón de estados abstractos y URL canónica. El servidor/test de fuga rechaza letras, IDs de opción, pistas no públicas y claves. Web Share API con copia fallback; mobile share sheet. Nunca se sube una imagen personal sin acción explícita.

## Notificaciones (`FR-011`)

Opt-in separado por canal/caso. Casos MVP: edición disponible y solución anterior. Quiet hours por zona, máximo 1 push/día y 3/semana inicialmente, deduplicación por `(user, template, edition)`, deep link validado, baja inmediata. Email es opcional y posterior si no es necesario para magic link.

Fase 2 añade riesgo de racha, récord/logro, desafío/liga y resumen semanal. Cada caso necesita plantilla localizada, caducidad, prioridad, frecuencia y evento de cancelación; un logro ya visto o una racha ya extendida cancela el aviso pendiente. Las notificaciones in-app usan el mismo centro de preferencias.

## Publicidad, premium y consentimiento (`FR-012`)

`AdsPort` decide elegibilidad/placement/frecuencia y el cliente implementa proveedor. Sin consentimiento aplicable: no personalizados o nada. Carga fallida colapsa espacio sin bloquear. Intersticial solo tras finalización y límites remotos; crucigrama nunca se interrumpe. `EntitlementPort` soporta `ad_free` aunque compras/premium sean Fase 2. Eventos no incluyen contenido de respuesta.

Premium Fase 2 añade archivo ampliado, estadísticas avanzadas, temas y retos extra sin modificar score/ranking. Compra se confirma exclusivamente mediante transacción verificada en servidor; restore es idempotente y los estados grace/paused/expired se reflejan sin perder datos. Rewarded ads solo desbloquean pista/archivo/estadística o segunda oportunidad casual y marcan el intento no competitivo cuando alteran la respuesta.

## Archivo, logros y capa social

Archivo MVP: siete fechas anteriores; cualquiera puede revisar soluciones publicadas y un usuario puede reanudar solo mientras la edición siga abierta. Jugar una edición cerrada es casual y no altera ranking/racha histórica. SEO histórico usa una URL canónica estable y solo indexa explicación/solución después del cierre.

El MVP muestra los dos logros cosméticos versionados en el perfil. Fase 2 añade catálogo editorial ampliado de logros, amigos por invitación/aceptación, bloqueo, ligas privadas y desafíos asíncronos. Privacidad por defecto: perfil no público, contactos no se suben sin opt-in, ranking de amigos solo para relaciones aceptadas y abandono/bloqueo surte efecto inmediato. Ligas tienen propietario, miembros, período y reglas inmutables durante competición. Los retos reutilizan una edición pública o semilla aprobada; nunca exponen solución al creador.

## SEO, ASO y crecimiento

Rutas públicas: `/`, `/juegos/{tipo}`, `/ediciones/{fecha}`, `/resultados/{fecha}/{tipo}` y páginas editoriales originales. Home/edición actual son SSR; contenido histórico cerrado puede ISR. Antes de cierre, la ruta de solución responde 423 autenticada/API y la página pública no existe o lleva `noindex`; después se genera una versión pública sanitizada. Sitemap incluye solo URLs canónicas publicables; robots excluye admin, API, intentos y previews. Open Graph/Share Cards nunca codifican respuestas.

PWA: manifest, iconos originales, display standalone, shortcuts a juegos y deep links. App/Universal Links abren la edición o resultado permitido y caen a web. ASO se entrega con nombre/subtítulo, descripción, screenshots accesibles, política de privacidad y keywords localizadas; no se hacen afirmaciones engañosas. Métricas orgánicas separan adquisición, activación y retorno.

## Administración y moderación (`FR-013`)

Backoffice en `/admin`: calendario, edición, reserva, cuestionario, preview de cuadrícula, fuentes/validaciones, aprobar/rechazar/editar/regenerar/reprogramar/publicar, bloqueos, flags, horarios, alertas y auditoría. Roles: superadmin total; editor contenido/publicación; moderador alias/bloqueos; analista lectura métricas; soporte cuenta limitada; read-only. Acciones peligrosas requieren motivo, reautenticación y confirmación; no borrado físico de auditoría.

El calendario avisa visiblemente cuando cualquiera de los dos tipos baja de 10 días de reserva. Una edición `approved` completa puede pasar a `scheduled` desde la sesión humana de editor/superadmin reautenticada o desde la credencial de recuperación; ambas vías comparten la misma transición idempotente y registran por separado actor humano o `emergency_admin`.

El registro de términos bloqueados normaliza NFD, diacríticos y caja de forma coherente con el validador de contenido. Alta/reactivación y desactivación exigen moderador/editor reautenticado, motivo e idempotencia; nunca se elimina el historial y cada cambio produce auditoría y outbox.

La edición manual nunca sobrescribe un candidato. Crea una versión nueva ligada al mismo job, marca la anterior como rechazada, repite esquema, términos bloqueados y deduplicación, y vuelve siempre a `pending_review`. Actor, motivo e identificador anterior quedan en auditoría y outbox; el contenido ya seleccionado no admite revisión.

## Generación (`FR-014`, `FR-016`)

Jobs: planificar 21 días, generar candidatos, validar, componer, seleccionar y rellenar reserva. JSON Schema estricto; normalización; longitud; bloqueo; duplicidad semántica; verificación de fuente/vigencia; clasificador sensible; evaluador independiente; score. Alto riesgo o discrepancia → revisión, nunca autopublicación. Circuit breaker por proveedor y tipo; reintentos exponenciales con jitter; presupuesto por lote; proveedor alternativo; banco de emergencia. Toda salida se trata como no confiable y se valida.

La primera barrera semántica es deliberadamente determinista y explicable: Jaccard sobre tokens españoles normalizados, mínimo de seis tokens, umbral 0,82 y comparación contra los 200 candidatos no rechazados más recientes del mismo tipo. El proveedor `fake` queda fuera para no invalidar fixtures locales; el hash exacto sigue aplicándose. El circuit breaker en memoria se separa por proveedor/tipo, abre tras tres fallos, admite una sonda al minuto y publica estado, aperturas, fallos, bloqueos y éxitos en el log estructurado; una implementación distribuida sigue siendo puerta de producción con múltiples workers.

Crucigrama separa `WordBankEntry` de `CrosswordGrid`. Constructor determinista por semilla con límite de tiempo y búsqueda acotada; exige conectividad, conflictos cero, numeración estable, densidad y unicidad según algoritmo verificador. Puede recomponer sin regenerar pistas. Preview SVG se genera en servidor desde datos, sin solución pública.

El banco léxico persiste palabra y forma normalizada, pista, categoría, dificultad 1–5, número de letras derivado, variantes, idioma, fuente HTTPS, fecha de comprobación, calidad y estado de validación. Solo las entradas activas, aprobadas, con calidad ≥70 y fuente revisada durante el último año alimentan el constructor. Alta/actualización y baja lógica exigen editor reautenticado, motivo e idempotencia, y producen auditoría y outbox.

## Errores y contingencias

Errores API usan Problem Details, código estable, correlation ID y mensaje seguro. Cliente conserva progreso ante 5xx/timeout. Kill switch por juego; edición fallback aprobada; publicación manual idempotente. Estados degradados se comunican sin culpar al usuario. Runbooks cubren falta de reserva, fallo de publicación, proveedor, corrupción/sync, pagos futuros y caída de anuncios.
