import { _electron as electron, expect, test } from "@playwright/test";
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

test("o aplicativo Electron lista fontes reais e inicia a captura", async () => {
  const app = await launchTela(`tela-e2e-single-${Date.now()}`);

  try {
    const window = await app.firstWindow();
    const errors: string[] = [];
    window.on("pageerror", (error) => errors.push(error.message));

    await expect(window.getByRole("heading", { name: /Sua tela/i })).toBeVisible();
    await window.getByRole("button", { name: /Compartilhar minha tela/i }).click();
    await expect(window.getByRole("heading", { name: /O que você quer mostrar/i })).toBeVisible();

    const sources = window.locator(".source-card");
    await expect(sources.first()).toBeVisible({ timeout: 15_000 });
    expect(await sources.count()).toBeGreaterThan(0);

    await window.getByRole("button", { name: /Iniciar transmissão/i }).click();
    await expect(window.getByRole("heading", { name: /Sua tela está sendo compartilhada/i })).toBeVisible({ timeout: 15_000 });
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
    expect(errors).toEqual([]);
  } finally {
    await app.close();
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
    await viewer.getByLabel("Código da sala").fill(code);
    await viewer.getByRole("button", { name: /Assistir agora/i }).click();

    await expect(viewer.locator(".watch-room")).toContainText("Conectado", { timeout: 35_000 });
    await expect.poll(async () =>
      viewer.locator(".viewer-stage video").evaluate((video: HTMLVideoElement) => Boolean(video.srcObject)),
    ).toBe(true);
  } finally {
    await Promise.allSettled([hostApp.close(), viewerApp.close()]);
  }
});
