import type { MessageAction, Room } from "trystero";
import { createPlaybackStream } from "./playback-stream";
import { isSecret, randomSecret } from "./room-access";
import { cleanName } from "./saved-rooms";
import { configureVideoSender, QUALITY_PRESETS, type QualityKey, type QualityPreset } from "./screen-media";

interface Presence { id: string; name: string; streamId: string | null; quality: QualityKey; revision: number }
interface Peer extends Presence {
  peerId: string;
  routes: Map<Room, string>;
  receiving?: { room: Room; streamId: string; watchId: string; startedAt: number };
  playback?: ReturnType<typeof createPlaybackStream>;
}
export interface FriendMember extends Presence { connected: boolean; stream: MediaStream | null }
export interface FriendsSnapshot {
  members: FriendMember[]; watching: string[]; viewers: number;
  streamId: string | null; quality: QualityKey; error: string; connectionNotice: string;
}

interface RouteFailure { kind: "password" | "direct" | "discovery"; peerId: string; strategy: string; nextRetryAt: number; attempts: number }

export class FriendsSession {
  private closed = false;
  private peers = new Map<string, Peer>();
  private watching = new Set<string>();
  private subscribers = new Map<string, { room: Room; peerId: string; stream: MediaStream; watchId: string }>();
  private mediaQueue = new Map<string, Promise<void>>();
  private actions = new Map<Room, { presence: MessageAction; watch: MessageAction }>();
  private stream: MediaStream | null = null;
  private streamId: string | null = null;
  private quality = QUALITY_PRESETS[0];
  private revision = 0;
  private error = "";
  private heartbeat: ReturnType<typeof setInterval>;
  private leaving: Promise<void> | null = null;
  private failures = new Map<Room, RouteFailure>();
  private recovering = new Set<Room>();
  private iceRestarts = new WeakMap<RTCPeerConnection, number>();

  constructor(private id: string, private name: string, private rooms: Room[], private onChange: (state: FriendsSnapshot) => void,
    private reopen?: (room: Room) => Room) {
    rooms.forEach((room) => this.bindRoom(room));
    this.heartbeat = setInterval(() => {
      if (this.closed) return;
      this.rooms.forEach((room) => this.announce(room));
      void this.retryConnections();
    }, 5_000);
  }

  private bindRoom(room: Room) {
      const presence = room.makeAction("fr-pres"), watch = room.makeAction("fr-watch");
      this.actions.set(room, { presence, watch });
      room.onPeerJoin = (peerId) => { if (!this.closed && !this.recovering.has(room)) this.announce(room, peerId); };
      room.onPeerLeave = (peerId) => this.peerLeft(room, peerId);
      presence.onMessage = (data, { peerId }) => this.presence(room, peerId, data);
      watch.onMessage = (data, { peerId }) => this.request(room, peerId, data);
      room.onPeerStream = (source, peerId, metadata) => {
        if (this.closed) return;
        const peer = this.findPeer(room, peerId);
        const info = metadata as { streamId?: unknown; watchId?: unknown } | null;
        if (!peer || !this.watching.has(peer.id) || peer.receiving?.room !== room ||
          info?.streamId !== peer.streamId || info?.watchId !== peer.receiving.watchId) return;
        peer.playback?.dispose();
        peer.playback = createPlaybackStream(source);
        this.error = "";
        this.emit();
      };
      this.announce(room);
  }

  snapshot(): FriendsSnapshot {
    return {
      members: [...this.peers.values()].map(({ id, name, streamId, quality, revision, routes, playback }) => ({
        id, name, streamId, quality, revision, connected: routes.size > 0, stream: playback?.stream ?? null,
      })),
      watching: [...this.watching], viewers: this.subscribers.size, streamId: this.streamId, quality: this.quality.key, error: this.error,
      connectionNotice: [...this.failures.values()].some((failure) => failure.kind === "password")
        ? "O convite de um participante não corresponde ao desta sala. Importe o convite atual do grupo."
        : this.failures.size ? "Reconectando um participante automaticamente. Quem já conectou continua na sala." : "",
    };
  }

  private emit() { if (!this.closed) this.onChange(this.snapshot()); }
  private log(event: string, details: Record<string, string | number | boolean>) {
    if (typeof window !== "undefined") window.telaDesktop?.logEvent?.(event, details);
  }

