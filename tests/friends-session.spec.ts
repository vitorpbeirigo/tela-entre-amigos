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
    await Promise.resolve();
    a.message("fr-watch", { streamId, watchId, watching: true });
    expect(a.added).toHaveLength(1);
    b.message("fr-watch", { streamId, watchId, watching: true });
    expect(a.removed).toEqual(a.added);
    expect(b.added).toHaveLength(1);
    expect(b.added[0].getTracks()).toEqual(stream.getTracks());
    expect(b.added[0].id).not.toBe(a.added[0].id);
    a.message("fr-watch", { streamId, watchId, watching: false });
    expect(session.snapshot().viewers).toBe(1);
    session.setStream(null);
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
