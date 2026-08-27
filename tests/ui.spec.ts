import { expect, test, type Page } from "@playwright/test";

const mockDesktop = async (
  page: Page,
  initialUpdateStatus?: UpdateStatus,
  platform: NodeJS.Platform = "win32",
  capturePermission: "not-determined" | "granted" | "denied" | "restricted" | "unknown" = "granted",
) => {
  await page.addInitScript(({ updateStatus, desktopPlatform, permission }) => {
    const thumbnail =
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="100%" height="100%" fill="#17191b"/><circle cx="320" cy="180" r="82" fill="none" stroke="#dff247" stroke-opacity=".25"/><text x="320" y="188" text-anchor="middle" fill="#d0d6e0" font-family="sans-serif" font-size="22">Tela principal</text></svg>',
      );

    Object.defineProperty(window, "telaDesktop", {
      value: {
        getVersion: async () => "0.9.0-test",
        getPlatform: async () => desktopPlatform,
        getCapturePermission: async () => permission,
        openCaptureSettings: async () => {
          sessionStorage.setItem("capture-settings-opened", "true");
          return true;
        },
        getSources: async () => [
          {
            id: "screen:1:0",
            name: "Tela principal",
            displayId: "1",
            thumbnail,
            appIcon: null,
            type: "screen",
          },
        ],
        selectSource: async () => true,
        startDiscordFilteredAudio: async () => ({ discordExcluded: true }),
        stopDiscordFilteredAudio: async () => true,
        onAudioPcm: () => () => undefined,
        onAudioStatus: () => () => undefined,
        copyText: async (value: string) => {
          sessionStorage.setItem("copied-room-code", value);
          return true;
        },
        getTurnServers: async () => [],
        logEvent: () => undefined,
        checkForUpdates: async () => ({ state: "development" }),
        installUpdate: async () => {
          sessionStorage.setItem("update-installed", "true");
          return true;
        },
        onUpdateStatus: (callback: (status: UpdateStatus) => void) => {
          if (updateStatus) setTimeout(() => callback(updateStatus), 0);
          return () => undefined;
        },
      },
    });

    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 1920;
        canvas.height = 1080;
        const context = canvas.getContext("2d")!;
        context.fillStyle = "#161718";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#dff247";
        context.font = "64px sans-serif";
        context.fillText("Tela — teste P2P", 120, 180);
        const stream = canvas.captureStream(10);
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.applyConstraints = async (constraints) => {
            sessionStorage.setItem("live-quality-constraints", JSON.stringify(constraints));
          };
        }
        return stream;
      },
    });
  }, { updateStatus: initialUpdateStatus, desktopPlatform: platform, permission: capturePermission });
};

test("carrega a tela inicial e abre a configuração do anfitrião", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mockDesktop(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Sua tela/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Compartilhar minha tela/i })).toBeVisible();
  await page.getByRole("button", { name: /Compartilhar minha tela/i }).click();
  await expect(page.getByRole("heading", { name: /O que você quer mostrar/i })).toBeVisible();
  await expect(page.getByText("Tela principal", { exact: true })).toBeVisible();
  await expect(page.locator(".source-card").first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("radio", { name: /Jogar/i })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("Áudio sem Discord", { exact: true })).toBeVisible();
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Iniciar transmissão/i })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("mantém a home utilizável na menor janela suportada", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 640 });
  await mockDesktop(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /Sua tela/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /Compartilhar minha tela/i })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
});

test("orienta a liberar gravação de tela quando o macOS bloqueia a captura", async ({ page }) => {
  await mockDesktop(page, undefined, "darwin", "denied");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /O Mac precisa conhecer o Infinity/i })).toBeVisible();
  await page.getByRole("button", { name: "Entendi" }).click();
  await page.getByRole("button", { name: /Compartilhar minha tela/i }).click();

  await expect(page.getByText(/macOS bloqueou a gravação de tela/i)).toBeVisible();
  await page.getByRole("button", { name: "Abrir ajustes" }).click();
  expect(await page.evaluate(() => sessionStorage.getItem("capture-settings-opened"))).toBe("true");
});

test("valida o código de uma sala antes de conectar", async ({ page }) => {
  await mockDesktop(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Entrar em uma sala/i }).click();
  await page.getByLabel("Seu nome").fill("Greg");
  await page.getByLabel("Código da sala").fill("CURTO");
  await page.getByRole("button", { name: /Assistir agora/i }).click();
  await expect(page.getByText("Cole o código completo da sala.")).toBeVisible();
});

