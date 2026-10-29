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

const pendingSenderSettings = new WeakMap<RTCPeerConnection, () => void>();

export async function configureVideoSender(pc: RTCPeerConnection, preset: QualityPreset) {
  pendingSenderSettings.get(pc)?.();
  const senders = pc.getSenders().filter((sender) => ["audio", "video"].includes(sender.track?.kind ?? ""));
  if (!senders.length || pc.connectionState === "closed") return;
  const tracks = senders.flatMap((sender) => sender.track ? [sender.track] : []);
  let cancelled = false;
  const ready = () => pc.signalingState === "stable" && pc.getTransceivers()
    .filter((transceiver) => senders.includes(transceiver.sender) && transceiver.sender.track?.readyState === "live")
    .every((transceiver) => transceiver.currentDirection === "sendonly" || transceiver.currentDirection === "sendrecv");
  const detach = () => {
    pc.removeEventListener("signalingstatechange", changed); pc.removeEventListener("connectionstatechange", changed);
    tracks.forEach((track) => track.removeEventListener("ended", changed));
  };
  const cancel = () => {
    cancelled = true; detach();
    if (pendingSenderSettings.get(pc) === cancel) pendingSenderSettings.delete(pc);
  };
  const apply = async () => {
    detach();
    try {
      for (const sender of senders) for (let attempt = 0; attempt < 2; attempt++) {
        if (cancelled || pc.connectionState === "closed") return;
        if (!sender.track || sender.track.readyState === "ended") break;
        const parameters = sender.getParameters();
        if (!parameters.encodings?.length) break;
        const encoding = parameters.encodings[0];
        if (sender.track?.kind === "audio") { encoding.maxBitrate = 128_000; encoding.priority = "high"; }
        else {
          parameters.degradationPreference = preset.key === "performance" ? "maintain-framerate" : "balanced";
          encoding.maxBitrate = preset.maxBitrate; encoding.maxFramerate = preset.frameRate;
          const settings = sender.track?.getSettings();
          const scale = Math.max((settings?.width ?? preset.width) / preset.width, (settings?.height ?? preset.height) / preset.height, 1);
          encoding.scaleResolutionDownBy = scale > 1.05 ? scale : 1;
        }
        try { await sender.setParameters(parameters); break; }
        catch (error) {
          // Renegotiation can change read-only RTCP values after getParameters().
          if (attempt === 0 && error instanceof Error && error.name === "InvalidModificationError") continue;
          console.warn("O navegador ajustará automaticamente o bitrate", error); break;
        }
      }
    } finally { if (pendingSenderSettings.get(pc) === cancel) pendingSenderSettings.delete(pc); }
  };
  const changed = () => {
    if (pc.connectionState === "closed" || senders.every((sender) => !sender.track || sender.track.readyState === "ended")) cancel();
    else if (ready()) void apply();
  };
  pendingSenderSettings.set(pc, cancel);
  if (ready()) { await apply(); return; }
  // Keep the latest preset until negotiation finishes, without blocking media teardown.
  pc.addEventListener("signalingstatechange", changed); pc.addEventListener("connectionstatechange", changed);
  tracks.forEach((track) => track.addEventListener("ended", changed));
}
