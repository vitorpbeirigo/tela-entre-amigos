import { expect, test, type Page } from "@playwright/test";
import { createFriendsRoom, importFriendsRoom, mockFriendsDesktop, shareInFriendsRoom } from "./helpers/friends-desktop";

async function expectVideo(page: Page, name: string) {
  const video = page.getByRole("article", { name: `Tela de ${name}`, exact: true }).locator("video");
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.getVideoPlaybackQuality().totalVideoFrames), { timeout: 30_000 }).toBeGreaterThan(3);
}

test("três clientes: duas telas simultâneas, mosaico, retorno e sala sem criador", async ({ browser }) => {
  test.setTimeout(210_000);
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext({ viewport: { width: 1440, height: 960 } })));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const [greg, ana, bia] = pages;
  const errors: string[] = [];
  try {
    for (const page of pages) {
      page.on("pageerror", (error) => errors.push(error.message));
      await mockFriendsDesktop(page);
      await page.addInitScript(() => {
        const Original = window.RTCPeerConnection;
        (window as any).__friendsPCs = [];
        window.RTCPeerConnection = class extends Original { constructor(config?: RTCConfiguration) { super(config); (window as any).__friendsPCs.push(this); } };
      });
      await page.goto("/");
    }
    const invite = await createFriendsRoom(greg, "Greg", `Turma ${Date.now()}`);
    await importFriendsRoom(ana, invite, "Ana");
    await importFriendsRoom(bia, invite, "Bia");
    await expect(bia.getByRole("region", { name: "Pessoas na sala" })).toContainText("Greg", { timeout: 40_000 });
    await expect(bia.getByRole("region", { name: "Pessoas na sala" })).toContainText("Ana", { timeout: 40_000 });
    await shareInFriendsRoom(greg);
    await shareInFriendsRoom(ana);
    for (const name of ["Greg", "Ana"]) {
      await expect(bia.getByRole("button", { name: `Assistir ${name}`, exact: true })).toBeVisible({ timeout: 40_000 });
      await bia.getByRole("button", { name: `Assistir ${name}`, exact: true }).click();
      await expectVideo(bia, name);
    }
    await expect(bia.locator(".friend-screen")).toHaveCount(2);
    await expect.poll(() => bia.locator(".friend-screen video").evaluateAll((videos: HTMLVideoElement[]) => videos.filter((video) => !video.muted).length)).toBe(1);
    await bia.getByRole("button", { name: "Ouvir Ana", exact: true }).click();
    await expect.poll(() => bia.getByRole("article", { name: "Tela de Ana", exact: true }).locator("video").evaluate((video: HTMLVideoElement) => video.muted)).toBe(false);
    await bia.getByLabel("Volume de Ana").fill("35");
    expect(await bia.getByRole("article", { name: "Tela de Ana", exact: true }).locator("video").evaluate((video: HTMLVideoElement) => video.volume)).toBeCloseTo(0.35);
    for (const page of [greg, ana]) {
      await expect.poll(() => page.evaluate(() => ((window as any).__friendsPCs as RTCPeerConnection[])
        .filter((pc) => pc.connectionState === "connected").flatMap((pc) => pc.getSenders()).filter((sender) => sender.track?.kind === "video").length)).toBe(1);
    }
    await bia.screenshot({ path: "artifacts/qa/friends-mosaic.png", fullPage: true });
    await bia.getByRole("button", { name: "Foco", exact: true }).click();
    await expect(bia.locator(".friend-screen")).toHaveCount(1);
    await expectVideo(bia, "Ana");
    await bia.getByRole("button", { name: "Mosaico", exact: true }).click();
    await greg.getByRole("button", { name: "Parar compartilhamento", exact: true }).click();
    await expect(bia.getByRole("article", { name: "Tela de Greg", exact: true })).toContainText("Aguardando a próxima transmissão", { timeout: 15_000 });
    await expectVideo(bia, "Ana");
    await shareInFriendsRoom(greg);
    await expectVideo(bia, "Greg");
    await greg.getByLabel("Qualidade da sua transmissão").selectOption("cinema");
    await expectVideo(bia, "Greg");
    await bia.getByRole("article", { name: "Tela de Greg", exact: true }).getByRole("button", { name: "Parar de assistir Greg", exact: true }).click();
    await bia.getByRole("button", { name: "Assistir Greg", exact: true }).click();
    await expectVideo(bia, "Greg");
    const roomName = await bia.locator(".friends-room-heading h1").innerText();
    await bia.getByRole("button", { name: "Sair da sala", exact: true }).click();
    await bia.reload();
    await bia.getByRole("button", { name: `Entrar na sala ${roomName}`, exact: true }).click();
    await expect(bia.getByRole("button", { name: "Assistir Ana", exact: true })).toBeVisible({ timeout: 40_000 });
    await bia.getByRole("button", { name: "Assistir Ana", exact: true }).click();
    await expectVideo(bia, "Ana");
    await greg.getByRole("button", { name: "Sair da sala", exact: true }).click();
    await expectVideo(bia, "Ana");
    await shareInFriendsRoom(bia);
    await expect(ana.getByRole("button", { name: "Assistir Bia", exact: true })).toBeVisible({ timeout: 30_000 });
    await ana.getByRole("button", { name: "Assistir Bia", exact: true }).click();
    await expectVideo(ana, "Bia");
    expect(await ana.locator(".friend-screen video").evaluateAll((videos: HTMLVideoElement[]) => videos.every((video) => video.muted))).toBe(true);
    expect(errors).toEqual([]);
  } finally { await Promise.allSettled(contexts.map((context) => context.close())); }
});

