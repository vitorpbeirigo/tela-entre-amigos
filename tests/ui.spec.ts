import { expect, test, type Page } from "@playwright/test";

const mockDesktop = async (page: Page) => {
  await page.addInitScript(() => {
    const thumbnail =
      "data:image/svg+xml," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="100%" height="100%" fill="#17191b"/><circle cx="320" cy="180" r="82" fill="none" stroke="#dff247" stroke-opacity=".25"/><text x="320" y="188" text-anchor="middle" fill="#d0d6e0" font-family="sans-serif" font-size="22">Tela principal</text></svg>',
      );

    Object.defineProperty(window, "telaDesktop", {
      value: {
        getVersion: async () => "0.1.1-test",
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
        copyText: async (value: string) => {
          sessionStorage.setItem("copied-room-code", value);
          return true;
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
        return canvas.captureStream(10);
      },
    });
  });
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
  await expect(page.getByRole("button", { name: /Iniciar transmissão/i })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("valida o código de uma sala antes de conectar", async ({ page }) => {
  await mockDesktop(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Entrar em uma sala/i }).click();
  await page.getByLabel("Código da sala").fill("CURTO");
  await page.getByRole("button", { name: /Assistir agora/i }).click();
  await expect(page.getByText("Cole o código completo da sala.")).toBeVisible();
});

test("copia o código da sala usando a ponte nativa", async ({ page }) => {
  await mockDesktop(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Compartilhar minha tela/i }).click();
  await expect(page.locator(".source-card").first()).toBeVisible();
  await page.getByRole("button", { name: /Iniciar transmissão/i }).click();
  const code = (await page.locator(".room-code-copy span").textContent())!.trim();

  await page.getByRole("button", { name: /Copiar código/i }).click();

  await expect(page.getByRole("button", { name: /Copiado/i })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("copied-room-code"))).toBe(code);
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
  await viewer.getByLabel("Código da sala").fill(code);
  await viewer.getByRole("button", { name: /Assistir agora/i }).click();

  await expect(viewer.locator(".watch-room")).toContainText("Conectado", { timeout: 35_000 });
  await expect.poll(async () =>
    viewer.locator(".viewer-stage video").evaluate((video: HTMLVideoElement) => Boolean(video.srcObject)),
  ).toBe(true);
});
