import { expect, test } from "@playwright/test";
import type { Room } from "trystero";
import { FriendsSession } from "../src/friends-session";
import { randomSecret } from "../src/room-access";
import { QUALITY_PRESETS } from "../src/screen-media";

class Track { kind = "video"; readyState = "live"; clone() { return new Track(); } stop() { this.readyState = "ended"; } async applyConstraints() {} }
class Stream extends EventTarget {
  id = randomSecret(); tracks: Track[];
  constructor(tracks: Track[] = []) { super(); this.tracks = [...tracks]; }
  getTracks() { return this.tracks; } getVideoTracks() { return this.tracks; } getAudioTracks() { return []; }
  addTrack(track: Track) { this.tracks.push(track); }
  removeTrack(track: Track) { this.tracks = this.tracks.filter((item) => item !== track); }
}
const media = () => { const stream = new Stream(); stream.addTrack(new Track()); return stream as unknown as MediaStream; };
const localId = "a".repeat(64), friendId = "b".repeat(64);
function harness() {
  const sends: { action: string; data: any; target?: string }[] = [];
  const added: MediaStream[] = [], removed: MediaStream[] = [];
  const actions = new Map<string, any>();
  const room = {
    onPeerJoin: null, onPeerLeave: null, onPeerStream: null,
    makeAction: (action: string) => {
      const handler = { onMessage: null, send: async (data: unknown, options?: { target: string }) => { sends.push({ action, data, target: options?.target }); } };
      actions.set(action, handler); return handler;
    },
    addStream: (stream: MediaStream) => { added.push(stream); return [Promise.resolve()]; },
    removeStream: (stream: MediaStream) => { removed.push(stream); },
    getPeers: () => ({}), leave: async () => undefined,
  } as unknown as Room;
  const message = (action: string, data: unknown, peerId = "peer") => actions.get(action)?.onMessage?.(data, { peerId });
  let revision = 0;
  const presence = (streamId: string | null = null, id = friendId, peerId = "peer") => message("fr-pres", { id, name: "Amigo", streamId, quality: "performance", revision: revision++ }, peerId);
  return { room, sends, added, removed, message, presence };
}
test.beforeEach(() => Object.defineProperty(globalThis, "MediaStream", { value: Stream, configurable: true }));
test.afterEach(() => Reflect.deleteProperty(globalThis, "MediaStream"));

