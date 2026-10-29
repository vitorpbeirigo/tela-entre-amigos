type Diagnostic = Record<string, string | number>;
let generation = 0;
let transportId = 0;
const samples = new Map<number, Diagnostic>();

export function resetConnectionDiagnostics() { generation++; samples.clear(); }

export function connectionReport(version: string, platform: string, participants: number) {
  const safeVersion = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]{1,32})?$/i.test(version) ? version : "desconhecida";
  return JSON.stringify({ app: "Infinity", version: safeVersion, protocol: 2,
    platform: ["win32", "darwin", "linux"].includes(platform) ? platform : "unknown",
    participants: Math.max(0, Math.min(1_000, Math.floor(participants) || 0)),
    transports: [...samples.values()],
  }, null, 2);
}

export function getTransportConfig(strategy: string) {
  const label = ["Nostr", "MQTT", "Torrent"].includes(strategy) ? strategy : "Unknown";
  class ObservedConnection extends RTCPeerConnection {
    constructor(config?: RTCConfiguration) {
      super(config);
      const epoch = generation, id = ++transportId;
      let started = false, stunErrors = 0;
      const timers = new Set<ReturnType<typeof setTimeout>>();
      let counts: Diagnostic = {};
      const collect = async () => {
        if (epoch !== generation || !started) return;
        try {
          const stats = await this.getStats();
          const next: Diagnostic = { localHost: 0, localSrflx: 0, localRelay: 0, remoteHost: 0, remoteSrflx: 0,
            remoteRelay: 0, udp: 0, tcp: 0, pairsChecking: 0, pairsSucceeded: 0, pairsFailed: 0 };
          stats.forEach((stat) => {
            const candidate = stat.type === "local-candidate" ? "local" : stat.type === "remote-candidate" ? "remote" : "";
            if (candidate) {
              const kind = stat.candidateType === "host" ? "Host" : stat.candidateType === "srflx" || stat.candidateType === "prflx" ? "Srflx" : stat.candidateType === "relay" ? "Relay" : "";
              if (kind) next[candidate + kind] = Number(next[candidate + kind]) + 1;
              if (stat.protocol === "udp" || stat.protocol === "tcp") next[stat.protocol] = Number(next[stat.protocol]) + 1;
            }
            if (stat.type === "candidate-pair") {
              const key = stat.state === "succeeded" ? "pairsSucceeded" : stat.state === "failed" ? "pairsFailed" : "pairsChecking";
              next[key] = Number(next[key]) + 1;
            }
          });
          counts = next;
        } catch { /* A closed transport can still export its last aggregate. */ }
        if (epoch !== generation) return;
        const sample: Diagnostic = { strategy: label, transport: id, state: this.connectionState, ice: this.iceConnectionState,
          gathering: this.iceGatheringState, stunErrors, ...counts };
        samples.set(id, sample);
        while (samples.size > 30) samples.delete(samples.keys().next().value!);
        if (typeof window !== "undefined") window.telaDesktop?.logEvent?.("friends-transport", sample);
      };
      const changed = () => {
        if (!started && this.remoteDescription && this.connectionState !== "closed") {
          started = true;
          for (const delay of [7_000, 18_000]) timers.add(setTimeout(() => { void collect(); }, delay));
        }
        if (["closed", "connected", "failed"].includes(this.connectionState)) { timers.forEach(clearTimeout); timers.clear(); }
        void collect();
      };
      this.addEventListener("signalingstatechange", changed);
      this.addEventListener("connectionstatechange", changed);
      this.addEventListener("iceconnectionstatechange", changed);
      this.addEventListener("icecandidateerror", () => { stunErrors = Math.min(stunErrors + 1, 1_000); });
    }
  }
  return { rtcPolyfill: ObservedConnection, trickleIce: strategy === "Nostr", maxReceiveBytes: 65_536,
    turnConfig: [],
    rtcConfig: { iceServers: [
      { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"] },
      { urls: "stun:stun.cloudflare.com:3478" },
      { urls: "stun:global.stun.twilio.com:3478" },
    ] },
  };
}