test("permite ao espectador controlar e silenciar o volume", async ({ page }) => {
  await mockDesktop(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Entrar em uma sala/i }).click();
  await page.getByLabel("Seu nome").fill("Greg");
  await page.getByLabel("Código da sala").fill("ABCDE-FGHJK-LMNPQ-RSTUV");
  await page.getByRole("button", { name: /Assistir agora/i }).click();

  const volume = page.getByRole("slider", { name: "Volume da transmissão" });
  await expect(volume).toHaveValue("100");
  await volume.fill("35");
  await expect(page.locator(".viewer-volume output")).toHaveText("35%");
  await expect(page.locator(".viewer-stage video")).toHaveJSProperty("volume", 0.35);

  await page.getByRole("button", { name: "Silenciar transmissão" }).click();
  await expect(volume).toHaveValue("0");
  await expect(page.locator(".viewer-stage video")).toHaveJSProperty("muted", true);
  await page.getByRole("button", { name: "Ativar som da transmissão" }).click();
  await expect(volume).toHaveValue("35");
});

test("copia o código da sala usando a ponte nativa", async ({ page }) => {
  await mockDesktop(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Compartilhar minha tela/i }).click();
  await expect(page.locator(".source-card").first()).toBeVisible();
  await page.getByRole("button", { name: /Iniciar transmissão/i }).click();
  const code = (await page.locator(".room-code-copy span").textContent())!.trim();

  await expect(page.getByText("Prévia pausada", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mostrar prévia" }).click();
  await expect(page.locator(".video-panel video")).toBeVisible();

  await page.getByRole("button", { name: /Copiar código/i }).click();

  await expect(page.getByRole("button", { name: /Copiado/i })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("copied-room-code"))).toBe(code);
});

test("altera a qualidade durante a transmissão sem trocar o código", async ({ page }) => {
  await mockDesktop(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Compartilhar minha tela/i }).click();
  await expect(page.locator(".source-card").first()).toBeVisible();
  await page.getByRole("button", { name: /Iniciar transmissão/i }).click();
  const originalCode = (await page.locator(".room-code-copy span").textContent())!.trim();

  await page.getByLabel("Qualidade ao vivo").selectOption("cinema");

  await expect(page.getByText(/Cinema aplicada sem desconectar ninguém/i)).toBeVisible();
  await expect(page.locator(".room-code-copy span")).toHaveText(originalCode);
  const constraints = JSON.parse((await page.evaluate(() => sessionStorage.getItem("live-quality-constraints")))!);
  expect(constraints.width.max).toBe(1920);
  expect(constraints.height.max).toBe(1080);
  expect(constraints.frameRate.max).toBe(30);
});

test("oferece reinício quando uma atualização automática termina", async ({ page }) => {
  await mockDesktop(page, { state: "downloaded", version: "0.2.1" });
  await page.goto("/");

  await expect(page.getByText("Versão 0.2.1 pronta")).toBeVisible();
  await page.getByRole("button", { name: "Reiniciar agora" }).click();
  expect(await page.evaluate(() => sessionStorage.getItem("update-installed"))).toBe("true");
});

test("dois clientes se encontram pela descoberta P2P pública", async ({ page, context }) => {
  const viewer = await context.newPage();
  await mockDesktop(page);
  await mockDesktop(viewer);

  await page.goto("/");
  await page.getByRole("button", { name: /Compartilhar minha tela/i }).click();
  await expect(page.locator(".source-card").first()).toBeVisible();
  await page.getByRole("button", { name: /Iniciar transmissão/i }).click();
  await expect(page.getByRole("heading", { name: /Sua tela está sendo compartilhada/i })).toBeVisible();
  const code = (await page.locator(".room-code-copy span").textContent())!.trim();

  await viewer.goto("/");
  await viewer.getByRole("button", { name: /Entrar em uma sala/i }).click();
  await viewer.getByLabel("Seu nome").fill("Amigo de teste");
  await viewer.getByLabel("Código da sala").fill(code);
  await viewer.getByRole("button", { name: /Assistir agora/i }).click();

  await expect(page.getByText("Amigo de teste", { exact: true })).toBeVisible({ timeout: 35_000 });
  await expect(viewer.locator(".watch-room")).toContainText("Aguardando aprovação");
  await expect.poll(async () =>
    viewer.locator(".viewer-stage video").evaluate((video: HTMLVideoElement) => Boolean(video.srcObject)),
  ).toBe(false);
  await page.getByRole("button", { name: "Permitir Amigo de teste" }).click();
  await expect(viewer.locator(".watch-room")).toContainText("Conectado", { timeout: 35_000 });
  await expect.poll(async () =>
    viewer.locator(".viewer-stage video").evaluate((video: HTMLVideoElement) => Boolean(video.srcObject)),
  ).toBe(true);

  await page.getByRole("button", { name: "Remover Amigo de teste" }).click();
  await expect(viewer.locator(".watch-room")).toContainText("Você foi removido");
});
