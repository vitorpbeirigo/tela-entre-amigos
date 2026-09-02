import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

test.describe.configure({ mode: "serial" });

const launchTela = (profile: string) => {
  const packagedExecutable = process.env.TELA_PACKAGED_EXE;
  return electron.launch(
    packagedExecutable
      ? { executablePath: packagedExecutable, args: [`--user-data-dir=${path.join(os.tmpdir(), profile)}`], env: { ...process.env, INFINITY_E2E: "1" } }
      : { args: [path.resolve("."), `--user-data-dir=${path.join(os.tmpdir(), profile)}`], cwd: path.resolve("."), env: { ...process.env, INFINITY_E2E: "1" } },
  );
};

const getAudioHelperPids = () => {
  if (process.platform !== "win32") return new Set<string>();
  const output = execFileSync("tasklist.exe", ["/FI", "IMAGENAME eq TelaAudioCapture.exe", "/FO", "CSV", "/NH"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return new Set(
    output.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^"TelaAudioCapture\.exe","(\d+)"/i);
      return match ? [match[1]] : [];
    }),
  );
};

test("o aplicativo Electron lista fontes reais e inicia a captura", async () => {
  const existingAudioHelpers = getAudioHelperPids();
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
    await expect(window.getByText("Sala aberta · P2P direto", { exact: true })).toBeVisible();
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
      await expect.poll(
        () => [...getAudioHelperPids()].filter((pid) => !existingAudioHelpers.has(pid)),
        { timeout: 5_000 },
      ).toEqual([]);
    }
  }
});

test("dois processos Electron conectam anfitrião e espectador", async () => {
  const existingAudioHelpers = getAudioHelperPids();
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
      await expect.poll(
        () => [...getAudioHelperPids()].filter((pid) => !existingAudioHelpers.has(pid)),
        { timeout: 5_000 },
      ).toEqual([]);
    }
  }
});

