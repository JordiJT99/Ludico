# Plan de analítica y experimentación

Estado: `APPROVED` · Owner: Product/Data

## Principios y esquema común

Se instrumenta después de definir evento. No se envían respuestas, pistas privadas, email, nombre, texto libre, advertising ID sin base legal ni IDs cruzables innecesarios. Eventos first-party seudónimos; destinos de marketing se filtran por consentimiento.

Campos obligatorios comunes: `eventId:string(uuid)`, `eventName:string`, `schemaVersion:int`, `occurredAt:datetime`, `receivedAt:datetime(server)`, `environment:enum`, `platform:enum(web,android,ios)`, `appVersion:string`, `locale:string`, `sessionId:string`, `subjectId:string pseudonymous`, `subjectType:guest|user`, `consentSnapshotId?:string`. Contexto opcional allowlist: `editionId`, `gameId`, `gameType`, `attemptId`, `experimentAssignments`. Ejemplo: `{"eventName":"GameCompleted","schemaVersion":1,"eventId":"01...","occurredAt":"...","environment":"production","platform":"web","appVersion":"1.0.0","locale":"es-ES","sessionId":"01...","subjectId":"p_...","subjectType":"guest","gameType":"quiz","durationBucket":"5-10m","competitive":true}`.

## Catálogo MVP

### Collector v1 implementado

La primera allowlist ejecutable admite `AppOpened`, `DailyEditionViewed`, `GameStarted`, `GameCompleted`, `ResultViewed`, `ShareCompleted`, `RegistrationCompleted` y `LoginCompleted`. Cada nombre tiene claves propias cerradas; por ejemplo, `AppOpened` solo acepta `source`, `connectivity` y `platform`. Los valores son booleano, número o string de hasta 64 caracteres; se rechazan propiedades desconocidas, texto libre, eventos a más de 5 minutos en el futuro o 30 días en el pasado. El servidor fija sujeto, recepción y snapshot de política, y deduplica por `eventId`.

Los ocho eventos de la allowlist están conectados en web y mobile: apertura, edición vista, inicio/finalización, resultado, compartir, registro y login. Si el consentimiento aún se está leyendo, el cliente mantiene una cola efímera en memoria; la descarta ante rechazo y la envía ante opt-in. `AppOpened` se limita a una vez por pestaña web o proceso mobile. Los eventos de juego incluyen solo UUID técnicos para deduplicación posterior, tipo, buckets, ayudas y contexto; nunca respuestas, solución, email, alias ni texto libre.

| Eventos | Propiedades específicas obligatorias | Finalidad/base |
|---|---|---|
| AppOpened, SessionStarted | source, connectivity | operación/producto; consentimiento según destino |
| DailyEditionViewed | localDate, availability | producto |
| GameStarted | gameType, entryPoint, offline | producto |
| QuestionAnswered | questionPosition, changed, responseTimeBucket | producto; **sin opción/respuesta** |
| ProgressSaved | local/remote, eventCount, latencyBucket, outcome | operación |
| HintUsed | hintType, makesCasual | producto |
| GameCompleted | scoreBucket, durationBucket, competitive, aidsCount | producto |
| GameAbandoned | progressBucket, reason | producto |
| ResultViewed, PreviousSolutionViewed | gameType, daysAgo | producto |
| ShareStarted, ShareCompleted | channelCategory, result | producto |
| RegistrationStarted, RegistrationCompleted, LoginCompleted | method, entryPoint, outcome | producto/seguridad; sin email |
| NotificationPermissionRequested, NotificationOpened | channel, useCase, decision | producto/consentimiento |
| AdRequested, AdLoaded, AdDisplayed, AdClicked, RewardedAdCompleted | provider, placement, format, consentMode, latencyBucket | monetización; click server-side cuando posible |
| StreakExtended, StreakLost, AchievementUnlocked | streakBucket/achievementKey | producto |

Eventos Fase 2 ya nombrados pero no instrumentados hasta función real: `SubscriptionViewed/Started/Cancelled`, `FriendInvited`, `LeagueCreated`. Todos los nombres son estables en PascalCase y cambios de propiedades incompatibles incrementan `schemaVersion`.

## Métricas

- DAU/WAU/MAU: sujetos seudónimos únicos con `AppOpened`; ratio DAU/MAU.
- Retención D1/D7/D30: cohorte por primer GameCompleted y retorno con GameCompleted.
- Inicio/finalización: GameCompleted / GameStarted deduplicados por intento.
- Revisión siguiente: usuarios con PreviousSolutionViewed día +1 / completadores día 0.
- ARPDAU: ingresos atribuidos / DAU; fill = loaded/requested; impresiones/sesión; eCPM.
- Calidad contenido: aprobados/rechazados, causa, coste IA por contenido publicado y días de reserva.
- Operación: publication delay, sync failure, crash-free sessions, SLOs.

El dashboard first-party de backoffice ofrece una ventana configurable de 1–30 días, serie diaria Madrid y totales de sujetos activos, inicios/finalizaciones deduplicados por intento, tasa, compartidos, registros y lotes puestos en cuarentena. Devuelve solo agregados, definición, owner, freshness y fecha de generación; nunca sujetos ni `attemptId`. Las métricas financieras futuras se reconciliarán con proveedor; el cliente no será fuente contable.

## Experimentos

Asignación determinista servidor por sujeto estable, sticky y registrada antes de exposición. Plantilla obligatoria: hipótesis, población/exclusiones, variante/control, métrica primaria, guardrails, MDE/potencia, duración mínima, criterio de decisión y owner. No mirar/terminar repetidamente sin método estadístico fijado. Exclusiones: menores si aplicara, admin/test, usuarios sin consentimiento para destino requerido.

Primeros candidatos, no activos: momento de invitación a registro, diseño de resultado, recordatorio de revisión. Anuncios solo tras baseline de retención; guardrails finalización, D7, CLS, errores y clic accidental. Feature flag no equivale a experimento: kill switches no asignan ni miden variantes.

## Calidad, privacidad y retención

Validador cliente y servidor, contrato en CI, descarte en el borde de envelopes desconocidos y cuarentena de metadatos para lotes semánticamente inválidos, deduplicación por eventId y monitor de volumen/frescura. Retención raw 13 meses baseline, reducción a agregados anónimos. Solicitud de borrado elimina vínculo del sujeto y propaga a destinos. Debug logs no contienen payload analítico completo en producción.

La tabla first-party ya aplica schema, dedupe y consentimiento. Si un lote que superó el envelope contractual incumple ventana o allowlist, toda la inserción revierte y se registra una sola fila de cuarentena con tipo de sujeto, número de eventos, motivo, fecha y SHA-256 de una forma sanitizada; nunca payload, valores ni ID de sujeto. Esa cuarentena expira a los 30 días. El worker ejecuta cada día una retención auditable: purga raw con más de 13 meses, cuarentena con más de 30 días, idempotencias vencidas, entregas push terminales de más de 90 días y outbox publicado de más de 30, sin eliminar auditoría ni consentimientos. El dashboard agregado está disponible con RBAC y `private,no-store`. El borrado verificado en destinos/backups permanece como puerta operativa antes de producción.
