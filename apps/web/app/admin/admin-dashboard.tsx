"use client";

import { useEffect, useState, type SyntheticEvent } from "react";

interface Calendar {
  editions: Array<{ gameCount: number; id: string; localDate: string; status: string }>;
  reserve: {
    crossword: number;
    guess_word: number;
    quiz: number;
    true_false: number;
    word_search: number;
  };
}

interface Candidate {
  contentType: "crossword" | "quiz" | "true_false" | "guess_word" | "word_search";
  findings: Array<{ code?: string }>;
  id: string;
  privatePayload: Record<string, unknown>;
  publicPayload: Record<string, unknown>;
  sources: Array<{ itemId?: string; url?: string }>;
  status: "approved" | "pending_review" | "rejected" | "selected";
  targetDate: string;
}

interface BlockedTerm {
  active: boolean;
  id: string;
  normalizedTerm: string;
  reason: string;
}

interface WordBankEntry {
  active: boolean;
  answer: string;
  category: string;
  clue: string;
  difficulty: number;
  id: string;
  letterCount: number;
  qualityScore: number;
  sourceCheckedAt: string;
  sourceUrl: string;
  validationStatus: "approved" | "pending" | "rejected";
  variants: string[];
}

interface AnalyticsDashboard {
  daily: Array<{ activeSubjects: number; completions: number; localDate: string; starts: number }>;
  definitions: { activeSubjects: string; completionRate: string };
  freshness: string | null;
  owner: string;
  period: { days: number; from: string; to: string };
  totals: {
    activeSubjects: number;
    completionRate: number | null;
    completions: number;
    quarantinedBatches: number;
    registrations: number;
    shares: number;
    starts: number;
  };
}

interface AdminAuditRecord {
  action: string;
  actorId: string | null;
  actorType: string;
  correlationId: string;
  id: string;
  occurredAt: string;
  reason: string | null;
  targetId: string;
  targetType: string;
}

