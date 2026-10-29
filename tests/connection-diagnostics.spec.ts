import { expect, test } from "@playwright/test";
import { connectionReport, getTransportConfig, resetConnectionDiagnostics } from "../src/connection-diagnostics";

class FakeConnection extends EventTarget {
  connectionState = "new";
  iceConnectionState = "new";
  iceGatheringState = "complete";
  remoteDescription: { type: string; sdp: string } | null = null;
  localDescription = { type: "answer", sdp: "private-local-sdp" };
  constructor(public configuration: RTCConfiguration) { super(); }
  async getStats() {
    return new Map([
      ["local", { type: "local-candidate", candidateType: "srflx", protocol: "udp", address: "198.51.100.10", port: 4444 }],
      ["remote", { type: "remote-candidate", candidateType: "host", protocol: "tcp", address: "192.0.2.20", port: 5555 }],
      ["pair", { type: "candidate-pair", state: "failed", localCandidateId: "local", remoteCandidateId: "remote" }],
    ]);
  }
  close() { this.connectionState = "closed"; this.dispatchEvent(new Event("connectionstatechange")); }
}

test.beforeEach(() => {
  resetConnectionDiagnostics();
  Object.defineProperty(globalThis, "RTCPeerConnection", { configurable: true, value: FakeConnection });
});
test.afterEach(() => Reflect.deleteProperty(globalThis, "RTCPeerConnection"));

test("rotas diversificam candidatos completos e preservam somente STUN sem retransmissão", () => {
  expect(getTransportConfig("Nostr").trickleIce).toBe(true);
  for (const strategy of ["MQTT", "Torrent"] as const) expect(getTransportConfig(strategy).trickleIce).toBe(false);
  const config = getTransportConfig("MQTT");
  const urls = config.rtcConfig.iceServers.flatMap((server) => server.urls);
  expect(urls.every((url) => url.startsWith("stun:"))).toBe(true);
  expect(urls).toContain("stun:stun.cloudflare.com:3478");
  expect(urls).toContain("stun:global.stun.twilio.com:3478");
  expect(config.maxReceiveBytes).toBe(65_536);
});

test("diagnóstico captura transporte pendente e remove endereços, SDP, portas e dados brutos", async () => {
  const { rtcPolyfill } = getTransportConfig("MQTT");
  const pc = new rtcPolyfill({}) as unknown as FakeConnection;
  try {
    pc.remoteDescription = { type: "offer", sdp: "private-remote-sdp secret-invite" };
    pc.connectionState = "connecting"; pc.iceConnectionState = "checking";
    pc.dispatchEvent(new Event("signalingstatechange"));
    await expect.poll(() => JSON.parse(connectionReport("0.11.0", "win32", 1)).transports[0]?.localSrflx).toBe(1);
    const report = connectionReport("0.11.0", "win32", 1);
    expect(JSON.parse(report).transports[0]).toMatchObject({ remoteHost: 1, pairsFailed: 1, ice: "checking" });
    for (const secret of ["198.51.100.10", "192.0.2.20", "4444", "5555", "private-", "secret-invite", "localCandidateId", "sdp"]) expect(report).not.toContain(secret);
  } finally { pc.close(); }
});

test("conexões sem negociação não viram erro e a saída cancela coletas posteriores", async () => {
  const { rtcPolyfill } = getTransportConfig("Nostr");
  const pc = new rtcPolyfill({}) as unknown as FakeConnection;
  pc.dispatchEvent(new Event("signalingstatechange"));
  expect(connectionReport("0.11.0", "win32", 0)).not.toContain('"transport":');
  pc.close();
  expect(connectionReport("0.11.0", "win32", 0)).not.toContain('"transport":');
});