  reportRouteFailure(room: Room, error: string, peerId: string, strategy: string) {
    if (this.closed || !this.actions.has(room)) return;
    if ([...this.peers.values()].some((peer) => peer.peerId === peerId && peer.routes.size > 0)) return;
    const kind = /password/i.test(error) ? "password" : /could not connect|exchanging SDP/i.test(error) ? "direct" : "discovery";
    const previous = this.failures.get(room);
    this.failures.set(room, { kind, peerId, strategy, attempts: previous?.attempts ?? 0,
      nextRetryAt: previous?.nextRetryAt ?? Date.now() + 5_000 });
    this.log("friends-route-failed", { strategy, reason: kind, peer: peerId.slice(0, 8) });
    this.emit();
  }

  async retryConnections(force = false) {
    if (this.closed) return;
    const now = Date.now();
    const connections = new Set(this.rooms.flatMap((room) => Object.values(room.getPeers())));
    for (const pc of connections) {
      if (!["disconnected", "failed"].includes(pc.connectionState) || now - (this.iceRestarts.get(pc) ?? 0) < 10_000) continue;
      this.iceRestarts.set(pc, now);
      try { pc.restartIce(); this.log("friends-ice-retry", { state: pc.connectionState }); } catch { /* Discovery can still rebuild a closed transport. */ }
    }
    this.peers.forEach((peer) => this.subscribe(peer));
    await Promise.all([...this.failures.entries()].map(async ([room, failure]) => {
      if (!this.reopen || failure.kind === "password" || this.recovering.has(room) || (!force && now < failure.nextRetryAt)) return;
      if ([...this.peers.values()].some((peer) => peer.routes.has(room)) || Object.keys(room.getPeers()).length > 0) return;
      this.recovering.add(room);
      failure.nextRetryAt = now + Math.min(30_000 * (failure.attempts + 1), 60_000);
      try {
        await this.leaveRoute(room);
        if (this.closed) return;
        const index = this.rooms.indexOf(room);
        if (index < 0) return;
        const remainingFailure = this.failures.get(room);
        const replacement = this.reopen(room);
        room.onPeerJoin = null; room.onPeerLeave = null; room.onPeerStream = null;
        const actions = this.actions.get(room);
        if (actions) { actions.presence.onMessage = null; actions.watch.onMessage = null; }
        this.actions.delete(room); this.failures.delete(room);
        this.rooms[index] = replacement;
        this.bindRoom(replacement);
        if (remainingFailure) this.failures.set(replacement, { ...remainingFailure, attempts: remainingFailure.attempts + 1 });
        this.log("friends-discovery-retry", { strategy: failure.strategy, attempt: failure.attempts + 1 });
        this.emit();
      } catch { this.log("friends-discovery-retry-failed", { strategy: failure.strategy }); }
      finally { this.recovering.delete(room); }
    }));
  }

  private async leaveRoute(room: Room) {
    try { await room.leave(); }
    catch {
      Object.values(room.getPeers()).forEach((connection) => connection.close());
      await room.leave();
    }
  }
  private queueMedia(peerId: string, operation: () => Promise<void> | void) {
    const next = (this.mediaQueue.get(peerId) ?? Promise.resolve()).then(operation).catch(() => {
      if (!this.closed) {
        this.error = "Uma tela não conectou. Tente assistir novamente e confira as permissões de rede se continuar.";
        this.emit();
      }
    });
    this.mediaQueue.set(peerId, next);
    void next.then(() => { if (this.mediaQueue.get(peerId) === next) this.mediaQueue.delete(peerId); });
  }
  private findPeer(room: Room, peerId: string) {
    return [...this.peers.values()].find((peer) => peer.routes.get(room) === peerId);
  }
  private announce(room: Room, peerId?: string) {
    void this.actions.get(room)?.presence.send({ id: this.id, name: this.name, streamId: this.streamId,
      quality: this.quality.key, revision: this.revision }, peerId ? { target: peerId } : undefined).catch(() => undefined);
  }

