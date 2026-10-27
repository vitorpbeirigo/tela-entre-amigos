export type QualityKey = "performance" | "cinema" | "smooth" | "extreme";
export interface QualityPreset {
  key: QualityKey; label: string; detail: string;
  width: number; height: number; frameRate: number; maxBitrate: number;
}
export const QUALITY_PRESETS: QualityPreset[] = [
  { key: "performance", label: "Jogar", detail: "720p · 30 FPS · 4 Mbps · menor uso da GPU", width: 1280, height: 720, frameRate: 30, maxBitrate: 4_000_000 },
  { key: "cinema", label: "Cinema", detail: "1080p · 30 FPS · 10 Mbps", width: 1920, height: 1080, frameRate: 30, maxBitrate: 10_000_000 },
  { key: "smooth", label: "Suave", detail: "1080p · 60 FPS · 15 Mbps", width: 1920, height: 1080, frameRate: 60, maxBitrate: 15_000_000 },
  { key: "extreme", label: "Extrema", detail: "1440p · 60 FPS · 24 Mbps", width: 2560, height: 1440, frameRate: 60, maxBitrate: 24_000_000 },
];

export type CaptureScreen = (sourceId: string, preset: QualityPreset, withAudio: boolean, isCurrent: () => boolean) => Promise<MediaStream>;

export async function captureDesktopStream(options: {
  sourceId: string; preset: QualityPreset; platform: string; withAudio: boolean;
  createAudioTrack: () => Promise<MediaStreamTrack>; isCurrent: () => boolean;
}) {
  const { preset, platform, withAudio, isCurrent } = options;
  if (!await window.telaDesktop.selectSource(options.sourceId)) throw new Error("Esta tela não está mais disponível. Atualize as fontes.");
  if (!isCurrent()) throw new Error("Captura cancelada");
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { width: { ideal: preset.width }, height: { ideal: preset.height }, frameRate: { ideal: preset.frameRate, max: preset.frameRate } },
    audio: withAudio && platform === "darwin",
  });
  try {
    if (!isCurrent()) throw new Error("Captura cancelada");
    if (withAudio && platform === "win32") stream.addTrack(await options.createAudioTrack());
    if (!isCurrent()) throw new Error("Captura cancelada");
    const video = stream.getVideoTracks()[0];
    if (!video || video.readyState === "ended") throw new Error("A captura foi encerrada. Escolha a tela novamente.");
    video.contentHint = "motion";
    return stream;
  } catch (error) { stream.getTracks().forEach((track) => track.stop()); throw error; }
}

export async function configureVideoSender(pc: RTCPeerConnection, preset: QualityPreset) {
  const audioSender = pc.getSenders().find((item) => item.track?.kind === "audio");
  if (audioSender) {
    const parameters = audioSender.getParameters();
    parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
    parameters.encodings[0].maxBitrate = 128_000;
    parameters.encodings[0].priority = "high";
    await audioSender.setParameters(parameters).catch(() => undefined);
  }
  const sender = pc.getSenders().find((item) => item.track?.kind === "video");
  if (!sender) return;
  const parameters = sender.getParameters();
  parameters.degradationPreference = preset.key === "performance" ? "maintain-framerate" : "balanced";
  parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
  parameters.encodings[0].maxBitrate = preset.maxBitrate;
  parameters.encodings[0].maxFramerate = preset.frameRate;
  const settings = sender.track?.getSettings();
  const scale = Math.max((settings?.width ?? preset.width) / preset.width, (settings?.height ?? preset.height) / preset.height, 1);
  parameters.encodings[0].scaleResolutionDownBy = scale > 1.05 ? scale : 1;
  await sender.setParameters(parameters).catch((error) => console.warn("O navegador ajustará automaticamente o bitrate", error));
}