export function AdminDashboard() {
  const [calendar, setCalendar] = useState<Calendar>();
  const [content, setContent] = useState<Candidate[]>([]);
  const [message, setMessage] = useState("Cargando…");
  const [reason, setReason] = useState("");
  const [scheduleReason, setScheduleReason] = useState("");
  const [startDate, setStartDate] = useState("");
  const [days, setDays] = useState(7);
  const [pending, setPending] = useState(false);
  const [blockedTerms, setBlockedTerms] = useState<BlockedTerm[]>([]);
  const [blockedTerm, setBlockedTerm] = useState("");
  const [blockedReason, setBlockedReason] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const [publicJson, setPublicJson] = useState("");
  const [privateJson, setPrivateJson] = useState("");
  const [sourcesJson, setSourcesJson] = useState("");
  const [wordBank, setWordBank] = useState<WordBankEntry[]>([]);
  const [wordAnswer, setWordAnswer] = useState("");
  const [wordCategory, setWordCategory] = useState("General");
  const [wordClue, setWordClue] = useState("");
  const [wordDifficulty, setWordDifficulty] = useState(2);
  const [wordQuality, setWordQuality] = useState(90);
  const [wordSourceCheckedAt, setWordSourceCheckedAt] = useState("");
  const [wordSourceUrl, setWordSourceUrl] = useState("");
  const [wordVariants, setWordVariants] = useState("");
  const [wordReason, setWordReason] = useState("");
  const [analytics, setAnalytics] = useState<AnalyticsDashboard>();
  const [audit, setAudit] = useState<AdminAuditRecord[]>([]);

  async function refresh() {
    const [
      calendarResponse,
      contentResponse,
      blockedResponse,
      wordBankResponse,
      analyticsResponse,
      auditResponse,
    ] = await Promise.all([
      fetch("/api/admin/editions/calendar", { cache: "no-store" }),
      fetch("/api/admin/content", { cache: "no-store" }),
      fetch("/api/admin/blocked-terms", { cache: "no-store" }),
      fetch("/api/admin/word-bank", { cache: "no-store" }),
      fetch("/api/admin/analytics/dashboard?days=7", { cache: "no-store" }),
      fetch("/api/admin/audit?limit=25", { cache: "no-store" }),
    ]);
    if (
      !calendarResponse.ok ||
      !contentResponse.ok ||
      !blockedResponse.ok ||
      !wordBankResponse.ok ||
      !analyticsResponse.ok
    ) {
      setMessage(
        calendarResponse.status === 401 || calendarResponse.status === 403
          ? "Esta cuenta no tiene permisos de backoffice."
          : "No se pudo cargar el backoffice.",
      );
      return;
    }
    const nextCalendar: unknown = await calendarResponse.json();
    const nextContent: unknown = await contentResponse.json();
    const nextBlockedTerms: unknown = await blockedResponse.json();
    const nextWordBank: unknown = await wordBankResponse.json();
    const nextAnalytics: unknown = await analyticsResponse.json();
    const nextAudit: unknown = auditResponse.ok ? await auditResponse.json() : [];
    if (
      !isCalendar(nextCalendar) ||
      !Array.isArray(nextContent) ||
      !isAnalyticsDashboard(nextAnalytics)
    ) {
      setMessage("La API devolvió datos inesperados.");
      return;
    }
    setCalendar(nextCalendar);
    setContent(nextContent.filter(isCandidate));
    setBlockedTerms(Array.isArray(nextBlockedTerms) ? nextBlockedTerms.filter(isBlockedTerm) : []);
    setWordBank(Array.isArray(nextWordBank) ? nextWordBank.filter(isWordBankEntry) : []);
    setAnalytics(nextAnalytics);
    setAudit(Array.isArray(nextAudit) ? nextAudit.filter(isAdminAuditRecord) : []);
    setMessage("");
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function plan(event: SyntheticEvent) {
    event.preventDefault();
    setPending(true);
    const response = await fetch("/api/admin/content/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budgetMicros: 0, days, startDate }),
    });
    if (response.ok) {
      await refresh();
      setMessage("Plan de generación guardado.");
    } else {
      setMessage(
        response.status === 403
          ? "Necesitas rol editor y reautenticación reciente."
          : "No se pudo guardar el plan.",
      );
    }
    setPending(false);
  }

  async function scheduleEdition(edition: Calendar["editions"][number]) {
    if (scheduleReason.trim().length < 10) {
      setMessage("Escribe un motivo de programación de al menos 10 caracteres.");
      return;
    }
    setPending(true);
    const response = await fetch(`/api/admin/editions/${edition.id}/schedule`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: scheduleReason.trim() }),
    });
    if (response.ok) {
      setScheduleReason("");
      await refresh();
      setMessage("Edición programada y auditada.");
    } else {
      setMessage(
        response.status === 403
          ? "Necesitas rol editor y reautenticación reciente."
          : "No se pudo programar la edición.",
      );
    }
    setPending(false);
  }

  async function decide(candidate: Candidate, decision: "approve" | "regenerate" | "reject") {
    if (reason.trim().length < 10) {
      setMessage("Escribe un motivo de al menos 10 caracteres.");
      return;
    }
    setPending(true);
    const response = await fetch(`/api/admin/content/${candidate.id}/${decision}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() }),
    });
    if (response.ok) {
      setReason("");
      await refresh();
      setMessage(decision === "regenerate" ? "Regeneración en cola." : "Decisión auditada.");
    } else {
      setMessage(
        response.status === 403
          ? "Necesitas rol editor y reautenticación reciente."
          : "No se pudo aplicar la decisión.",
      );
    }
    setPending(false);
  }

  function beginEdit(candidate: Candidate) {
    setEditingId(candidate.id);
    setPublicJson(JSON.stringify(candidate.publicPayload, null, 2));
    setPrivateJson(JSON.stringify(candidate.privatePayload, null, 2));
    setSourcesJson(JSON.stringify(candidate.sources, null, 2));
  }

  async function saveEdit(event: SyntheticEvent) {
    event.preventDefault();
    if (!editingId || reason.trim().length < 10) {
      setMessage("Escribe un motivo de al menos 10 caracteres.");
      return;
    }
    let publicPayload: unknown;
    let privatePayload: unknown;
    let sources: unknown;
    try {
      publicPayload = JSON.parse(publicJson) as unknown;
      privatePayload = JSON.parse(privateJson) as unknown;
      sources = JSON.parse(sourcesJson) as unknown;
    } catch {
      setMessage("Los tres campos deben contener JSON válido.");
      return;
    }
    if (!isRecord(publicPayload) || !isRecord(privatePayload) || !isRecordArray(sources)) {
      setMessage("Los payloads deben ser objetos y las fuentes una lista de objetos.");
      return;
    }
    setPending(true);
    const response = await fetch(`/api/admin/content/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ privatePayload, publicPayload, reason: reason.trim(), sources }),
    });
    if (response.ok) {
      setEditingId(undefined);
      setReason("");
      await refresh();
      setMessage("Revisión guardada y validada.");
    } else {
      setMessage(
        response.status === 403
          ? "Necesitas rol editor y reautenticación reciente."
          : "La revisión no superó la validación.",
      );
    }
    setPending(false);
  }

  async function addBlockedTerm(event: SyntheticEvent) {
    event.preventDefault();
    setPending(true);
    const response = await fetch("/api/admin/blocked-terms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: blockedReason.trim(), term: blockedTerm.trim() }),
    });
    if (response.ok) {
      setBlockedTerm("");
      setBlockedReason("");
      await refresh();
      setMessage("Término bloqueado y auditado.");
    } else {
      setMessage(
        response.status === 403
          ? "Necesitas rol moderador y reautenticación reciente."
          : "No se pudo bloquear el término.",
      );
    }
    setPending(false);
  }

  async function deactivate(term: BlockedTerm) {
    if (blockedReason.trim().length < 10) {
      setMessage("Escribe un motivo de moderación de al menos 10 caracteres.");
      return;
    }
    setPending(true);
    const response = await fetch(`/api/admin/blocked-terms/${term.id}/deactivate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: blockedReason.trim() }),
    });
    if (response.ok) {
      setBlockedReason("");
      await refresh();
      setMessage("Término desbloqueado y auditado.");
    } else {
      setMessage("No se pudo desbloquear el término.");
    }
    setPending(false);
  }

  async function curateWord(event: SyntheticEvent) {
    event.preventDefault();
    setPending(true);
    const response = await fetch("/api/admin/word-bank", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        answer: wordAnswer.trim(),
        category: wordCategory.trim(),
        clue: wordClue.trim(),
        difficulty: wordDifficulty,
        qualityScore: wordQuality,
        reason: wordReason.trim(),
        sourceCheckedAt: `${wordSourceCheckedAt}T00:00:00.000Z`,
        sourceUrl: wordSourceUrl.trim(),
        validationStatus: "approved",
        variants: wordVariants
          .split(",")
          .map((variant) => variant.trim())
          .filter(Boolean),
      }),
    });
    if (response.ok) {
      setWordAnswer("");
      setWordClue("");
      setWordSourceUrl("");
      setWordVariants("");
      setWordReason("");
      await refresh();
      setMessage("Entrada lexica validada y auditada.");
    } else {
      setMessage(
        response.status === 403
          ? "Necesitas rol editor y reautenticaciÃ³n reciente."
          : "No se pudo validar la entrada lexica.",
      );
    }
    setPending(false);
  }

  async function deactivateWord(entry: WordBankEntry) {
    if (wordReason.trim().length < 10) {
      setMessage("Escribe un motivo editorial de al menos 10 caracteres.");
      return;
    }
    setPending(true);
    const response = await fetch(`/api/admin/word-bank/${entry.id}/deactivate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: wordReason.trim() }),
    });
    if (response.ok) {
      setWordReason("");
      await refresh();
      setMessage("Entrada lexica desactivada y auditada.");
    } else {
      setMessage("No se pudo desactivar la entrada lexica.");
    }
    setPending(false);
  }

  return (
    <section className="admin-dashboard">
      {message ? <p aria-live="polite">{message}</p> : null}
      {calendar ? (
        <>
          <p>
            Reserva aprobada: <strong>{calendar.reserve.quiz}</strong> quiz ·{" "}
            <strong>{calendar.reserve.crossword}</strong> crucigramas ·{" "}
            <strong>{calendar.reserve.true_false}</strong> verdadero/falso ·{" "}
            <strong>{calendar.reserve.guess_word}</strong> palabras ·{" "}
            <strong>{calendar.reserve.word_search}</strong> sopas
          </p>
          {Object.values(calendar.reserve).some((value) => value < 10) ? (
            <p role="alert">
              Reserva baja: se requieren al menos 10 días por tipo antes de producción.
            </p>
          ) : null}
          {analytics ? (
            <section aria-labelledby="analytics-title">
              <h2 id="analytics-title">Métricas de producto</h2>
              <p>
                {analytics.period.from}–{analytics.period.to} · responsable {analytics.owner} ·
                frescura {analytics.freshness ?? "sin eventos"}
              </p>
              <ul className="admin-calendar">
                <li>Activos: {analytics.totals.activeSubjects}</li>
                <li>Inicios: {analytics.totals.starts}</li>
                <li>Finalizaciones: {analytics.totals.completions}</li>
                <li>Lotes en cuarentena: {analytics.totals.quarantinedBatches}</li>
                <li>
                  Tasa de finalización: {analytics.totals.completionRate ?? "sin base"}
                  {analytics.totals.completionRate === null ? "" : "%"}
                </li>
                <li>Compartidos: {analytics.totals.shares}</li>
                <li>Registros: {analytics.totals.registrations}</li>
              </ul>
              <details>
                <summary>Definiciones</summary>
                <p>{analytics.definitions.activeSubjects}</p>
                <p>{analytics.definitions.completionRate}</p>
              </details>
            </section>
          ) : null}
          {audit.length ? (
            <section aria-labelledby="audit-title">
              <h2 id="audit-title">Auditoría reciente</h2>
              <ul className="admin-calendar">
                {audit.map((record) => (
                  <li key={record.id}>
                    {record.occurredAt} · {record.actorType}
                    {record.actorId ? `:${record.actorId}` : ""} · {record.action} ·{" "}
                    {record.targetType}:{record.targetId} · {record.reason ?? "sin motivo"}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <form className="admin-plan" onSubmit={plan}>
            <label>
              Primera fecha
              <input
                onChange={(event) => setStartDate(event.target.value)}
                required
                type="date"
                value={startDate}
              />
            </label>
            <label>
              Días (máximo 21)
              <input
                max={21}
                min={1}
                onChange={(event) => setDays(Number(event.target.value))}
                type="number"
                value={days}
              />
            </label>
            <button disabled={pending} type="submit">
              Planificar generación
            </button>
          </form>
          <h2>Calendario</h2>
          <label>
            Motivo de programación
            <input
              maxLength={500}
              minLength={10}
              onChange={(event) => setScheduleReason(event.target.value)}
              value={scheduleReason}
            />
          </label>
          <ul className="admin-calendar">
            {calendar.editions.map((edition) => (
              <li key={edition.id}>
                {edition.localDate} · {edition.status} · {edition.gameCount}/5 juegos
                {edition.status === "approved" ? (
                  <button
                    disabled={pending}
                    onClick={() => void scheduleEdition(edition)}
                    type="button"
                  >
                    Programar {edition.localDate}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <h2>Términos bloqueados</h2>
          <form className="admin-plan" onSubmit={addBlockedTerm}>
            <label>
              Término
              <input
                maxLength={80}
                minLength={2}
                onChange={(event) => setBlockedTerm(event.target.value)}
                required
                value={blockedTerm}
              />
            </label>
            <label>
              Motivo de moderación
              <input
                maxLength={500}
                minLength={10}
                onChange={(event) => setBlockedReason(event.target.value)}
                required
                value={blockedReason}
              />
            </label>
            <button disabled={pending} type="submit">
              Bloquear término
            </button>
          </form>
          <ul className="admin-calendar">
            {blockedTerms.map((term) => (
              <li key={term.id}>
                {term.normalizedTerm} · {term.active ? "activo" : "inactivo"} · {term.reason}
                {term.active ? (
                  <button disabled={pending} onClick={() => void deactivate(term)} type="button">
                    Desactivar
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
          <h2>Banco de palabras</h2>
          <form className="admin-plan" onSubmit={curateWord}>
            <label>
              Palabra
              <input
                maxLength={21}
                minLength={2}
                onChange={(event) => setWordAnswer(event.target.value)}
                required
                value={wordAnswer}
              />
            </label>
            <label>
              Pista
              <input
                maxLength={240}
                minLength={3}
                onChange={(event) => setWordClue(event.target.value)}
                required
                value={wordClue}
              />
            </label>
            <label>
              Categoria
              <input
                maxLength={80}
                minLength={2}
                onChange={(event) => setWordCategory(event.target.value)}
                required
                value={wordCategory}
              />
            </label>
            <label>
              Dificultad (1-5)
              <input
                max={5}
                min={1}
                onChange={(event) => setWordDifficulty(Number(event.target.value))}
                required
                type="number"
                value={wordDifficulty}
              />
            </label>
            <label>
              Calidad (0-100)
              <input
                max={100}
                min={0}
                onChange={(event) => setWordQuality(Number(event.target.value))}
                required
                type="number"
                value={wordQuality}
              />
            </label>
            <label>
              Fuente HTTPS
              <input
                onChange={(event) => setWordSourceUrl(event.target.value)}
                required
                type="url"
                value={wordSourceUrl}
              />
            </label>
            <label>
              Fuente comprobada el
              <input
                onChange={(event) => setWordSourceCheckedAt(event.target.value)}
                required
                type="date"
                value={wordSourceCheckedAt}
              />
            </label>
            <label>
              Variantes (separadas por comas)
              <input
                onChange={(event) => setWordVariants(event.target.value)}
                value={wordVariants}
              />
            </label>
            <label>
              Motivo editorial
              <input
                maxLength={500}
                minLength={10}
                onChange={(event) => setWordReason(event.target.value)}
                required
                value={wordReason}
              />
            </label>
            <button disabled={pending} type="submit">
              Validar entrada
            </button>
          </form>
          <ul className="admin-calendar">
            {wordBank.map((entry) => (
              <li key={entry.id}>
                {entry.answer} ({entry.letterCount}) - {entry.category} - dificultad{" "}
                {entry.difficulty}
                {" - "}
                <a href={entry.sourceUrl} rel="noreferrer" target="_blank">
                  fuente
                </a>
                <button disabled={pending} onClick={() => void deactivateWord(entry)} type="button">
                  Desactivar entrada
                </button>
              </li>
            ))}
          </ul>
          <h2>Contenido</h2>
          <label>
            Motivo para la próxima decisión
            <textarea
              maxLength={500}
              minLength={10}
              onChange={(event) => setReason(event.target.value)}
              value={reason}
            />
          </label>
          <div className="admin-content-list">
            {content.map((candidate) => (
              <article className="admin-content-card" key={candidate.id}>
                <h3>{previewTitle(candidate)}</h3>
                <p>
                  {candidate.targetDate} · {candidate.contentType} · {candidate.status}
                </p>
                {candidate.findings.length ? (
                  <p>Validaciones: {candidate.findings.map(({ code }) => code).join(", ")}</p>
                ) : (
                  <p>Validación determinista superada.</p>
                )}
                <details>
                  <summary>Preview y solución privada</summary>
                  {candidate.contentType === "crossword" ? (
                    <img
                      alt={`Cuadrícula de ${previewTitle(candidate)}`}
                      className="admin-crossword-preview"
                      src={`/api/admin/content/${candidate.id}/preview.svg`}
                    />
                  ) : null}
                  <pre>{JSON.stringify(candidate.publicPayload, null, 2)}</pre>
                  <pre>{JSON.stringify(candidate.privatePayload, null, 2)}</pre>
                  <ul>
                    {candidate.sources.map((source, index) => (
                      <li key={`${source.itemId ?? "source"}-${index}`}>
                        {safeSourceUrl(source.url) ? (
                          <a href={safeSourceUrl(source.url)!} rel="noreferrer" target="_blank">
                            Fuente HTTPS
                          </a>
                        ) : (
                          "Fuente inválida"
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
                {candidate.status !== "selected" ? (
                  <>
                    <div className="account-actions">
                      {candidate.status === "pending_review" ? (
                        <button
                          disabled={pending}
                          onClick={() => void decide(candidate, "approve")}
                        >
                          Aprobar
                        </button>
                      ) : null}
                      {candidate.status !== "rejected" ? (
                        <button disabled={pending} onClick={() => void decide(candidate, "reject")}>
                          Rechazar
                        </button>
                      ) : null}
                      <button disabled={pending} onClick={() => beginEdit(candidate)} type="button">
                        Editar JSON
                      </button>
                      <button
                        disabled={pending}
                        onClick={() => void decide(candidate, "regenerate")}
                      >
                        Regenerar
                      </button>
                    </div>
                    {editingId === candidate.id ? (
                      <form className="admin-plan" onSubmit={saveEdit}>
                        <label>
                          Contenido público JSON
                          <textarea
                            onChange={(event) => setPublicJson(event.target.value)}
                            required
                            value={publicJson}
                          />
                        </label>
                        <label>
                          Solución privada JSON
                          <textarea
                            onChange={(event) => setPrivateJson(event.target.value)}
                            required
                            value={privateJson}
                          />
                        </label>
                        <label>
                          Fuentes JSON
                          <textarea
                            onChange={(event) => setSourcesJson(event.target.value)}
                            required
                            value={sourcesJson}
                          />
                        </label>
                        <div className="account-actions">
                          <button disabled={pending}>Guardar revisión</button>
                          <button
                            disabled={pending}
                            onClick={() => setEditingId(undefined)}
                            type="button"
                          >
                            Cancelar
                          </button>
                        </div>
                      </form>
                    ) : null}
                  </>
                ) : null}
              </article>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

function previewTitle(candidate: Candidate): string {
  return typeof candidate.publicPayload.title === "string"
    ? candidate.publicPayload.title
    : "Contenido sin título";
}

function isRecordArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.every(isRecord);
}

function isCalendar(value: unknown): value is Calendar {
  return (
    isRecord(value) &&
    Array.isArray(value.editions) &&
    isRecord(value.reserve) &&
    typeof value.reserve.quiz === "number" &&
    typeof value.reserve.crossword === "number" &&
    typeof value.reserve.true_false === "number" &&
    typeof value.reserve.guess_word === "number" &&
    typeof value.reserve.word_search === "number"
  );
}

function isCandidate(value: unknown): value is Candidate {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    ["quiz", "crossword", "true_false", "guess_word", "word_search"].includes(
      String(value.contentType),
    ) &&
    typeof value.targetDate === "string" &&
    ["approved", "pending_review", "rejected", "selected"].includes(String(value.status)) &&
    isRecord(value.publicPayload) &&
    isRecord(value.privatePayload) &&
    Array.isArray(value.sources) &&
    value.sources.every(isRecord) &&
    Array.isArray(value.findings) &&
    value.findings.every(isRecord)
  );
}

function isBlockedTerm(value: unknown): value is BlockedTerm {
  return (
    isRecord(value) &&
    typeof value.active === "boolean" &&
    typeof value.id === "string" &&
    typeof value.normalizedTerm === "string" &&
    typeof value.reason === "string"
  );
}

function isWordBankEntry(value: unknown): value is WordBankEntry {
  return (
    isRecord(value) &&
    typeof value.active === "boolean" &&
    typeof value.answer === "string" &&
    typeof value.category === "string" &&
    typeof value.clue === "string" &&
    typeof value.difficulty === "number" &&
    typeof value.id === "string" &&
    typeof value.letterCount === "number" &&
    typeof value.qualityScore === "number" &&
    typeof value.sourceCheckedAt === "string" &&
    typeof value.sourceUrl === "string" &&
    ["approved", "pending", "rejected"].includes(String(value.validationStatus)) &&
    Array.isArray(value.variants) &&
    value.variants.every((variant) => typeof variant === "string")
  );
}

function isAnalyticsDashboard(value: unknown): value is AnalyticsDashboard {
  return (
    isRecord(value) &&
    isRecord(value.period) &&
    typeof value.period.days === "number" &&
    typeof value.period.from === "string" &&
    typeof value.period.to === "string" &&
    isRecord(value.totals) &&
    typeof value.totals.activeSubjects === "number" &&
    typeof value.totals.starts === "number" &&
    typeof value.totals.completions === "number" &&
    typeof value.totals.quarantinedBatches === "number" &&
    (typeof value.totals.completionRate === "number" || value.totals.completionRate === null) &&
    typeof value.totals.shares === "number" &&
    typeof value.totals.registrations === "number" &&
    isRecord(value.definitions) &&
    typeof value.definitions.activeSubjects === "string" &&
    typeof value.definitions.completionRate === "string" &&
    (typeof value.freshness === "string" || value.freshness === null) &&
    typeof value.owner === "string" &&
    Array.isArray(value.daily)
  );
}

function isAdminAuditRecord(value: unknown): value is AdminAuditRecord {
  return (
    isRecord(value) &&
    typeof value.action === "string" &&
    (typeof value.actorId === "string" || value.actorId === null) &&
    typeof value.actorType === "string" &&
    typeof value.correlationId === "string" &&
    typeof value.id === "string" &&
    typeof value.occurredAt === "string" &&
    (typeof value.reason === "string" || value.reason === null) &&
    typeof value.targetId === "string" &&
    typeof value.targetType === "string"
  );
}

function safeSourceUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