  private presence(room: Room, peerId: string, input: unknown) {
    if (this.closed || this.recovering.has(room) || !this.actions.has(room) || !input || typeof input !== "object") return;
    const data = input as Presence;
    if (!isSecret(data.id) || data.id === this.id || typeof data.name !== "string" || !data.name ||
      data.name.length > 48 || data.name !== cleanName(data.name) || (data.streamId !== null && !isSecret(data.streamId)) ||
      !QUALITY_PRESETS.some((preset) => preset.key === data.quality) || !Number.isSafeInteger(data.revision) || data.revision < 0) return;
    for (const [failedRoom, failure] of this.failures) if (failure.peerId === peerId || !failure.peerId) this.failures.delete(failedRoom);
    let peer = this.peers.get(data.id);
    if (!peer) {
      peer = { id: data.id, name: data.name, streamId: data.streamId, quality: data.quality,
        revision: data.revision, peerId, routes: new Map() };
      this.peers.set(data.id, peer);
    }
    if (peer.peerId !== peerId) {
      peer.playback?.dispose(); peer.playback = undefined; peer.receiving = undefined;
      peer.routes.clear(); peer.peerId = peerId; peer.revision = -1;
    }
    peer.routes.set(room, peerId);
    if (data.revision >= peer.revision) {
      if (peer.streamId !== data.streamId) {
        peer.playback?.dispose(); peer.playback = undefined; peer.receiving = undefined;
      }
      peer.name = data.name; peer.streamId = data.streamId; peer.quality = data.quality; peer.revision = data.revision;
    }
    this.subscribe(peer);
    this.emit();
  }

  watch(id: string) {
    if (this.closed) return;
    if (!this.watching.has(id) && this.watching.size >= 4) throw new Error("Você pode assistir a até quatro telas. Feche uma para abrir outra.");
    const peer = this.peers.get(id);
    if (!peer?.streamId || !peer.routes.size) return;
    this.watching.add(id);
    this.subscribe(peer);
    this.emit();
  }

  private subscribe(peer: Peer) {
    if (this.closed || !this.watching.has(peer.id) || !peer.streamId) return;
    if (peer.playback?.stream.getVideoTracks().some((track) => track.readyState === "live" && !track.muted)) return;
    if (peer.receiving && Date.now() - peer.receiving.startedAt >= 15_000) {
      const previous = peer.receiving;
      const candidates = [...peer.routes.keys()];
      const nextRoom = candidates[(candidates.indexOf(previous.room) + 1) % candidates.length];
      if (!nextRoom) return;
      void this.actions.get(previous.room)?.watch.send({ streamId: previous.streamId, watchId: previous.watchId, watching: false },
        { target: peer.peerId }).catch(() => undefined);
      peer.playback?.dispose(); peer.playback = undefined;
      peer.receiving = { room: nextRoom, streamId: peer.streamId, watchId: randomSecret(), startedAt: Date.now() };
      this.log("friends-video-route-retry", { peer: peer.peerId.slice(0, 8), alternate: nextRoom !== previous.room });
      this.emit();
    }
    if (!peer.receiving) {
      const room = peer.routes.keys().next().value as Room | undefined;
      if (!room) return;
      peer.receiving = { room, streamId: peer.streamId, watchId: randomSecret(), startedAt: Date.now() };
    }
    const room = peer.receiving.room;
    void this.actions.get(room)?.watch.send({ streamId: peer.streamId, watchId: peer.receiving.watchId, watching: true }, { target: peer.peerId }).catch(() => undefined);
  }

  unwatch(id: string) {
    if (this.closed) return;
    this.watching.delete(id);
    const peer = this.peers.get(id);
    if (peer) {
      if (peer.receiving) void this.actions.get(peer.receiving.room)?.watch.send({ streamId: peer.receiving.streamId, watchId: peer.receiving.watchId, watching: false },
        { target: peer.peerId }).catch(() => undefined);
      peer.playback?.dispose(); peer.playback = undefined; peer.receiving = undefined;
      if (!peer.routes.size) this.peers.delete(id);
    }
    this.emit();
  }