test("quatro clientes: entrada após queda de rede sem reiniciar quem já transmite", async ({ browser }) => {
  test.setTimeout(210_000);
  const contexts = await Promise.all([0, 1, 2, 3].map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const [greg, ana, bia, gui] = pages;
  try {
    for (const page of pages) { await mockFriendsDesktop(page); await page.goto("/"); }
    const invite = await createFriendsRoom(greg, "Greg", `Reconexão ${Date.now()}`);
    await importFriendsRoom(ana, invite, "Ana");
    await shareInFriendsRoom(greg);
    await expect(ana.getByRole("button", { name: "Assistir Greg", exact: true })).toBeVisible({ timeout: 40_000 });
    await ana.getByRole("button", { name: "Assistir Greg", exact: true }).click();
    await expectVideo(ana, "Greg");
    await contexts[2].setOffline(true);
    await importFriendsRoom(bia, invite, "Bia");
    await expect(bia.getByRole("region", { name: "Pessoas na sala" })).not.toContainText("Greg");
    const video = ana.getByRole("article", { name: "Tela de Greg", exact: true }).locator("video");
    const frames = await video.evaluate((element: HTMLVideoElement) => element.getVideoPlaybackQuality().totalVideoFrames);
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(frames + 15);
    await contexts[2].setOffline(false);
    await expect(bia.getByRole("button", { name: "Assistir Greg", exact: true })).toBeVisible({ timeout: 65_000 });
    await bia.getByRole("button", { name: "Assistir Greg", exact: true }).click();
    await expectVideo(bia, "Greg");
    await importFriendsRoom(gui, invite, "Gui");
    for (const page of pages) {
      for (const name of ["Greg", "Ana", "Bia", "Gui"]) await expect(page.getByRole("region", { name: "Pessoas na sala" })).toContainText(name, { timeout: 40_000 });
      await expect(page.locator(".friends-connection-notice")).toHaveCount(0, { timeout: 15_000 });
    }
    await shareInFriendsRoom(ana);
    await shareInFriendsRoom(bia);
    for (const name of ["Greg", "Ana", "Bia"]) {
      await expect(gui.getByRole("button", { name: `Assistir ${name}`, exact: true })).toBeVisible({ timeout: 30_000 });
      await gui.getByRole("button", { name: `Assistir ${name}`, exact: true }).click();
      await expectVideo(gui, name);
    }
    await expect(gui.locator(".friend-screen")).toHaveCount(3);
    await expectVideo(ana, "Greg");
  } finally { await Promise.allSettled(contexts.map((context) => context.close())); }
});
