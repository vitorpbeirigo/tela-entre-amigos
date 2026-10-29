import type { Page } from "@playwright/test";

export async function mockFriendsDesktop(page: Page, platform = "win32") {
  await page.addInitScript((desktopPlatform) => {
    const thumbnail = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#062f34"/></svg>');
    (window as any).telaDesktop = {
      getVersion: async () => "0.11.0-test", getPlatform: async () => desktopPlatform,
      getConnectionPermission: async () => ({ state: "allowed" }), requestConnectionPermission: async () => ({ state: "allowed" }),
      getCapturePermission: async () => "granted", requestCapturePermission: async () => "granted",
      openCaptureSettings: async () => true, openConnectionSettings: async () => true,
      getSources: async () => [{ id: "screen:1:0", name: "Tela principal", displayId: "1", thumbnail, appIcon: null, type: "screen" }],
      selectSource: async () => true, getTurnServers: async () => [], logEvent: () => undefined,
      startDiscordFilteredAudio: async () => ({ discordExcluded: true }), stopDiscordFilteredAudio: async () => true,
      onAudioPcm: () => () => undefined, onAudioStatus: () => () => undefined,
      onUpdateStatus: () => () => undefined, checkForUpdates: async () => ({ state: "development" }), installUpdate: async () => true,
      copyText: async (text: string) => { sessionStorage.setItem("copied-invite", text); return true; },
    };
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", { configurable: true, value: async () => {
      const canvas = document.createElement("canvas"); canvas.width = 960; canvas.height = 540;
      const context = canvas.getContext("2d")!;
      let count = 0;
      const draw = () => { context.fillStyle = `hsl(${count++ % 360} 30% 18%)`; context.fillRect(0, 0, 960, 540);
        context.fillStyle = "#19d0e8"; context.font = "40px sans-serif"; context.fillText(`Infinity · ${count}`, 50, 100); };
      draw(); const timer = setInterval(draw, 100);
      const stream = canvas.captureStream(10), track = stream.getVideoTracks()[0], stop = track.stop.bind(track);
      track.stop = () => { clearInterval(timer); stop(); };
      track.applyConstraints = async () => undefined;
      sessionStorage.setItem("capture-starts", String(Number(sessionStorage.getItem("capture-starts") ?? 0) + 1));
      return stream;
    } });
  }, platform);
}

export async function createFriendsRoom(page: Page, name = "Greg", roomName = "Sala da turma") {
  await page.getByRole("button", { name: "Salas de amigos", exact: true }).click();
  await page.getByLabel("Seu nome na sala").fill(name);
  await page.getByLabel("Nome da sala").fill(roomName);
  await page.getByRole("button", { name: "Criar sala", exact: true }).click();
  await page.getByRole("button", { name: "Copiar convite", exact: true }).click();
  return (await page.evaluate(() => sessionStorage.getItem("copied-invite")))!;
}

export async function importFriendsRoom(page: Page, invite: string, name: string) {
  await page.getByRole("button", { name: "Salas de amigos", exact: true }).click();
  await page.getByLabel("Seu nome na sala").fill(name);
  await page.getByLabel("Convite da sala").fill(invite);
  await page.getByRole("button", { name: "Salvar e entrar", exact: true }).click();
}

export async function shareInFriendsRoom(page: Page) {
  await page.getByRole("button", { name: "Compartilhar tela", exact: true }).click();
  await page.getByRole("button", { name: "Iniciar compartilhamento", exact: true }).click();
}