  private request(room: Room, peerId: string, input: unknown) {
    if (this.closed || !this.stream || !input || typeof input !== "object") return;
    const data = input as { streamId: unknown; watching: unknown; watchId: unknown };
    const peer = this.findPeer(room, peerId);
    if (!peer || data.streamId !== this.streamId || typeof data.watching !== "boolean" || !isSecret(data.watchId)) return;
    const previous = this.subscribers.get(peer.id);
    if (!data.watching) {
      if (previous?.room === room && previous.watchId === data.watchId) {
        this.subscribers.delete(peer.id);
        this.queueMedia(peerId, () => room.removeStream(previous.stream, { target: peerId }));
        this.emit();
      }
      return;
    }
    if (previous?.room === room && previous.peerId === peerId && previous.watchId === data.watchId) return;
    // A fresh stream identity avoids Trystero returning an empty cached stream on rewatch.
    const delivery = new MediaStream(this.stream.getTracks());
    const subscription = { room, peerId, stream: delivery, watchId: data.watchId };
    this.subscribers.set(peer.id, subscription);
    const stream = this.stream;
    const streamId = this.streamId;
    // Routes can share one PC; serialize track operations before attaching a replacement.
    this.queueMedia(peerId, async () => {
      if (previous) previous.room.removeStream(previous.stream, { target: previous.peerId });
      if (this.closed || this.stream !== stream || this.subscribers.get(peer.id) !== subscription) return;
      try {
        await Promise.all(room.addStream(delivery, { target: peerId, metadata: { streamId, watchId: subscription.watchId } }));
        if (this.closed || this.stream !== stream || this.subscribers.get(peer.id) !== subscription) {
          room.removeStream(delivery, { target: peerId });
          return;
        }
        const pc = room.getPeers()[peerId];
        if (pc) await configureVideoSender(pc, this.quality);
      } catch (error) {
        room.removeStream(delivery, { target: peerId });
        if (this.subscribers.get(peer.id) === subscription) this.subscribers.delete(peer.id);
        throw error;
      }
    });
    this.emit();
  }

  setStream(stream: MediaStream | null) {
    if (this.closed) { stream?.getTracks().forEach((track) => track.stop()); return; }
    for (const { room, peerId, stream: delivery } of this.subscribers.values()) this.queueMedia(peerId, () => room.removeStream(delivery, { target: peerId }));
    this.subscribers.clear();
    this.stream = stream; this.streamId = stream ? randomSecret() : null; this.revision++;
    this.rooms.forEach((room) => this.announce(room));
    this.emit();
  }

  async setQuality(preset: QualityPreset) {
    if (this.closed) return;
    const stream = this.stream;
    const track = stream?.getVideoTracks()[0];
    if (track) await track.applyConstraints({ width: { ideal: preset.width, max: preset.width },
      height: { ideal: preset.height, max: preset.height }, frameRate: { ideal: preset.frameRate, max: preset.frameRate } });
    if (this.closed || this.stream !== stream) return;
    this.quality = preset; this.revision++;
    await Promise.all([...this.subscribers.values()].map(({ room, peerId }) => {
      const pc = room.getPeers()[peerId]; return pc ? configureVideoSender(pc, preset) : undefined;
    }));
    this.rooms.forEach((room) => this.announce(room)); this.emit();
  }

  private peerLeft(room: Room, peerId: string) {
    if (this.closed) return;
    const peer = this.findPeer(room, peerId);
    if (!peer) return;
    peer.routes.delete(room);
    if (this.subscribers.get(peer.id)?.room === room) this.subscribers.delete(peer.id);
    if (peer.receiving?.room === room) {
      peer.playback?.dispose(); peer.playback = undefined; peer.receiving = undefined;
      this.subscribe(peer);
    }
    if (!peer.routes.size && !this.watching.has(peer.id)) this.peers.delete(peer.id);
    this.emit();
  }

  close(): Promise<void> {
    if (this.leaving) return this.leaving;
    this.setStream(null);
    this.closed = true; clearInterval(this.heartbeat);
    this.peers.forEach((peer) => peer.playback?.dispose());
    this.peers.clear(); this.watching.clear();
    for (const room of this.rooms) {
      room.onPeerJoin = null; room.onPeerLeave = null; room.onPeerStream = null;
      const actions = this.actions.get(room)!;
      actions.presence.onMessage = null; actions.watch.onMessage = null;
    }
    const connections = new Set(this.rooms.flatMap((room) => Object.values(room.getPeers())));
    this.failures.clear();
    this.leaving = Promise.allSettled(this.rooms.map((room) => this.leaveRoute(room)))
      .then(() => { connections.forEach((connection) => connection.close()); });
    return this.leaving;
  }
}