test("envia somente para quem pede e usa uma rota por espectador", async () => {
  const a = harness(), b = harness();
  const session = new FriendsSession(localId, "Eu", [a.room, b.room], () => undefined);
  try {
    a.presence(); b.presence();
    const stream = media(); session.setStream(stream);
    expect(a.added).toHaveLength(0);
    const watchId = randomSecret();
    a.message("fr-watch", { streamId: "wrong", watchId, watching: true });
    expect(a.added).toHaveLength(0);
    const streamId = session.snapshot().streamId;
    a.message("fr-watch", { streamId, watchId, watching: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    a.message("fr-watch", { streamId, watchId, watching: true });
    expect(a.added).toHaveLength(1);
    b.message("fr-watch", { streamId, watchId, watching: true });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(a.removed).toEqual(a.added);
    expect(b.added).toHaveLength(1);
    expect(b.added[0].getTracks()).toEqual(stream.getTracks());
    expect(b.added[0].id).not.toBe(a.added[0].id);
    a.message("fr-watch", { streamId, watchId, watching: false });
    expect(session.snapshot().viewers).toBe(1);
    session.setStream(null);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(b.removed).toEqual(b.added);
    expect(session.snapshot().members).toHaveLength(1);
  } finally { await session.close(); }
});

test("recepção troca de rota, libera clones e volta a assistir quando a tela reinicia", async () => {
  const a = harness(), b = harness();
  const session = new FriendsSession(localId, "Eu", [a.room, b.room], () => undefined);
  try {
    const first = randomSecret(); a.presence(first); b.presence(first);
    session.watch(friendId);
    const request = a.sends.filter((item) => item.action === "fr-watch").at(-1)!.data;
    expect(request).toMatchObject({ streamId: first, watching: true });
    const source = media();
    a.room.onPeerStream?.(source, "peer", { streamId: first, watchId: request.watchId });
    const playback = session.snapshot().members[0].stream!;
    expect(playback).not.toBe(source);
    a.room.onPeerLeave?.("peer");
    expect(playback.getTracks()[0].readyState).toBe("ended");
    expect(source.getTracks()[0].readyState).toBe("live");
    expect(b.sends.filter((item) => item.action === "fr-watch").at(-1)?.data.watching).toBe(true);
    const fallback = b.sends.filter((item) => item.action === "fr-watch").at(-1)!.data;
    b.room.onPeerStream?.(source, "peer", { streamId: first, watchId: fallback.watchId });
    expect(session.snapshot().members[0].stream).not.toBeNull();
    b.presence(null);
    expect(session.snapshot().members[0].stream).toBeNull();
    const next = randomSecret(); b.presence(next);
    expect(b.sends.filter((item) => item.action === "fr-watch").at(-1)?.data.streamId).toBe(next);
    b.room.onPeerStream?.(source, "peer", { streamId: first, watchId: fallback.watchId });
    expect(session.snapshot().members[0].stream).toBeNull();
    session.unwatch(friendId);
    expect(session.snapshot().watching).toEqual([]);
  } finally { await session.close(); }
});

test("limita quatro telas, rejeita presença inválida e ignora eventos depois de sair", async () => {
  const a = harness(); let changes = 0;
  const session = new FriendsSession(localId, "Eu", [a.room], () => changes++);
  a.message("fr-pres", { id: "bad", name: "Amigo", streamId: randomSecret() });
  expect(session.snapshot().members).toEqual([]);
  for (let n = 1; n <= 5; n++) {
    const id = String(n).repeat(64); a.presence(randomSecret(), id, `peer-${n}`);
    if (n <= 4) session.watch(id);
    else expect(() => session.watch(id)).toThrow(/quatro/i);
  }
  expect(session.snapshot().watching).toHaveLength(4);
  const onLatePresence = a.room.onPeerJoin;
  await session.close();
  const before = changes;
  a.presence(randomSecret()); onLatePresence?.("late");
  expect(changes).toBe(before);
  const late = media(); session.setStream(late);
  expect(late.getTracks()[0].readyState).toBe("ended");
  await session.close();
});

test("qualidade ao vivo mantém a identidade da transmissão", async () => {
  const a = harness(); const session = new FriendsSession(localId, "Eu", [a.room], () => undefined);
  try {
    session.setStream(media());
    const id = session.snapshot().streamId;
    await session.setQuality(QUALITY_PRESETS[1]);
    expect(session.snapshot().streamId).toBe(id);
    expect(session.snapshot().quality).toBe("cinema");
  } finally { await session.close(); }
});

test("cancelar assinatura durante addStream pendente não deixa mídia sendo enviada", async () => {
  const a = harness(); const session = new FriendsSession(localId, "Eu", [a.room], () => undefined);
  let release!: () => void;
  const attached: MediaStream[] = [];
  a.room.addStream = (stream) => [new Promise<void>((resolve) => { release = () => { attached.push(stream); resolve(); }; })];
  a.room.removeStream = (stream) => {
    for (let index = attached.length - 1; index >= 0; index--) if (attached[index].getTracks().some((track) => stream.getTracks().includes(track))) attached.splice(index, 1);
  };
  try {
    a.presence(); session.setStream(media());
    const request = { streamId: session.snapshot().streamId, watchId: randomSecret(), watching: true };
    a.message("fr-watch", request);
    await new Promise((resolve) => setTimeout(resolve, 0));
    a.message("fr-watch", { ...request, watching: false });
    release(); await new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.snapshot().viewers).toBe(0);
    expect(attached).toEqual([]);
  } finally { await session.close(); }
});

test("troca de assinatura pendente mantém apenas o envio novo mesmo com as mesmas tracks", async () => {
  const a = harness(); const session = new FriendsSession(localId, "Eu", [a.room], () => undefined);
  const pending: (() => void)[] = [];
  const attached: MediaStream[] = [];
  a.room.addStream = (stream) => [new Promise<void>((resolve) => { pending.push(() => { attached.push(stream); resolve(); }); })];
  a.room.removeStream = (stream) => {
    for (let index = attached.length - 1; index >= 0; index--) if (attached[index].getTracks().some((track) => stream.getTracks().includes(track))) attached.splice(index, 1);
  };
  try {
    a.presence(); session.setStream(media());
    const request = { streamId: session.snapshot().streamId, watchId: randomSecret(), watching: true };
    a.message("fr-watch", request); await new Promise((resolve) => setTimeout(resolve, 0));
    a.message("fr-watch", { ...request, watchId: randomSecret() });
    pending.shift()!(); await new Promise((resolve) => setTimeout(resolve, 0));
    pending.shift()!(); await new Promise((resolve) => setTimeout(resolve, 0));
    expect(attached).toHaveLength(1);
    expect(session.snapshot().viewers).toBe(1);
  } finally { pending.forEach((release) => release()); await session.close(); }
});

test("saída com canal quebrado fecha o transporte e repete leave para limpar o cache", async () => {
  const a = harness(); let closed = false, attempts = 0, cached = true;
  a.room.getPeers = () => closed ? {} : { peer: { close: () => { closed = true; } } as RTCPeerConnection };
  a.room.leave = async () => { attempts++; if (!closed) throw new Error("channel closed"); cached = false; };
  const session = new FriendsSession(localId, "Eu", [a.room], () => undefined);
  await session.close();
  expect(closed).toBe(true); expect(attempts).toBe(2); expect(cached).toBe(false);
});

test("presença recebida não injeta estado interno de reprodução", async () => {
  const a = harness(); const session = new FriendsSession(localId, "Eu", [a.room], () => undefined);
  a.message("fr-pres", { id: friendId, name: "Amigo", streamId: null, quality: "performance", revision: 0,
    playback: { stream: { forged: true }, dispose: "not-a-function" }, receiving: { room: "forged" } });
  expect(session.snapshot().members[0].stream).toBeNull();
  await session.close();
});

test("aviso de rota desaparece quando o participante conecta por outra estratégia", async () => {
  const a = harness(), b = harness(); const session = new FriendsSession(localId, "Eu", [a.room, b.room], () => undefined);
  try {
    session.reportRouteFailure(a.room, "could not connect after exchanging SDP", "peer", "Nostr");
    expect(session.snapshot().connectionNotice).toContain("Reconectando");
    b.presence();
    expect(session.snapshot().connectionNotice).toBe("");
    session.reportRouteFailure(a.room, "could not connect after exchanging SDP", "peer", "Nostr");
    expect(session.snapshot().connectionNotice).toBe("");
  } finally { await session.close(); }
});

test("pedido sem primeiro vídeo muda de rota e rejeita resposta atrasada da anterior", async () => {
  const a = harness(), b = harness(); const session = new FriendsSession(localId, "Eu", [a.room, b.room], () => undefined);
  const originalNow = Date.now;
  try {
    const streamId = randomSecret(); a.presence(streamId); b.presence(streamId);
    session.watch(friendId);
    const original = a.sends.filter((item) => item.action === "fr-watch").at(-1)!.data;
    const now = originalNow(); Date.now = () => now + 16_000;
    await session.retryConnections();
    const fallback = b.sends.filter((item) => item.action === "fr-watch").at(-1)!.data;
    expect(fallback.watching).toBe(true); expect(fallback.watchId).not.toBe(original.watchId);
    expect(a.sends.filter((item) => item.action === "fr-watch").at(-1)!.data.watching).toBe(false);
    a.room.onPeerStream?.(media(), "peer", { streamId, watchId: original.watchId });
    expect(session.snapshot().members[0].stream).toBeNull();
    b.room.onPeerStream?.(media(), "peer", { streamId, watchId: fallback.watchId });
    expect(session.snapshot().members[0].stream?.getVideoTracks()).toHaveLength(1);
    const requestCount = b.sends.length;
    Date.now = () => now + 40_000; await session.retryConnections();
    expect(b.sends.length).toBe(requestCount);
  } finally { Date.now = originalNow; await session.close(); }
});

test("redescoberta reinicia apenas a rota vazia e preserva vídeo de quem já conectou", async () => {
  const a = harness(), b = harness(), replacement = harness(); let restarts = 0, healthyLeaves = 0;
  const oldLeave = a.room.leave; a.room.leave = async () => { healthyLeaves++; await oldLeave(); };
  const session = new FriendsSession(localId, "Eu", [a.room, b.room], () => undefined, (room) => {
    expect(room).toBe(b.room); restarts++; return replacement.room;
  });
  try {
    const streamId = randomSecret(); a.presence(streamId); session.watch(friendId);
    const request = a.sends.filter((item) => item.action === "fr-watch").at(-1)!.data;
    a.room.onPeerStream?.(media(), "peer", { streamId, watchId: request.watchId });
    const playback = session.snapshot().members[0].stream;
    session.reportRouteFailure(b.room, "could not connect", "missing-peer", "MQTT");
    session.reportRouteFailure(a.room, "could not connect", "other-peer", "Nostr");
    await session.retryConnections(true);
    expect(restarts).toBe(1); expect(healthyLeaves).toBe(0);
    expect(session.snapshot().members[0].stream).toBe(playback);
    expect(playback?.getTracks()[0].readyState).toBe("live");
    replacement.presence(null, "c".repeat(64), "missing-peer");
    expect(session.snapshot().members).toHaveLength(2);
  } finally { await session.close(); }
});

test("recuperação pendente não reabre sala depois que o usuário sai", async () => {
  const a = harness(); let release!: () => void, attempts = 0, restarts = 0;
  a.room.leave = async () => { if (attempts++ === 0) await new Promise<void>((resolve) => { release = resolve; }); };
  const session = new FriendsSession(localId, "Eu", [a.room], () => undefined, () => { restarts++; return harness().room; });
  session.reportRouteFailure(a.room, "could not connect", "peer", "Nostr");
  const recovering = session.retryConnections(true);
  await session.close(); release(); await recovering;
  expect(restarts).toBe(0);
});

test("reinicia ICE só no transporte interrompido e trata convite errado separadamente", async () => {
  const a = harness(); let badRestarts = 0, healthyRestarts = 0, discoveryRestarts = 0;
  const connections = {
    bad: { connectionState: "disconnected", restartIce: () => badRestarts++, close: () => undefined } as RTCPeerConnection,
    healthy: { connectionState: "connected", restartIce: () => healthyRestarts++, close: () => undefined } as RTCPeerConnection,
  };
  a.room.getPeers = () => connections;
  const session = new FriendsSession(localId, "Eu", [a.room], () => undefined, () => { discoveryRestarts++; return harness().room; });
  try {
    await session.retryConnections(true); await session.retryConnections(true);
    expect(badRestarts).toBe(1); expect(healthyRestarts).toBe(0);
    session.reportRouteFailure(a.room, "incorrect room password when decrypting offer", "unknown", "Nostr");
    expect(session.snapshot().connectionNotice).toContain("convite");
    await session.retryConnections(true); expect(discoveryRestarts).toBe(0);
  } finally { await session.close(); }
});

test("presença durante leave não publica rota encerrando nem restaura aviso já resolvido", async () => {
  const a = harness(), b = harness(), replacement = harness();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  a.room.leave = () => pending;
  const session = new FriendsSession(localId, "Eu", [a.room, b.room], () => undefined, () => replacement.room);
  try {
    session.reportRouteFailure(a.room, "could not connect after exchanging SDP", "peer", "Nostr");
    const retry = session.retryConnections(true);
    a.presence();
    expect(session.snapshot().members).toHaveLength(0);
    b.presence();
    expect(session.snapshot().members).toHaveLength(1);
    expect(session.snapshot().connectionNotice).toBe("");
    release(); await retry;
    expect(session.snapshot().connectionNotice).toBe("");
    expect(session.snapshot().members[0].connected).toBe(true);
  } finally { release(); await session.close(); }
});
