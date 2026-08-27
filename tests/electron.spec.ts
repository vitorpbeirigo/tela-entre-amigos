import { _electron as electron, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

test.describe.configure({ mode: "serial" });

const launchTela = (profile: string) => {
  const packagedExecutable = process.env.TELA_PACKAGED_EXE;
  return electron.launch(
    packagedExecutable
      ? { executablePath: packagedExecutable, args: [`--user-data-dir=${path.join(os.tmpdir(), profile)}`] }
      : { args: [path.resolve("."), `--user-data-dir=${path.join(os.tmpdir(), profile)}`], cwd: path.resolve(".") },
  );
};

const isAudioHelperRunning = () => {
  if (process.platform !== "win32") return false;
  const output = execFileSync("tasklist.exe", ["/FI", "IMAGENAME eq TelaAudioCapture.exe", "/FO", "CSV", "/NH"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return output.toLowerCase().includes("telaaudiocapture.exe");
};

test("o aplicativo Electron lista fontes reais e inicia a captura", async () => {
  const app = await launchTela(`tela-e2e-single-${Date.now()}`);

  try {
    const window = await app.firstWindow();
    const errors: string[] = [];
    window.on("pageerror", (error) => errors.push(error.message));

    await expect(window.getByRole("heading", { name: /Sua tela/i })).toBeVisible();
    const brandImages = window.locator(".brand-logo, .hero-device-card img");
    await expect(brandImages).toHaveCount(2);
    for (const image of await brandImages.all()) {
      await expect.poll(async () => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
    }
    expect(await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.webContents.getLastWebPreferences().sandbox,
    )).toBe(true);
    await window.getByRole("button", { name: /Compartilhar minha tela/i }).click();
    await expect(window.getByRole("heading", { name: /O que você quer mostrar/i })).toBeVisible();

    const sources = window.locator(".source-card");
    await expect(sources.first()).toBeVisible({ timeout: 15_000 });
    expect(await sources.count()).toBeGreaterThan(0);

    await window.getByRole("button", { name: /Iniciar transmissão/i }).click();
    await expect(window.getByRole("heading", { name: /Sua tela está sendo compartilhada/i })).toBeVisible({ timeout: 15_000 });
    await expect(window.getByText("Prévia pausada", { exact: true })).toBeVisible();
    await window.getByRole("button", { name: "Mostrar prévia" }).click();
    await expect.poll(async () =>
      window.locator(".video-panel video").evaluate((video: HTMLVideoElement) =>
        (video.srcObject as MediaStream | null)?.getAudioTracks().length ?? 0,
      ),
    ).toBe(1);
    await expect(window.locator(".room-code-copy")).toContainText(/^[A-Z2-9-]{23}$/);
    const code = (await window.locator(".room-code-copy span").textContent())!.trim();
    await window.getByRole("button", { name: /Copiar código/i }).click();
    await expect(window.getByRole("button", { name: /Copiado/i })).toBeVisible();
    expect(await app.evaluate(async ({ clipboard }) => await clipboard.readText())).toBe(code);
    await expect(window.getByRole("button", { name: /Copiar código/i })).toBeVisible({ timeout: 3_000 });
    await expect(window.locator(".room-code-copy span")).toHaveText(code);
    expect(errors).toEqual([]);
  } finally {
    await app.close();
    if (process.platform === "win32") {
      await expect.poll(isAudioHelperRunning, { timeout: 5_000 }).toBe(false);
    }
  }
});

test("dois processos Electron conectam anfitrião e espectador", async () => {
  const runId = Date.now();
  const hostApp = await launchTela(`tela-e2e-host-${runId}`);
  const viewerApp = await launchTela(`tela-e2e-viewer-${runId}`);

  try {
    const host = await hostApp.firstWindow();
    const viewer = await viewerApp.firstWindow();

    await host.getByRole("button", { name: /Compartilhar minha tela/i }).click();
    await expect(host.locator(".source-card").first()).toBeVisible({ timeout: 15_000 });
    await host.getByRole("button", { name: /Iniciar transmissão/i }).click();
    await expect(host.getByRole("heading", { name: /Sua tela está sendo compartilhada/i })).toBeVisible({ timeout: 15_000 });
    const code = (await host.locator(".room-code-copy span").textContent())!.trim();

    await viewer.getByRole("button", { name: /Entrar em uma sala/i }).click();
    await viewer.getByLabel("Seu nome").fill("Amigo Electron");
    await viewer.getByLabel("Código da sala").fill(code);
    await viewer.getByRole("button", { name: /Assistir agora/i }).click();

    await expect(host.getByText("Amigo Electron", { exact: true })).toBeVisible({ timeout: 35_000 });
    await host.getByRole("button", { name: "Permitir Amigo Electron" }).click();
    await expect(viewer.locator(".watch-room")).toContainText("Conectado", { timeout: 35_000 });
    await expect.poll(async () =>
      viewer.locator(".viewer-stage video").evaluate((video: HTMLVideoElement) => Boolean(video.srcObject)),
    ).toBe(true);
  } finally {
    await Promise.allSettled([hostApp.close(), viewerApp.close()]);
    if (process.platform === "win32") {
      await expect.poll(isAudioHelperRunning, { timeout: 5_000 }).toBe(false);
    }
  }
});
