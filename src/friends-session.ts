import type { MessageAction, Room } from "trystero";
import { createPlaybackStream } from "./playback-stream";
import { isSecret, randomSecret } from "./room-access";
import { cleanName } from "./saved-rooms";
import { configureVideoSender, QUALITY_PRESETS, type QualityKey, type QualityPreset } from "./screen-media";

interface Presence { id: string; name: string; streamId: string | null; quality: QualityKey; revision: number }
interface Peer extends Presence {
  peerId: string;
  routes: Map<Room, string>;
  receiving?: { room: Room; streamId: string; watchId: string };
  playback?: ReturnType<typeof createPlaybackStream>;
}
export interface FriendMember extends Presence { connected: boolean; stream: MediaStream | null }
export interface FriendsSnapshot {
  members: FriendMember[]; watching: string[]; viewers: number;
  streamId: string | null; quality: QualityKey; error: string;
}

export class FriendsSession {
  private closed = false;
  private peers = new Map<string, Peer>();
  private watching = new Set<string>();
  private subscribers = new Map<string, { room: Room; peerId: string; stream: MediaStream; watchId: string }>();
  private actions = new Map<Room, { presence: MessageAction; watch: MessageAction }>();
  private stream: MediaStream | null = null;
  private streamId: string | null = null;
  private quality = QUALITY_PRESETS[0];
  private revision = 0;
  private error = "";
  private heartbeat: ReturnType<typeof setInterval>;
  private leaving: Promise<void> | null = null;

  constructor(private id: string, private name: string, private rooms: Room[], private onChange: (state: FriendsSnapshot) => void) {
    for (const room of rooms) {
      const presence = room.makeAction("fr-pres"), watch = room.makeAction("fr-watch");
      this.actions.set(room, { presence, watch });
      room.onPeerJoin = (peerId) => { if (!this.closed) this.announce(room, peerId); };
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
        this.emit();
      };
    }
    this.heartbeat = setInterval(() => {
      if (this.closed) return;
      rooms.forEach((room) => this.announce(room));
      this.peers.forEach((peer) => this.subscribe(peer));
    }, 5_000);
  }

  snapshot(): FriendsSnapshot {
    return {
      members: [...this.peers.values()].map(({ id, name, streamId, quality, revision, routes, playback }) => ({
        id, name, streamId, quality, revision, connected: routes.size > 0, stream: playback?.stream ?? null,
      })),
      watching: [...this.watching], viewers: this.subscribers.size, streamId: this.streamId, quality: this.quality.key, error: this.error,
    };
  }

  private emit() { if (!this.closed) this.onChange(this.snapshot()); }
  private findPeer(room: Room, peerId: string) {
    return [...this.peers.values()].find((peer) => peer.routes.get(room) === peerId);
  }
  private announce(room: Room, peerId?: string) {
    void this.actions.get(room)?.presence.send({ id: this.id, name: this.name, streamId: this.streamId,
      quality: this.quality.key, revision: this.revision }, peerId ? { target: peerId } : undefined).catch(() => undefined);
  }

  private presence(room: Room, peerId: string, input: unknown) {
    if (this.closed || !input || typeof input !== "object") return;
    const data = input as Presence;
    if (!isSecret(data.id) || data.id === this.id || typeof data.name !== "string" || !data.name ||
      data.name.length > 48 || data.name !== cleanName(data.name) || (data.streamId !== null && !isSecret(data.streamId)) ||
      !QUALITY_PRESETS.some((preset) => preset.key === data.quality) || !Number.isSafeInteger(data.revision) || data.revision < 0) return;
    let peer = this.peers.get(data.id);
    if (!peer) {
      peer = { ...data, peerId, routes: new Map() };
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
    if (!peer.receiving) {
      const room = peer.routes.keys().next().value as Room | undefined;
      if (!room) return;
      peer.receiving = { room, streamId: peer.streamId, watchId: randomSecret() };
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
      if (previous?.room === room && previous.watchId === data.watchId) { room.removeStream(previous.stream, { target: peerId }); this.subscribers.delete(peer.id); this.emit(); }
      return;
    }
    if (previous?.room === room && previous.peerId === peerId && previous.watchId === data.watchId) return;
    if (previous) previous.room.removeStream(previous.stream, { target: previous.peerId });
    // A fresh stream identity avoids Trystero returning an empty cached stream on rewatch.
    const delivery = new MediaStream(this.stream.getTracks());
    const subscription = { room, peerId, stream: delivery, watchId: data.watchId };
    this.subscribers.set(peer.id, subscription);
    const stream = this.stream;
    void Promise.all(room.addStream(delivery, { target: peerId, metadata: { streamId: this.streamId, watchId: data.watchId } })).then(async () => {
      if (this.closed || this.stream !== stream || this.subscribers.get(peer.id) !== subscription) return;
      const pc = room.getPeers()[peerId];
      if (pc) await configureVideoSender(pc, this.quality);
    }).catch(() => {
      if (this.closed || this.stream !== stream || this.subscribers.get(peer.id) !== subscription) return;
      this.subscribers.delete(peer.id);
      this.error = "Uma tela não conectou. A conexão será tentada novamente; verifique as permissões de rede se continuar.";
      this.emit();
    });
    this.emit();
  }

  setStream(stream: MediaStream | null) {
    if (this.closed) { stream?.getTracks().forEach((track) => track.stop()); return; }
    for (const { room, peerId, stream: delivery } of this.subscribers.values()) room.removeStream(delivery, { target: peerId });
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
    this.leaving = Promise.allSettled(this.rooms.map((room) => room.leave())).then(() => undefined);
    return this.leaving;
  }
}