test("dois espectadores retornam sem nova aprovação e remoção revoga o acesso", async () => {
  test.setTimeout(240_000);
  const runId = Date.now();
  const existingAudioHelpers = getAudioHelperPids();
  const hostApp = await launchTela(`infinity-rejoin-host-${runId}`);
  const viewerApp = await launchTela(`infinity-rejoin-a-${runId}`);
  const secondApp = await launchTela(`infinity-rejoin-b-${runId}`);
  const errors: string[] = [];
  const instrument = async (page: Page) => {
    page.on("pageerror", (error) => errors.push(error.message));
    await page.evaluate(() => {
      const Original = window.RTCPeerConnection;
      (window as any).__testPeers = [];
      window.RTCPeerConnection = class extends Original {
        constructor(config?: RTCConfiguration) { super(config); (window as any).__testPeers.push(this); }
      };
    });
  };
  const join = async (page: Page, name: string, code: string) => {
    await page.getByRole("button", { name: /Entrar em uma sala/i }).click();
    await page.getByLabel("Seu nome").fill(name);
    await page.getByLabel("Código da sala").fill(code);
    await page.getByRole("button", { name: /Assistir agora/i }).click();
  };
  const decodedFrames = (page: Page) => page.locator(".viewer-stage video").evaluate((video: HTMLVideoElement) => video.getVideoPlaybackQuality().totalVideoFrames);
  const audioBytes = (page: Page) => page.evaluate(async () => {
    let bytes = 0;
    for (const pc of (window as any).__testPeers as RTCPeerConnection[]) {
      if (pc.connectionState !== "connected") continue;
      const report = await pc.getStats();
      report.forEach((stat) => { if (stat.type === "inbound-rtp" && stat.kind === "audio") bytes += stat.bytesReceived ?? 0; });
    }
    return bytes;
  });
  const expectLive = async (page: Page) => {
    await expect(page.locator(".watch-room")).toContainText("Conectado", { timeout: 35_000 });
    const beforeFrames = await decodedFrames(page);
    const beforeAudio = await audioBytes(page);
    try {
      await expect.poll(() => decodedFrames(page), { timeout: 10_000 }).toBeGreaterThan(beforeFrames + 3);
    } catch (error) {
      for (const app of [hostApp, viewerApp, secondApp]) {
        const diagnostic = await (await app.firstWindow()).evaluate(async () => {
          const video = document.querySelector(".viewer-stage video") as HTMLVideoElement | null;
          const peers = await Promise.all(((window as any).__testPeers as RTCPeerConnection[]).filter((pc) => pc.connectionState === "connected").map(async (pc) => {
            const stats: unknown[] = [];
            (await pc.getStats()).forEach((s) => { if (["inbound-rtp", "outbound-rtp"].includes(s.type)) stats.push({ type: s.type, kind: s.kind, framesDecoded: s.framesDecoded, framesEncoded: s.framesEncoded, packetsReceived: s.packetsReceived, bytesSent: s.bytesSent }); });
            return { connection: pc.connectionState, signaling: pc.signalingState,
              senders: pc.getSenders().map((s) => ({ kind: s.track?.kind, state: s.track?.readyState })),
              receivers: pc.getReceivers().map((r) => ({ kind: r.track.kind, state: r.track.readyState, muted: r.track.muted })), stats };
          }));
          return { title: document.querySelector(".watch-room")?.textContent, playback: video && { paused: video.paused, readyState: video.readyState, tracks: (video.srcObject as MediaStream | null)?.getTracks().map((t) => ({ kind: t.kind, state: t.readyState, muted: t.muted })) }, peers };
        });
        console.log("Media diagnostic", JSON.stringify(diagnostic));
      }
      throw error;
    }
    await expect.poll(() => audioBytes(page), { timeout: 10_000 }).toBeGreaterThan(beforeAudio);
  };
  try {
    const host = await hostApp.firstWindow();
    const viewer = await viewerApp.firstWindow();
    const second = await secondApp.firstWindow();
    await Promise.all([host, viewer, second].map(instrument));
    await host.getByRole("button", { name: /Compartilhar minha tela/i }).click();
    await expect(host.locator(".source-card").first()).toBeVisible({ timeout: 15_000 });
    await host.getByRole("button", { name: /Iniciar transmissão/i }).click();
    await expect(host.locator(".room-code-copy span")).toBeVisible({ timeout: 15_000 });
    const code = (await host.locator(".room-code-copy span").textContent())!.trim();
    await join(viewer, "Amigo A", code);
    await expect(host.getByRole("button", { name: "Permitir Amigo A" })).toBeVisible({ timeout: 35_000 });
    await host.getByRole("button", { name: "Permitir Amigo A" }).click();
    await expectLive(viewer);
    await join(second, "Amigo B", code);
    await expect(host.getByRole("button", { name: "Permitir Amigo B" })).toBeVisible({ timeout: 35_000 });
    await host.getByRole("button", { name: "Permitir Amigo B" }).click();
    await expectLive(second);
    await expect.poll(() => host.evaluate(() => {
      const peers = (window as any).__testPeers as RTCPeerConnection[];
      return peers.filter((pc) => pc.connectionState === "connected")
        .flatMap((pc) => pc.getSenders()).filter((sender) => sender.track?.kind === "video").length;
    })).toBe(2); // One encoder per viewer, not one per discovery strategy.
    for (let attempt = 0; attempt < 3; attempt++) {
      await viewer.getByRole("button", { name: "Sair", exact: true }).click();
      await join(viewer, "Amigo A", code); // No host approval on any return.
      await expectLive(viewer);
      await expectLive(second); // Rejoin cannot interrupt the other spectator.
      await expect(host.locator(".room-code-copy span")).toHaveText(code);
    }
    // New renderer -> new peer id, same persisted grant, same live transmission.
    await viewer.reload();
    await instrument(viewer);
    await join(viewer, "Amigo A", code);
    await expectLive(viewer);
    await host.getByRole("button", { name: "Remover Amigo A" }).click();
    await expect(viewer.locator(".watch-room")).toContainText(/removido|não autorizada/i, { timeout: 10_000 });
    await viewer.getByRole("button", { name: "Sair", exact: true }).click();
    await join(viewer, "Amigo A", code);
    await expect(viewer.locator(".watch-room")).toContainText("Entrada não autorizada", { timeout: 35_000 });
    await expectLive(second);
    // A new host transmission must not inherit the previous room's approval.
    await host.getByRole("button", { name: "Encerrar", exact: true }).click();
    await second.getByRole("button", { name: "Sair", exact: true }).click();
    await host.getByRole("button", { name: /Compartilhar minha tela/i }).click();
    await expect(host.locator(".source-card").first()).toBeVisible({ timeout: 15_000 });
    await host.getByRole("button", { name: /Iniciar transmissão/i }).click();
    await expect(host.locator(".room-code-copy span")).toBeVisible({ timeout: 15_000 });
    const newCode = (await host.locator(".room-code-copy span").textContent())!.trim();
    expect(newCode).not.toBe(code);
    await join(second, "Amigo B", newCode);
    await expect(host.getByRole("button", { name: "Permitir Amigo B" })).toBeVisible({ timeout: 35_000 });
    expect(await second.locator(".viewer-stage video").evaluate((video: HTMLVideoElement) => video.srcObject)).toBeNull();
    await host.getByRole("button", { name: "Permitir Amigo B" }).click();
    await expectLive(second);
    expect(errors).toEqual([]);
  } finally {
    await Promise.allSettled([hostApp.close(), viewerApp.close(), secondApp.close()]);
    await expect.poll(() => [...getAudioHelperPids()].filter((pid) => !existingAudioHelpers.has(pid)), { timeout: 5000 }).toEqual([]);
  }
});
