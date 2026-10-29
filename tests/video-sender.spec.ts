import { expect, test } from "@playwright/test";
import { configureVideoSender, QUALITY_PRESETS } from "../src/screen-media";

function connection() {
  const applied: any[] = [];
  let cname = "first", stale = false;
  const sender = {
    track: Object.assign(new EventTarget(), { kind: "video", readyState: "live", getSettings: () => ({ width: 1920, height: 1080 }) }),
    getParameters: () => ({ encodings: [{}], rtcp: { cname }, codecs: [{ mimeType: "video/VP8" }] }),
    setParameters: async (parameters: any) => {
      applied.push(parameters);
      if (stale) { stale = false; cname = "renegotiated"; throw new DOMException("stale RTCP", "InvalidModificationError"); }
    },
  };
  const pc = Object.assign(new EventTarget(), {
    connectionState: "connected", signalingState: "stable",
    getSenders: () => [sender], getTransceivers: () => [{ sender, currentDirection: "sendonly" as string | null }],
  });
  return { pc, sender, applied, stale: () => { stale = true; } };
}

test("bitrate aguarda negociação da mídia sem modificar RTCP ou codecs", async () => {
  const { pc, applied } = connection();
  pc.signalingState = "have-local-offer";
  const pending = configureVideoSender(pc as unknown as RTCPeerConnection, QUALITY_PRESETS[0]);
  await Promise.resolve();
  expect(applied).toHaveLength(0);
  pc.signalingState = "stable"; pc.dispatchEvent(new Event("signalingstatechange"));
  await pending;
  expect(applied).toHaveLength(1);
  expect(applied[0]).toMatchObject({ rtcp: { cname: "first" }, codecs: [{ mimeType: "video/VP8" }],
    encodings: [{ maxBitrate: 4_000_000, maxFramerate: 30, scaleResolutionDownBy: 1.5 }] });
});

test("renegociação concorrente refaz parâmetros e mantém o limite de qualidade", async () => {
  const { pc, applied, stale } = connection(); stale();
  await configureVideoSender(pc as unknown as RTCPeerConnection, QUALITY_PRESETS[1]);
  expect(applied).toHaveLength(2);
  expect(applied[1]).toMatchObject({ rtcp: { cname: "renegotiated" }, encodings: [{ maxBitrate: 10_000_000 }] });
});

test("fechar a conexão cancela ajuste pendente sem alterar senders encerrados", async () => {
  const { pc, applied } = connection(); pc.signalingState = "have-local-offer";
  const pending = configureVideoSender(pc as unknown as RTCPeerConnection, QUALITY_PRESETS[0]);
  pc.connectionState = "closed"; pc.dispatchEvent(new Event("connectionstatechange"));
  await pending;
  expect(applied).toHaveLength(0);
});

test("negociação lenta aplica somente o último perfil solicitado", async () => {
  const { pc, applied } = connection(); pc.signalingState = "have-local-offer";
  const first = configureVideoSender(pc as unknown as RTCPeerConnection, QUALITY_PRESETS[0]);
  const latest = configureVideoSender(pc as unknown as RTCPeerConnection, QUALITY_PRESETS[1]);
  await new Promise((resolve) => setTimeout(resolve, 2_100));
  pc.signalingState = "stable"; pc.dispatchEvent(new Event("signalingstatechange"));
  await Promise.all([first, latest]);
  expect(applied).toHaveLength(1);
  expect(applied[0].encodings[0].maxBitrate).toBe(10_000_000);
});

test("áudio encerrado durante a negociação não impede o limite de vídeo", async () => {
  const { pc, sender, applied } = connection();
  const audio = { ...sender, track: Object.assign(new EventTarget(), { kind: "audio", readyState: "live", getSettings: () => ({}) }) };
  pc.getSenders = () => [audio, sender];
  pc.getTransceivers = () => [{ sender: audio, currentDirection: "inactive" }, { sender, currentDirection: "sendonly" }];
  pc.signalingState = "have-local-offer";
  await configureVideoSender(pc as unknown as RTCPeerConnection, QUALITY_PRESETS[0]);
  audio.track.readyState = "ended"; audio.track.dispatchEvent(new Event("ended"));
  pc.signalingState = "stable"; pc.dispatchEvent(new Event("signalingstatechange"));
  await Promise.resolve();
  expect(applied).toHaveLength(1);
  expect(applied[0].encodings[0].maxBitrate).toBe(4_000_000);
});
