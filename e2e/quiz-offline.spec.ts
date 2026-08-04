import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const apiBaseUrl = "http://127.0.0.1:4100";
const historicalEditionDate = madridDateOffset(-1);

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${apiBaseUrl}/__e2e/reset`)).ok()).toBe(true);
});

test("el consentimiento bloquea analítica hasta el opt-in y permite retirarlo", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Tu privacidad" })).toBeVisible();
  await expectAnalyticsCount(request, 0);

  await page.getByRole("button", { name: "Solo necesarias" }).click();
  await expect(page.getByText("Preferencias de privacidad guardadas.")).toBeVisible();
  await expectAnalyticsCount(request, 0);

  await page.getByRole("button", { name: "Privacidad" }).click();
  await page.getByLabel("Analítica de uso sin respuestas ni texto libre").check();
  await page.getByRole("button", { name: "Guardar selección" }).click();
  await expectAnalyticsCount(request, 1);
  const optedIn = (await (await request.get(`${apiBaseUrl}/__e2e/state`)).json()) as {
    analyticsEvents: Array<{ eventName: string; properties: Record<string, unknown> }>;
  };
  expect(optedIn.analyticsEvents[0]).toMatchObject({
    eventName: "AppOpened",
    properties: { platform: "web" },
  });
  expect(JSON.stringify(optedIn.analyticsEvents)).not.toMatch(/answer|solution|respuesta/i);

  await page.getByRole("button", { name: "Privacidad" }).click();
  await page.getByLabel("Analítica de uso sin respuestas ni texto libre").uncheck();
  await page.getByRole("button", { name: "Guardar selección" }).click();
  const accepted = await page.evaluate(async () => {
    const response = await fetch("/api/player/analytics/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        events: [
          {
            eventId: crypto.randomUUID(),
            eventName: "AppOpened",
            occurredAt: new Date().toISOString(),
            properties: { platform: "web" },
            schemaVersion: 1,
          },
        ],
      }),
    });
    return (await response.json()) as { accepted: number };
  });
  expect(accepted).toEqual({ accepted: 0 });
  await expectAnalyticsCount(request, 1);
});

test("el quiz conserva y sincroniza el progreso sin filtrar soluciones", async ({
  context,
  page,
  request,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (value: ShareData) =>
        sessionStorage.setItem("shared-result", JSON.stringify(value)),
    });
  });
  await page.goto("/");
  await page.getByLabel("Analítica de uso sin respuestas ni texto libre").check();
  await page.getByRole("button", { name: "Guardar selección" }).click();
  await expectAnalyticsCount(request, 1);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Un rato para pensar, cada día." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Soluciones de ayer" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Ver el archivo de los últimos siete días" }),
  ).toBeVisible();
  await expectBasicAccessibility(page);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  const homeResponse = await page.request.get("/");
  expect(homeResponse.headers()["x-content-type-options"]).toBe("nosniff");
  expect(homeResponse.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  const robots = await (await page.request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /admin");
  expect(robots).toContain("Sitemap:");
  const sitemap = await (await page.request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/juegos/quiz");
  expect(sitemap).toContain("/archivo");
  expect(sitemap).not.toContain("/admin");
  const archive = await (await page.request.get("/archivo")).text();
  expect(archive).toContain("Archivo de retos");
  expect(archive).toContain(`/ediciones/${historicalEditionDate}`);
  const historicalEdition = await (
    await page.request.get(`/ediciones/${historicalEditionDate}`)
  ).text();
  expect(historicalEdition).toContain("Ver solución");
  const csrf = await page.request.post("/api/guest-session", {
    data: {},
    headers: { Origin: "https://evil.example" },
  });
  expect(csrf.status()).toBe(403);

  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({
    display: "standalone",
    lang: "es-ES",
    name: "Lúdico · Retos diarios",
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192" }),
      expect.objectContaining({ sizes: "512x512" }),
    ]),
  );
  expect(manifest.shortcuts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ url: "/juegos/quiz" }),
      expect.objectContaining({ url: "/juegos/crucigrama" }),
    ]),
  );

  const quizCard = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Quiz diario", exact: true }),
  });
  await quizCard.getByRole("link", { name: "Jugar", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Pregunta de prueba 1" })).toBeVisible();
  await expect(page.getByRole("radio")).toHaveCount(4);

  const firstOption = page.getByRole("radio", { name: "Opción 1", exact: true });
  await firstOption.focus();
  await page.keyboard.press("Space");
  await expect(firstOption).toBeChecked();
  await expect(page.getByRole("button", { name: "Siguiente" })).toBeEnabled();
  await expectAnswerCount(request, 1);

  const firstTapTarget = await page
    .getByText("Opción 1", { exact: true })
    .locator("..")
    .boundingBox();
  expect(firstTapTarget?.height).toBeGreaterThanOrEqual(44);

  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByRole("heading", { name: "Pregunta de prueba 2" })).toBeVisible();

  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Pregunta de prueba 2" })).toBeVisible();
  await expect.poll(() => page.evaluate(pageIsCached)).toBe(true);
  await expect.poll(() => page.evaluate(staticAssetsAreCached)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Pregunta de prueba 2" })).toBeVisible();
  await page.getByRole("radio", { name: "Opción 2", exact: true }).check();
  await expect(page.getByText("Sin conexión · pendiente de sincronizar")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("button", { name: "Sincronizar" })).toBeVisible();

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expectAnswerCount(request, 2);
  await expect(page.getByText("Progreso guardado", { exact: true })).toBeVisible();

  for (let question = 3; question <= 5; question += 1) {
    await page.getByRole("button", { name: "Siguiente" }).click();
    await expect(
      page.getByRole("heading", { name: `Pregunta de prueba ${question}` }),
    ).toBeVisible();
    await page.getByRole("radio", { name: "Opción 1", exact: true }).check();
    await expectAnswerCount(request, question);
  }

  await page.getByRole("button", { name: "Enviar quiz" }).click();
  await expect(page.getByRole("heading", { name: "800 puntos" })).toBeVisible();
  await expect(page.getByText(/Tu puesto: 2 de 2/)).toBeVisible();
  await expect(page.getByText(/Ana.*900 puntos/)).toBeVisible();
  await page.getByRole("button", { name: "Compartir resultado" }).click();
  await expect(page.getByText("Resultado compartido.")).toBeVisible();
  const shared = await page.evaluate(() => sessionStorage.getItem("shared-result") ?? "");
  expect(shared).toContain("800 puntos");
  expect(shared).not.toMatch(/correctOptionId|answer|solution|respuesta|correcta/i);
  await expect
    .poll(async () => {
      const state = (await (await request.get(`${apiBaseUrl}/__e2e/state`)).json()) as {
        analyticsEvents: Array<{ eventName: string }>;
      };
      return new Set(state.analyticsEvents.map(({ eventName }) => eventName));
    })
    .toEqual(
      new Set([
        "AppOpened",
        "DailyEditionViewed",
        "GameStarted",
        "GameCompleted",
        "ShareCompleted",
      ]),
    );
  await expect(
    page.getByText("Las soluciones estarán disponibles al cerrar la edición."),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("correctOptionId");
  await page.getByRole("link", { name: "Ver revisión al cierre" }).click();
  await expect(page.getByRole("heading", { name: "La solución aún está cerrada" })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator("body")).not.toContainText("correctOptionId");
});

test("el crucigrama funciona offline, conserva pulsaciones lentas y coordina sus vistas", async ({
  context,
  page,
  request,
}) => {
  let delayNextProgress = false;
  await page.route("**/api/player/attempts/*/progress", async (route) => {
    if (delayNextProgress) {
      delayNextProgress = false;
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    await route.continue();
  });
  await page.goto("/");
  const crosswordCard = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Crucigrama diario", exact: true }),
  });
  await crosswordCard.getByRole("link", { name: "Jugar", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Astro que ilumina el día" })).toBeVisible();
  await expect(page.getByRole("gridcell")).toHaveCount(7);
  const firstCellBox = await page.getByRole("gridcell").first().boundingBox();
  expect(firstCellBox?.height).toBeGreaterThanOrEqual(44);
  expect(firstCellBox?.width).toBeGreaterThanOrEqual(44);

  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Astro que ilumina el día" })).toBeVisible();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Astro que ilumina el día" })).toBeVisible();
  let activeCell = page.locator('[role="gridcell"][aria-selected="true"]');
  await activeCell.press("S");
  await expect(page.getByText("Sin conexión · pendiente de sincronizar")).toBeVisible({
    timeout: 10_000,
  });
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expectCrosswordCellCount(request, 1);
  await expect(page.getByText("Progreso guardado", { exact: true })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Revelar letra · partida casual" }).click();
  await expect(page.getByText(/Este intento ya es casual/)).toBeVisible();
  await expectCrosswordCellCount(request, 2);

  await expect(activeCell).toHaveCount(1);
  await activeCell.press("ArrowRight");
  activeCell = page.locator('[role="gridcell"][aria-selected="true"]');
  await activeCell.press("L");
  await expectCrosswordCellCount(request, 3);

  await page.getByRole("gridcell", { name: /Fila 1, columna 1/ }).click();
  await expect(page.getByRole("heading", { name: "Condimento mineral" })).toBeVisible();
  activeCell = page.locator('[role="gridcell"][aria-selected="true"]');
  await activeCell.press("ArrowDown");
  activeCell = page.locator('[role="gridcell"][aria-selected="true"]');
  delayNextProgress = true;
  await activeCell.press("A");
  activeCell = page.locator('[role="gridcell"][aria-selected="true"]');
  await expect(activeCell).toHaveAttribute("aria-label", /Fila 3, columna 1/);
  await activeCell.press("L");
  await expectCrosswordCellCount(request, 5);

  await page
    .getByRole("textbox", {
      name: "Letra 2 de 3, 2 Horizontal. Lo contrario de oscuridad",
      exact: true,
    })
    .fill("U");
  await expectCrosswordCellCount(request, 6);
  await page
    .getByRole("textbox", {
      name: "Letra 3 de 3, 2 Horizontal. Lo contrario de oscuridad",
      exact: true,
    })
    .fill("Z");
  await expectCrosswordCellCount(request, 7);

  await page.getByRole("button", { name: "Comprobar formato" }).click();
  await expect(page.getByText(/Todas las celdas tienen un formato válido/)).toBeVisible();
  await page.getByRole("button", { name: "Finalizar" }).click();
  await expect(page.getByRole("heading", { name: "1250 puntos" })).toBeVisible();
  await expect(page.getByText(/Tu puesto: 2 de 2/)).toBeVisible();
  await expect(page.getByText("Partida casual.")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("correctOptionId");
  await expect(page.locator("body")).not.toContainText("crosswordSolution");
  await page.getByRole("link", { name: "Ver revisión al cierre" }).click();
  await expect(page.getByRole("heading", { name: "Crucigrama E2E" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Solución del crucigrama" })).toBeVisible();
  await expect(page.getByText("Respuesta: LUZ", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "1250 puntos" })).toBeVisible();
  await expect(page.getByText("Partida casual")).toBeVisible();
  await expect(page.getByText("Ayudas utilizadas: 1")).toBeVisible();
  await expect(page.getByText(/Media de 20 partidas competitivas/)).toBeVisible();
  await expect(page.getByText("El 20% falló esta palabra.")).toBeVisible();
  await expect(page.getByText("Tu respuesta: SAL")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("vocabularyVersion");
});

test("la cuenta migra el invitado y reanuda el mismo quiz en otro navegador", async ({
  browser,
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Tu cuenta" })).toBeVisible();
  await page.getByLabel("Correo").fill("cuenta@example.com");
  await page.getByLabel("Contraseña").fill("secreto-seguro");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByText("Conectado como cuenta@example.com")).toBeVisible();
  await expect(page.getByText(/Tu progreso ya viaja contigo/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Tu resultado de ayer" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Revisar mi partida" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Avisos de la app" })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: "Descargar mis datos" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("ludico-datos.json");
  await page.getByLabel("Avisos activados").check();
  await page.getByLabel("Zona horaria").fill("Europe/Paris");
  await page.getByLabel("Silencio desde").fill("21:30");
  await page.getByLabel("hasta").fill("07:30");
  await page.getByRole("button", { name: "Guardar avisos" }).click();
  await expect(page.getByText("Preferencias de avisos guardadas.")).toBeVisible();
  const notificationState = (await (await request.get(`${apiBaseUrl}/__e2e/state`)).json()) as {
    notificationPreferences: {
      enabled: boolean;
      quietEnd: string;
      quietStart: string;
      timeZone: string;
    };
  };
  expect(notificationState.notificationPreferences).toMatchObject({
    enabled: true,
    quietEnd: "07:30",
    quietStart: "21:30",
    timeZone: "Europe/Paris",
  });

  const quizCard = page.getByRole("article").filter({
    has: page.getByRole("heading", { name: "Quiz diario", exact: true }),
  });
  await quizCard.getByRole("link", { name: "Jugar", exact: true }).click();
  await page.getByRole("radio", { name: "Opción 1", exact: true }).check();
  await expectAnswerCount(request, 1);
  await expect
    .poll(async () => {
      const state = (await (await request.get(`${apiBaseUrl}/__e2e/state`)).json()) as {
        playerAuthorization: string | null;
      };
      return state.playerAuthorization;
    })
    .toBe("Bearer e2e-access-token");
  const accountState = (await (await request.get(`${apiBaseUrl}/__e2e/state`)).json()) as {
    migrations: number;
  };
  expect(accountState.migrations).toBeGreaterThanOrEqual(1);

  const secondContext = await browser.newContext();
  const secondPage = await secondContext.newPage();
  await secondPage.goto("/");
  await secondPage.getByLabel("Correo").fill("cuenta@example.com");
  await secondPage.getByLabel("Contraseña").fill("secreto-seguro");
  await secondPage.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(secondPage.getByText("Conectado como cuenta@example.com")).toBeVisible();
  await expect(secondPage.getByLabel("Avisos activados")).toBeChecked();
  await expect(secondPage.getByLabel("Zona horaria")).toHaveValue("Europe/Paris");
  const secondQuizCard = secondPage.getByRole("article").filter({
    has: secondPage.getByRole("heading", { name: "Quiz diario", exact: true }),
  });
  await secondQuizCard.getByRole("link", { name: "Jugar", exact: true }).click();
  await expect(secondPage.getByRole("heading", { name: "Pregunta de prueba 2" })).toBeVisible();
  await secondContext.close();

  await page.goto("/");
  await page.getByLabel("Confirma tu contraseña").fill("secreto-seguro");
  await page.getByLabel("Escribe ELIMINAR").fill("ELIMINAR");
  await page.getByRole("button", { name: "Eliminar mi cuenta" }).click();
  await expect(
    page.getByText("Cuenta eliminada. Puedes seguir jugando como invitado."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeVisible();
});

test("el backoffice mantiene previews privados detrás de cuenta y audita decisiones", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByLabel("Correo").fill("cuenta@example.com");
  await page.getByLabel("Contraseña").fill("secreto-seguro");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByText("Conectado como cuenta@example.com")).toBeVisible();

  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Backoffice de contenido" })).toBeVisible();
  await expect(
    page.getByText(
      /Reserva aprobada: 9 quiz · 8 crucigramas · 8 verdadero\/falso · 8 palabras · 8 sopas/,
    ),
  ).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Reserva baja" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Métricas de producto" })).toBeVisible();
  await expect(page.getByText("Tasa de finalización: 70%")).toBeVisible();
  await expect(page.getByText("Lotes en cuarentena: 1")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Auditoría reciente" })).toBeVisible();
  await expect(page.getByText(/admin:editor-e2e · schedule/)).toBeVisible();
  await expect(page.getByText("HIGH_RISK_REVIEW")).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);

  await page.getByLabel("Primera fecha").fill("2026-08-01");
  await page.getByLabel("Días (máximo 21)").fill("3");
  await page.getByRole("button", { name: "Planificar generación" }).click();
  await expect(page.getByText("Plan de generación guardado.")).toBeVisible();

  await page.getByLabel("Motivo de programación").fill("Reserva completa revisada por el editor");
  await page.getByRole("button", { name: "Programar 2026-07-30" }).click();
  await expect(page.getByText("Edición programada y auditada.")).toBeVisible();

  await page.getByLabel("Término", { exact: true }).fill("Oscuridad");
  await page.getByLabel("Motivo de moderación").fill("Política editorial comprobada");
  await page.getByRole("button", { name: "Bloquear término" }).click();
  await expect(page.getByText("Término bloqueado y auditado.")).toBeVisible();
  await expect(page.getByText(/oscuridad · activo/)).toBeVisible();
  await page.getByLabel("Motivo de moderación").fill("Revisión editorial completada");
  await page.getByRole("button", { name: "Desactivar" }).click();
  await expect(page.getByText("Término desbloqueado y auditado.")).toBeVisible();
  await expect(page.getByText(/oscuridad · inactivo/)).toBeVisible();

  await page.getByLabel("Palabra").fill("SOL");
  await page.getByLabel("Pista").fill("Astro que ilumina el dia");
  await page.getByLabel("Categoria").fill("Astronomia");
  await page.getByLabel("Dificultad (1-5)").fill("1");
  await page.getByLabel("Calidad (0-100)").fill("90");
  await page.getByLabel("Fuente HTTPS").fill("https://example.com/sol");
  await page.getByLabel("Fuente comprobada el").fill("2026-07-29");
  await page.getByLabel("Motivo editorial").fill("Fuente y pista revisadas manualmente");
  await page.getByRole("button", { name: "Validar entrada" }).click();
  await expect(page.getByText("Entrada lexica validada y auditada.")).toBeVisible();
  await expect(page.getByText(/SOL \(3\) - Astronomia/)).toBeVisible();
  await page.getByLabel("Motivo editorial").fill("La fuente dejo de estar vigente");
  await page.getByRole("button", { name: "Desactivar entrada" }).click();
  await expect(page.getByText("Entrada lexica desactivada y auditada.")).toBeVisible();

  await page.getByLabel("Motivo para la próxima decisión").fill("Fuentes verificadas por edición");
  await page.getByRole("button", { name: "Editar JSON" }).click();
  const publicJson = page.getByLabel("Contenido público JSON");
  await publicJson.fill((await publicJson.inputValue()).replace("Quiz E2E", "Quiz revisado"));
  await page.getByLabel("Motivo para la próxima decisión").fill("Corrección editorial documentada");
  await page.getByRole("button", { name: "Guardar revisión" }).click();
  await expect(page.getByText("Revisión guardada y validada.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Quiz revisado" })).toBeVisible();

  await page.getByLabel("Motivo para la próxima decisión").fill("Fuentes verificadas por edición");
  await page.getByRole("button", { name: "Aprobar" }).click();
  await expect(page.getByText("Decisión auditada.")).toBeVisible();
  await page
    .getByLabel("Motivo para la próxima decisión")
    .fill("Solicitar alternativa con nuevas fuentes");
  await page.getByRole("button", { name: "Regenerar" }).click();
  await expect(page.getByText("Regeneración en cola.")).toBeVisible();
  const state = (await (await request.get(`${apiBaseUrl}/__e2e/state`)).json()) as {
    adminEdits: Array<{ publicPayload: { title?: string }; reason: string }>;
    adminRegenerations: Array<{ reason: string }>;
    adminReviews: Array<{ decision: string; reason: string }>;
    blockedTerms: Array<{ active: boolean; normalizedTerm: string }>;
    contentPlans: Array<{ days: number; startDate: string }>;
    scheduledEditions: Array<{ id: string; reason: string }>;
    wordBankEntries: Array<{ active: boolean; answer: string }>;
  };
  expect(state.contentPlans).toEqual([
    expect.objectContaining({ days: 3, startDate: "2026-08-01" }),
  ]);
  expect(state.scheduledEditions).toEqual([
    expect.objectContaining({
      id: "55555555-5555-4555-8555-555555555555",
      reason: "Reserva completa revisada por el editor",
    }),
  ]);
  expect(state.adminEdits).toEqual([
    expect.objectContaining({
      publicPayload: expect.objectContaining({ title: "Quiz revisado" }),
      reason: "Corrección editorial documentada",
    }),
  ]);
  expect(state.adminReviews).toEqual([
    { decision: "approved", reason: "Fuentes verificadas por edición" },
  ]);
  expect(state.adminRegenerations).toEqual([
    { reason: "Solicitar alternativa con nuevas fuentes" },
  ]);
  expect(state.blockedTerms).toEqual([
    expect.objectContaining({ active: false, normalizedTerm: "oscuridad" }),
  ]);
  expect(state.wordBankEntries).toEqual([
    expect.objectContaining({ active: false, answer: "SOL" }),
  ]);
});

async function expectAnswerCount(request: APIRequestContext, count: number) {
  await expect
    .poll(async () => {
      const response = await request.get(`${apiBaseUrl}/__e2e/state`);
      const state = (await response.json()) as { answers: unknown[] };
      return state.answers.length;
    })
    .toBe(count);
}

async function expectCrosswordCellCount(request: APIRequestContext, count: number) {
  await expect
    .poll(async () => {
      const response = await request.get(`${apiBaseUrl}/__e2e/state`);
      const state = (await response.json()) as { crosswordCells: unknown[] };
      return state.crosswordCells.length;
    })
    .toBe(count);
}

async function expectAnalyticsCount(request: APIRequestContext, count: number) {
  await expect
    .poll(async () => {
      const response = await request.get(`${apiBaseUrl}/__e2e/state`);
      const state = (await response.json()) as { analyticsEvents: unknown[] };
      return state.analyticsEvents.length;
    })
    .toBe(count);
}

function madridDateOffset(offset: number) {
  const today = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Europe/Madrid",
    year: "numeric",
  }).format(new Date());
  const [year, month, day] = today.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + offset)).toISOString().slice(0, 10);
}

async function pageIsCached() {
  return Boolean(await caches.match(location.href));
}

async function staticAssetsAreCached() {
  const assets = performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((url) => new URL(url).pathname.startsWith("/_next/static/"));
  const cache = await caches.open("ludico-shell-v1");
  const cached = new Set((await cache.keys()).map((request) => request.url));
  return assets.length > 0 && assets.every((asset) => cached.has(asset));
}

async function expectBasicAccessibility(page: Page) {
  const issues = await page.evaluate(() => {
    const found: string[] = [];
    if (!document.documentElement.lang.startsWith("es")) found.push("document-lang");
    const ids = [...document.querySelectorAll<HTMLElement>("[id]")].map(({ id }) => id);
    if (new Set(ids).size !== ids.length) found.push("duplicate-id");
    if (document.querySelector("img:not([alt])")) found.push("image-without-alt");
    for (const element of document.querySelectorAll<HTMLElement>(
      "a[href], button, input:not([type=hidden]), select, textarea",
    )) {
      const labelled =
        element.getAttribute("aria-label") ||
        element.getAttribute("aria-labelledby") ||
        element.getAttribute("title") ||
        element.textContent?.trim() ||
        (element instanceof HTMLInputElement ? element.labels?.[0]?.textContent?.trim() : "");
      if (!labelled) found.push(`unlabelled-${element.tagName.toLowerCase()}`);
    }
    return found;
  });
  expect(issues).toEqual([]);
}
