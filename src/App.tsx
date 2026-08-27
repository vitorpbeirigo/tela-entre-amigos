import {
  ArrowLeft,
  Check,
  ChevronRight,
  Clipboard,
  Copy,
  Download,
  Eye,
  EyeOff,
  Expand,
  Headphones,
  Link2,
  LoaderCircle,
  MonitorUp,
  Radio,
  RefreshCw,
  ScreenShare,
  ScreenShareOff,
  ShieldCheck,
  Sparkles,
  Users,
  Volume2,
  VolumeX,
  Wifi,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  getRelaySockets as getNostrRelaySockets,
  joinRoom as joinNostrRoom,
  type Room,
} from "trystero";
import {
  getRelaySockets as getMqttRelaySockets,
  joinRoom as joinMqttRoom,
} from "@trystero-p2p/mqtt";

type View = "home" | "host-setup" | "host-live" | "viewer-join" | "viewer-live";
type Role = "host" | "viewer";
type QualityKey = "performance" | "cinema" | "smooth" | "extreme";

interface QualityPreset {
  key: QualityKey;
  label: string;
  detail: string;
  width: number;
  height: number;
  frameRate: number;
  maxBitrate: number;
}

interface ConnectionStats {
  bitrate: string;
  resolution: string;
  fps: string;
  latency: string;
}

const QUALITY_PRESETS: QualityPreset[] = [
  {
    key: "performance",
    label: "Jogar",
    detail: "720p · 30 FPS · 4 Mbps · menor uso da GPU",
    width: 1280,
    height: 720,
    frameRate: 30,
    maxBitrate: 4_000_000,
  },
  {
    key: "cinema",
    label: "Cinema",
    detail: "1080p · 30 FPS · 10 Mbps",
    width: 1920,
    height: 1080,
    frameRate: 30,
    maxBitrate: 10_000_000,
  },
  {
    key: "smooth",
    label: "Suave",
    detail: "1080p · 60 FPS · 15 Mbps",
    width: 1920,
    height: 1080,
    frameRate: 60,
    maxBitrate: 15_000_000,
  },
  {
    key: "extreme",
    label: "Extrema",
    detail: "1440p · 60 FPS · 24 Mbps",
    width: 2560,
    height: 1440,
    frameRate: 60,
    maxBitrate: 24_000_000,
  },
];

const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TRYSTERO_APP_ID = "com.gregpreto.tela.p2p.v1";
const CONNECTION_TIMEOUT_MS = 20_000;
const PARTICLE_COLORS = ["#8052ff", "#ffb829", "#15846e", "#b96cff", "#5d8dff", "#ff5caa"];
const FILTERED_AUDIO_WORKLET = `
class TelaPcmQueueProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.offset = 0;
    this.queuedSamples = 0;
    this.port.onmessage = ({ data }) => {
      if (!(data instanceof Float32Array) || data.length === 0) return;
      if (this.queuedSamples > 384000) {
        this.queue = [];
        this.offset = 0;
        this.queuedSamples = 0;
      }
      this.queue.push(data);
      this.queuedSamples += data.length;
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length < 2) return true;
    const left = output[0];
    const right = output[1];
    let outputFrame = 0;

    while (outputFrame < left.length && this.queue.length > 0) {
      const samples = this.queue[0];
      const availableFrames = Math.floor((samples.length - this.offset) / 2);
      const framesToCopy = Math.min(left.length - outputFrame, availableFrames);
      for (let frame = 0; frame < framesToCopy; frame += 1) {
        const sampleIndex = this.offset + frame * 2;
        left[outputFrame + frame] = samples[sampleIndex];
        right[outputFrame + frame] = samples[sampleIndex + 1];
      }
      outputFrame += framesToCopy;
      this.offset += framesToCopy * 2;
      this.queuedSamples -= framesToCopy * 2;
      if (this.offset >= samples.length) {
        this.queue.shift();
        this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("tela-pcm-queue", TelaPcmQueueProcessor);
`;

function seededValue(index: number, salt: number) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

const CONSTELLATION_PARTICLES = Array.from({ length: 180 }, (_, index) => {
  const lobe = index % 2 === 0 ? -1 : 1;
  const angle = seededValue(index, 1) * Math.PI * 2;
  const radius = Math.sqrt(seededValue(index, 2));
  const x = 50 + lobe * 16 + Math.cos(angle) * 29 * radius + lobe * (1 - radius) * 3;
  const y = 49 + Math.sin(angle) * 32 * radius + Math.cos(angle * 2) * 2.5;

  return {
    x,
    y,
    size: 4 + seededValue(index, 3) * 7,
    rotation: Math.round(seededValue(index, 4) * 360),
    color: PARTICLE_COLORS[index % PARTICLE_COLORS.length],
    delay: seededValue(index, 5) * -8,
    duration: 5 + seededValue(index, 6) * 6,
    opacity: 0.35 + seededValue(index, 7) * 0.65,
  };
});

const AMBIENT_PARTICLES = Array.from({ length: 28 }, (_, index) => ({
  x: seededValue(index, 21) * 100,
  y: seededValue(index, 22) * 100,
  size: 4 + seededValue(index, 23) * 5,
  rotation: Math.round(seededValue(index, 24) * 360),
  color: PARTICLE_COLORS[(index + 2) % PARTICLE_COLORS.length],
  delay: seededValue(index, 25) * -10,
  duration: 8 + seededValue(index, 26) * 8,
  opacity: 0.12 + seededValue(index, 27) * 0.24,
}));

function generateRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const raw = Array.from(bytes, (byte) => ROOM_ALPHABET[byte % ROOM_ALPHABET.length]).join("");
  return raw.match(/.{1,5}/g)!.join("-");
}

function normalizeRoomCode(value: string) {
  const raw = value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 20);
  return raw.match(/.{1,5}/g)?.join("-") ?? raw;
}

function formatBitrate(bitsPerSecond: number) {
  if (!Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) return "—";
  return `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbps`;
}

function App() {
  const [view, setView] = useState<View>("home");
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [qualityKey, setQualityKey] = useState<QualityKey>("performance");
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [connectionState, setConnectionState] = useState("Preparando");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [version, setVersion] = useState("0.7.0");
  const [platform, setPlatform] = useState<NodeJS.Platform | "">("");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [viewerVolume, setViewerVolume] = useState(1);
  const [showLocalPreview, setShowLocalPreview] = useState(false);
  const [stats, setStats] = useState<ConnectionStats>({
    bitrate: "—",
    resolution: "—",
    fps: "—",
    latency: "—",
  });

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const viewerStageRef = useRef<HTMLDivElement>(null);
  const previousViewerVolumeRef = useRef(1);
  const roomRefs = useRef<Room[]>([]);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const viewerRoomsRef = useRef(new Map<string, Room>());
  const hostSessionRef = useRef<{ peerId: string; room: Room } | null>(null);
  const connectionErrorsRef = useRef(new Set<string>());
  const connectionTimeoutRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioWorkletRef = useRef<AudioWorkletNode | null>(null);
  const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const audioPcmUnsubscribeRef = useRef<(() => void) | null>(null);
  const audioStatusUnsubscribeRef = useRef<(() => void) | null>(null);

  const quality = useMemo(
    () => QUALITY_PRESETS.find((preset) => preset.key === qualityKey) ?? QUALITY_PRESETS[0],
    [qualityKey],
  );

  useEffect(() => {
    window.telaDesktop?.getVersion().then(setVersion).catch(() => undefined);
    window.telaDesktop?.getPlatform().then(setPlatform).catch(() => undefined);
    return window.telaDesktop?.onUpdateStatus?.(setUpdateStatus);
  }, []);

  useEffect(() => {
    if (!localVideoRef.current) return;
    localVideoRef.current.srcObject = showLocalPreview ? localStream : null;
  }, [localStream, showLocalPreview, view]);

  useEffect(() => {
    if (!remoteVideoRef.current) return;
    remoteVideoRef.current.srcObject = remoteStream;
    remoteVideoRef.current.volume = viewerVolume;
    remoteVideoRef.current.muted = viewerVolume === 0;
  }, [remoteStream, view, viewerVolume]);

  const changeViewerVolume = useCallback((nextVolume: number) => {
    const normalizedVolume = Math.min(1, Math.max(0, nextVolume));
    if (normalizedVolume > 0) previousViewerVolumeRef.current = normalizedVolume;
    setViewerVolume(normalizedVolume);
  }, []);

  const toggleViewerMute = useCallback(() => {
    setViewerVolume((currentVolume) => {
      if (currentVolume > 0) {
        previousViewerVolumeRef.current = currentVolume;
        return 0;
      }
      return previousViewerVolumeRef.current || 1;
    });
  }, []);

  const stopFilteredAudio = useCallback(() => {
    audioPcmUnsubscribeRef.current?.();
    audioPcmUnsubscribeRef.current = null;
    audioStatusUnsubscribeRef.current?.();
    audioStatusUnsubscribeRef.current = null;
    audioDestinationRef.current?.stream.getTracks().forEach((track) => track.stop());
    audioDestinationRef.current = null;
    audioWorkletRef.current?.disconnect();
    audioWorkletRef.current = null;
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") void context.close();
    void window.telaDesktop.stopDiscordFilteredAudio().catch(() => undefined);
  }, []);

  const createFilteredAudioTrack = useCallback(async () => {
    if (platform !== "win32") {
      throw new Error("O modo automático sem Discord está disponível apenas no Windows.");
    }

    const context = new AudioContext({ sampleRate: 48_000, latencyHint: "interactive" });
    audioContextRef.current = context;
    const moduleUrl = URL.createObjectURL(new Blob([FILTERED_AUDIO_WORKLET], { type: "text/javascript" }));
    try {
      await context.audioWorklet.addModule(moduleUrl);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }

    const worklet = new AudioWorkletNode(context, "tela-pcm-queue", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    const destination = context.createMediaStreamDestination();
    worklet.connect(destination);
    audioWorkletRef.current = worklet;
    audioDestinationRef.current = destination;

    let remainder = new Uint8Array(0);
    audioPcmUnsubscribeRef.current = window.telaDesktop.onAudioPcm((chunk) => {
      const incoming = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      const bytes = remainder.length ? new Uint8Array(remainder.length + incoming.length) : incoming;
      if (remainder.length) {
        bytes.set(remainder);
        bytes.set(incoming, remainder.length);
      }
      const usableBytes = bytes.length - (bytes.length % 4);
      remainder = usableBytes < bytes.length ? bytes.slice(usableBytes) : new Uint8Array(0);
      if (usableBytes === 0) return;

      const view = new DataView(bytes.buffer, bytes.byteOffset, usableBytes);
      const samples = new Float32Array(usableBytes / 2);
      for (let index = 0; index < samples.length; index += 1) {
        samples[index] = view.getInt16(index * 2, true) / 32_768;
      }
      worklet.port.postMessage(samples, [samples.buffer]);
    });
    audioStatusUnsubscribeRef.current = window.telaDesktop.onAudioStatus((status) => {
      if (status.state === "error") {
        setError("A captura de áudio foi interrompida. Encerre e inicie a transmissão novamente.");
      }
    });

    try {
      await window.telaDesktop.startDiscordFilteredAudio();
      await context.resume();
    } catch (audioError) {
      stopFilteredAudio();
      throw audioError;
    }

    const track = destination.stream.getAudioTracks()[0];
    if (!track) {
      stopFilteredAudio();
      throw new Error("O Windows não criou a faixa de áudio da transmissão.");
    }
    return track;
  }, [platform, stopFilteredAudio]);

  const configureVideoSender = useCallback(async (pc: RTCPeerConnection) => {
    const sender = pc.getSenders().find((item) => item.track?.kind === "video");
    if (!sender) return;

    const parameters = sender.getParameters();
    parameters.degradationPreference = quality.key === "performance" ? "maintain-framerate" : "balanced";
    parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
    parameters.encodings[0].maxBitrate = quality.maxBitrate;
    parameters.encodings[0].maxFramerate = quality.frameRate;

    try {
      await sender.setParameters(parameters);
    } catch (senderError) {
      console.warn("O navegador ajustará automaticamente o bitrate", senderError);
    }
  }, [quality]);

  const joinP2PRoom = useCallback((role: Role, code: string, turnConfig: TurnServerConfig[], stream?: MediaStream) => {
    const roomId = code.replaceAll("-", "");
    const roomConfig = {
      appId: TRYSTERO_APP_ID,
      password: roomId,
      relayConfig: { warnOnRelayFailure: true },
      turnConfig,
    };

    const onJoinError = (strategy: string) => ({ error }: { error: string }) => {
      console.error(`[${strategy}] falha ao conectar`, error);
      connectionErrorsRef.current.add(strategy);
      if (connectionErrorsRef.current.size >= 2 && !remoteStreamRef.current) {
        setConnectionState("Rede bloqueou a conexão");
        setError("Os computadores se encontraram, mas a rede bloqueou a rota direta. Tente liberar o Tela no Firewall do Windows e entrar novamente.");
      }
    };

    const strategyRooms = [
      {
        strategy: "Nostr",
        room: joinNostrRoom(roomConfig, roomId, { onJoinError: onJoinError("Nostr") }),
      },
      {
        strategy: "MQTT",
        room: joinMqttRoom(roomConfig, roomId, { onJoinError: onJoinError("MQTT") }),
      },
    ];
    roomRefs.current = strategyRooms.map(({ room }) => room);

    for (const { room, strategy } of strategyRooms) {
      const presence = room.makeAction("presence");
      const announceRole = (target: string) => {
        void presence.send({ role }, { target });
      };

      room.onPeerJoin = (peerId) => announceRole(peerId);
      room.onPeerLeave = (peerId) => {
        if (role === "host" && viewerRoomsRef.current.get(peerId) === room) {
          viewerRoomsRef.current.delete(peerId);
          setViewerCount(viewerRoomsRef.current.size);
        } else if (
          role === "viewer" &&
          hostSessionRef.current?.peerId === peerId &&
          hostSessionRef.current.room === room
        ) {
          hostSessionRef.current = null;
          remoteStreamRef.current = null;
          setRemoteStream(null);
          setConnectionState("A transmissão terminou");
        }
      };

      presence.onMessage = (data, { peerId }) => {
        const remoteRole = (data as { role?: Role })?.role;
        if (role === "host" && remoteRole === "viewer" && stream && !viewerRoomsRef.current.has(peerId)) {
          viewerRoomsRef.current.set(peerId, room);
          setViewerCount(viewerRoomsRef.current.size);
          setConnectionState(`Transmitindo · ${strategy}`);
          room.addStream(stream, { target: peerId, metadata: { kind: "screen", strategy } });
          window.setTimeout(() => {
            const pc = room.getPeers()[peerId];
            if (pc) void configureVideoSender(pc);
          }, 500);
        }

        if (role === "viewer" && remoteRole === "host" && !hostSessionRef.current) {
          hostSessionRef.current = { peerId, room };
          setConnectionState(`Aguardando vídeo · ${strategy}`);
        }
      };

      if (role === "viewer") {
        room.onPeerStream = (incomingStream, peerId, metadata) => {
          if ((metadata as { kind?: string } | undefined)?.kind !== "screen" || remoteStreamRef.current) return;
          hostSessionRef.current = { peerId, room };
          remoteStreamRef.current = incomingStream;
          setRemoteStream(incomingStream);
          setConnectionState(`Conectado · ${strategy}`);
          setError("");
          if (connectionTimeoutRef.current !== null) window.clearTimeout(connectionTimeoutRef.current);
        };
      }

      for (const peerId of Object.keys(room.getPeers())) announceRole(peerId);
    }

    if (role === "viewer") {
      connectionTimeoutRef.current = window.setTimeout(() => {
        if (remoteStreamRef.current) return;
        const sockets = [
          ...Object.values(getNostrRelaySockets()),
          ...Object.values(getMqttRelaySockets()),
        ] as WebSocket[];
        const openRelays = sockets.filter((socket) => socket.readyState === WebSocket.OPEN).length;
        setConnectionState("Ainda procurando");
        setError(openRelays > 0
          ? "A sala não respondeu. Confirme o código, mantenha o anfitrião transmitindo e verifique se os dois estão usando a versão mais recente."
          : "Não foi possível acessar os serviços de sala. Verifique a internet ou o Firewall do Windows e tente novamente.");
      }, CONNECTION_TIMEOUT_MS);
    }
  }, [configureVideoSender]);

  const cleanup = useCallback(() => {
    const hadActiveSession = Boolean(localStreamRef.current || remoteStreamRef.current || roomRefs.current.length);
    roomRefs.current.forEach((room) => {
      const peers = Object.values(room.getPeers()) as RTCPeerConnection[];
      room.leave();
      peers.forEach((peer) => peer.close());
    });
    roomRefs.current = [];
    viewerRoomsRef.current.clear();
    hostSessionRef.current = null;
    connectionErrorsRef.current.clear();
    if (connectionTimeoutRef.current !== null) window.clearTimeout(connectionTimeoutRef.current);
    connectionTimeoutRef.current = null;
    stopFilteredAudio();
    if (localVideoRef.current) {
      localVideoRef.current.pause();
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.pause();
      remoteVideoRef.current.srcObject = null;
    }
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    remoteStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setShowLocalPreview(false);
    setViewerCount(0);
    setStats({ bitrate: "—", resolution: "—", fps: "—", latency: "—" });
    if (hadActiveSession) window.telaDesktop.logEvent("capture-stop");
  }, [stopFilteredAudio]);

  useEffect(() => cleanup, [cleanup]);

  const loadSources = useCallback(async () => {
    setSourcesLoading(true);
    setError("");
    try {
      const permission = await window.telaDesktop.getCapturePermission();
      if (permission === "denied" || permission === "restricted") {
        setSources([]);
        setError("O macOS bloqueou a gravação de tela. Abra Privacidade e Segurança, permita o Tela e reinicie o aplicativo.");
        return;
      }
      const availableSources = await window.telaDesktop.getSources();
      if (platform === "darwin" && availableSources.length === 0) {
        const currentPermission = await window.telaDesktop.getCapturePermission();
        if (currentPermission !== "granted") {
          setError("O macOS ainda não liberou a gravação de tela. Autorize o Tela em Privacidade e Segurança e abra o aplicativo novamente.");
          return;
        }
      }
      setSources(availableSources);
      const entireScreen = availableSources.find((source) => source.type === "screen");
      setSelectedSourceId((current) => current || entireScreen?.id || availableSources[0]?.id || "");
    } catch {
      setError(platform === "darwin"
        ? "Não foi possível acessar as telas. Autorize o Tela em Privacidade e Segurança > Gravação de Tela e Áudio do Sistema."
        : "Não foi possível listar as telas e janelas deste computador.");
    } finally {
      setSourcesLoading(false);
    }
  }, [platform]);

  const openHostSetup = useCallback(() => {
    setView("host-setup");
    void loadSources();
  }, [loadSources]);

  const startHosting = useCallback(async () => {
    if (!selectedSourceId) return;
    setError("");
    setConnectionState("Abrindo a tela");

    let stream: MediaStream | null = null;
    try {
      const turnServersPromise = window.telaDesktop.getTurnServers().catch(() => []);
      await window.telaDesktop.selectSource(selectedSourceId);
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: quality.width },
          height: { ideal: quality.height },
          frameRate: { ideal: quality.frameRate, max: quality.frameRate },
        },
        audio: platform === "darwin",
      });
      if (platform === "win32") {
        const filteredAudioTrack = await createFilteredAudioTrack();
        stream.addTrack(filteredAudioTrack);
      }

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.contentHint = "motion";
        videoTrack.addEventListener("ended", () => cleanup(), { once: true });
      }

      const code = generateRoomCode();
      const turnServers = await turnServersPromise;
      localStreamRef.current = stream;
      setLocalStream(stream);
      setRoomCode(code);
      setView("host-live");
      setConnectionState(turnServers.length ? "Sala aberta · TURN pronto" : "Sala aberta");
      window.telaDesktop.logEvent("capture-start", {
        quality: quality.key,
        width: quality.width,
        height: quality.height,
        fps: quality.frameRate,
        bitrate: quality.maxBitrate,
      });
      joinP2PRoom("host", code, turnServers, stream);
    } catch (startError) {
      stream?.getTracks().forEach((track) => track.stop());
      cleanup();
      setView("host-setup");
      const permissionDenied = startError instanceof DOMException && startError.name === "NotAllowedError";
      setError(permissionDenied && platform === "darwin"
        ? "O macOS não liberou a captura. Permita o Tela em Privacidade e Segurança > Gravação de Tela e Áudio do Sistema e abra o app novamente."
        : startError instanceof Error ? startError.message : "Não foi possível iniciar a transmissão.");
    }
  }, [cleanup, createFilteredAudioTrack, joinP2PRoom, platform, quality, selectedSourceId]);

  const joinRoom = useCallback(async () => {
    const code = normalizeRoomCode(joinCode);
    if (code.replaceAll("-", "").length !== 20) {
      setError("Cole o código completo da sala.");
      return;
    }

    setError("");
    setRoomCode(code);
    setConnectionState("Preparando as rotas");
    setView("viewer-live");
    try {
      const turnServers = await window.telaDesktop.getTurnServers().catch(() => []);
      setConnectionState("Procurando a sala");
      joinP2PRoom("viewer", code, turnServers);
    } catch (joinError) {
      cleanup();
      setView("viewer-join");
      setError(joinError instanceof Error ? joinError.message : "Não foi possível entrar na sala.");
    }
  }, [cleanup, joinCode, joinP2PRoom]);

  const leaveSession = useCallback(() => {
    cleanup();
    setConnectionState("Preparando");
    setError("");
    setView("home");
  }, [cleanup]);

  const copyInvite = useCallback(async () => {
    try {
      const didCopy = await window.telaDesktop.copyText(roomCode);
      if (!didCopy) throw new Error("O Windows não confirmou a cópia");
      setCopied(true);
      setError("");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
      setError("Não foi possível copiar automaticamente. Selecione o código e pressione Ctrl+C.");
    }
  }, [roomCode]);

  useEffect(() => {
    if (view !== "host-live" && view !== "viewer-live") return;
    let previousBytes = 0;
    let previousTimestamp = 0;

    const interval = window.setInterval(async () => {
      let pc: RTCPeerConnection | undefined;
      for (const room of roomRefs.current) {
        pc = Object.values(room.getPeers())[0] as RTCPeerConnection | undefined;
        if (pc) break;
      }
      if (!pc) return;
      const report = await pc.getStats();
      setStats((current) => {
        const next: ConnectionStats = { ...current };
        report.forEach((stat) => {
          const isMedia = stat.type === "outbound-rtp" || stat.type === "inbound-rtp";
          if (isMedia && stat.kind === "video") {
            const bytes = stat.bytesSent ?? stat.bytesReceived ?? 0;
            if (previousTimestamp && stat.timestamp > previousTimestamp) {
              next.bitrate = formatBitrate(((bytes - previousBytes) * 8 * 1000) / (stat.timestamp - previousTimestamp));
            }
            previousBytes = bytes;
            previousTimestamp = stat.timestamp;
            next.resolution = stat.frameWidth && stat.frameHeight ? `${stat.frameWidth}×${stat.frameHeight}` : next.resolution;
            next.fps = stat.framesPerSecond ? `${Math.round(stat.framesPerSecond)} FPS` : next.fps;
          }
          if (stat.type === "candidate-pair" && stat.state === "succeeded" && stat.currentRoundTripTime) {
            next.latency = `${Math.round(stat.currentRoundTripTime * 1000)} ms`;
          }
        });
        return next;
      });
    }, 1_000);

    return () => window.clearInterval(interval);
  }, [view]);

  return (
    <main className={`app-shell view-${view}`}>
      <ParticleField particles={AMBIENT_PARTICLES} className="ambient-particles" />
      <header className="topbar">
        <button className="brand" onClick={leaveSession} aria-label="Voltar ao início">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>Tela</span>
        </button>
        <div className="topbar-status">
          <span className="status-dot" />
          Transmissão privada
          <span className="version">v{version}</span>
        </div>
      </header>

      {updateStatus && ["available", "downloading", "downloaded"].includes(updateStatus.state) && (
        <div className="update-notice" role="status">
          <span className="update-icon"><Download size={16} /></span>
          <span>
            <strong>{updateStatus.state === "downloaded" ? `Versão ${updateStatus.version} pronta` : "Baixando atualização"}</strong>
            <small>{updateStatus.state === "downloading" ? `${updateStatus.percent ?? 0}% concluído` : "O Tela se mantém atualizado automaticamente."}</small>
          </span>
          {updateStatus.state === "downloaded" && (
            <button className="button button-primary" onClick={() => void window.telaDesktop.installUpdate()}>
              Reiniciar agora
            </button>
          )}
        </div>
      )}

      {view === "home" && (
        <section className="home-grid page-enter">
          <div className="hero-copy">
            <div className="eyebrow"><Sparkles size={14} /> Feito para a sua turma</div>
            <h1>Sua tela.<br /><span>Entre amigos.</span></h1>
            <p>Compartilhe o monitor inteiro com áudio, em alta qualidade, direto para os computadores dos seus amigos.</p>
            <div className="home-actions">
              <button className="button button-primary" onClick={openHostSetup}>
                <MonitorUp size={18} /> Compartilhar minha tela
              </button>
              <button className="button button-ghost" onClick={() => { setError(""); setView("viewer-join"); }}>
                <Users size={18} /> Entrar em uma sala
              </button>
            </div>
            <div className="trust-row">
              <span><ShieldCheck size={15} /> Criptografado</span>
              <span><Wifi size={15} /> Conexão protegida</span>
              <span><Radio size={15} /> Até 1440p60</span>
            </div>
          </div>

          <div className="hero-visual" aria-hidden="true">
            <div className="constellation-orbit orbit-outer" />
            <div className="constellation-orbit orbit-inner" />
            <ParticleField particles={CONSTELLATION_PARTICLES} className="particle-brain" />
            <span className="constellation-note note-top">ROTA PRIVADA</span>
            <span className="constellation-note note-bottom"><span className="status-dot" /> 1440P · 60 FPS</span>
            <div className="constellation-core">
              <ScreenShare size={26} strokeWidth={1.4} />
            </div>
          </div>
        </section>
      )}

      {view === "host-setup" && (
        <section className="workspace page-enter">
          <PageHeading
            kicker="Nova transmissão"
            title="O que você quer mostrar?"
            subtitle="Escolha um monitor ou uma janela. Você confere a prévia antes de transmitir."
            onBack={leaveSession}
          />

          {error && (
            <ErrorBanner
              message={error}
              actionLabel={platform === "darwin" ? "Abrir ajustes" : undefined}
              onAction={platform === "darwin" ? () => void window.telaDesktop.openCaptureSettings() : undefined}
            />
          )}

          <div className="setup-layout">
            <div className="source-panel panel">
              <div className="panel-heading">
                <div><span className="step">01</span><h2>Tela ou janela</h2></div>
                <button className="icon-button" onClick={() => void loadSources()} title="Atualizar fontes" aria-label="Atualizar telas e janelas">
                  <RefreshCw size={16} className={sourcesLoading ? "spin" : ""} />
                </button>
              </div>

              {sourcesLoading ? (
                <div className="source-loading"><LoaderCircle className="spin" /> Procurando telas…</div>
              ) : (
                <div className="source-grid">
                  {sources.map((source) => (
                    <button
                      key={source.id}
                      className={`source-card ${selectedSourceId === source.id ? "selected" : ""}`}
                      onClick={() => setSelectedSourceId(source.id)}
                      aria-pressed={selectedSourceId === source.id}
                    >
                      <div className="source-preview">
                        <img src={source.thumbnail} alt="" />
                        {selectedSourceId === source.id && <span className="selected-check"><Check size={14} /></span>}
                      </div>
                      <div className="source-name">
                        {source.appIcon ? <img src={source.appIcon} alt="" /> : <ScreenShare size={15} />}
                        <span>{source.name}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <aside className="setup-sidebar">
              <div className="panel compact-panel">
                <div className="panel-heading"><div><span className="step">02</span><h2>Qualidade</h2></div></div>
                <div className="quality-list" role="radiogroup" aria-label="Qualidade da transmissão">
                  {QUALITY_PRESETS.map((preset) => (
                    <button
                      key={preset.key}
                      className={`quality-option ${qualityKey === preset.key ? "selected" : ""}`}
                      onClick={() => setQualityKey(preset.key)}
                      role="radio"
                      aria-checked={qualityKey === preset.key}
                    >
                      <span className="radio-ring"><span /></span>
                      <span><strong>{preset.label}</strong><small>{preset.detail}</small></span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="panel compact-panel">
                <div className="audio-row">
                  <span className="audio-icon"><Volume2 size={18} /></span>
                  <span>
                    <strong>{platform === "win32" ? "Áudio sem Discord" : "Áudio do computador"}</strong>
                    <small>{platform === "win32" ? "Jogos, navegadores e vídeos são transmitidos" : "Filmes, jogos e aplicativos"}</small>
                  </span>
                  <span className="audio-fixed"><ShieldCheck size={14} /> Automático</span>
                </div>
              </div>

              <button className="button button-primary start-button" disabled={!selectedSourceId || sourcesLoading} onClick={() => void startHosting()}>
                Iniciar transmissão <ChevronRight size={18} />
              </button>
              <p className="setup-note"><ShieldCheck size={14} /> Nada é gravado ou armazenado.</p>
            </aside>
          </div>
        </section>
      )}

      {view === "viewer-join" && (
        <section className="join-page page-enter">
          <PageHeading kicker="Convite privado" title="Entrar em uma sala" subtitle="Cole o código que seu amigo enviou para você." onBack={leaveSession} />
          <div className="join-card panel">
            <div className="join-icon"><Link2 size={28} /></div>
            <label htmlFor="room-code">Código da sala</label>
            <input
              id="room-code"
              className="room-input"
              value={joinCode}
              onChange={(event) => setJoinCode(normalizeRoomCode(event.target.value))}
              onKeyDown={(event) => { if (event.key === "Enter") void joinRoom(); }}
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
              autoFocus
              spellCheck={false}
            />
            {error && <ErrorBanner message={error} compact />}
            <button className="button button-primary join-button" onClick={() => void joinRoom()}>
              Assistir agora <ChevronRight size={18} />
            </button>
            <p><ShieldCheck size={14} /> A conexão de vídeo é criptografada de ponta a ponta.</p>
          </div>
        </section>
      )}

      {view === "host-live" && (
        <section className="live-page page-enter">
          <div className="live-header">
            <div>
              <span className="live-label"><span className="live-dot" /> AO VIVO</span>
              <h1>Sua tela está sendo compartilhada</h1>
            </div>
            <button className="button danger-button" onClick={leaveSession}><ScreenShareOff size={17} /> Encerrar</button>
          </div>

          {error && <ErrorBanner message={error} />}

          <div className="live-layout">
            <div className="video-panel panel">
              {showLocalPreview ? (
                <video ref={localVideoRef} autoPlay muted playsInline />
              ) : (
                <div className="preview-paused">
                  <EyeOff size={25} />
                  <strong>Prévia pausada</strong>
                  <span>Menos uso de GPU enquanto você joga.</span>
                </div>
              )}
              <button className="video-badge preview-toggle" onClick={() => setShowLocalPreview((visible) => !visible)}>
                {showLocalPreview ? <EyeOff size={13} /> : <Eye size={13} />}
                {showLocalPreview ? "Ocultar prévia" : "Mostrar prévia"}
              </button>
            </div>
            <aside className="live-sidebar">
              <div className="invite-card panel">
                <span className="card-kicker">CONVITE</span>
                <h2>Chame seus amigos</h2>
                <p>Envie este código. Só entra quem tiver acesso a ele.</p>
                <button className="room-code-copy" onClick={() => void copyInvite()}>
                  <span>{roomCode}</span>{copied ? <Check size={18} /> : <Copy size={18} />}
                </button>
                <button className="button button-primary copy-button" onClick={() => void copyInvite()}>
                  {copied ? <><Check size={16} /> Copiado</> : <><Clipboard size={16} /> Copiar código</>}
                </button>
              </div>

              <div className="panel session-card">
                <div className="session-status" aria-live="polite">
                  <span className="signal-icon"><Radio size={16} /></span>
                  <span><strong>{connectionState}</strong><small>{viewerCount} {viewerCount === 1 ? "pessoa assistindo" : "pessoas assistindo"}</small></span>
                </div>
                <div className="stat-grid">
                  <Stat label="Bitrate" value={stats.bitrate} />
                  <Stat label="Resolução" value={stats.resolution} />
                  <Stat label="Quadros" value={stats.fps} />
                  <Stat label="Latência" value={stats.latency} />
                </div>
              </div>
            </aside>
          </div>
        </section>
      )}

      {view === "viewer-live" && (
        <section className="watch-page page-enter">
          <div className="watch-toolbar">
            <button className="button button-secondary" onClick={leaveSession}><ArrowLeft size={16} /> Sair</button>
            <div className="watch-room"><span>{roomCode}</span><span className="status-dot" /> {connectionState}</div>
            <button className="button button-primary" onClick={() => viewerStageRef.current?.requestFullscreen()}>
              <Expand size={16} /> Tela cheia
            </button>
          </div>
          {error && <ErrorBanner message={error} />}
          <div className="viewer-stage panel" ref={viewerStageRef}>
            <video ref={remoteVideoRef} autoPlay playsInline controls={false} />
            {!remoteStream && (
              <div className="viewer-waiting">
                <span className="waiting-ring"><LoaderCircle className="spin" /></span>
                <h2>{connectionState}</h2>
                <p>A transmissão aparecerá aqui automaticamente.</p>
              </div>
            )}
            <div className="viewer-volume" aria-label="Volume da transmissão">
              <button
                type="button"
                onClick={toggleViewerMute}
                aria-label={viewerVolume === 0 ? "Ativar som da transmissão" : "Silenciar transmissão"}
                title={viewerVolume === 0 ? "Ativar som" : "Silenciar"}
              >
                {viewerVolume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
              </button>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={Math.round(viewerVolume * 100)}
                onChange={(event) => changeViewerVolume(Number(event.target.value) / 100)}
                aria-label="Volume da transmissão"
                aria-valuetext={`${Math.round(viewerVolume * 100)}%`}
              />
              <output aria-live="polite">{Math.round(viewerVolume * 100)}%</output>
            </div>
            <div className="viewer-stats">
              <span>{stats.resolution}</span><span>{stats.fps}</span><span>{stats.bitrate}</span><span>{stats.latency}</span>
            </div>
          </div>
          <p className="headphone-note"><Headphones size={15} /> {platform === "win32" ? "O áudio do Discord é removido automaticamente da transmissão." : "Use fones para evitar retorno durante a conversa."}</p>
        </section>
      )}
    </main>
  );
}

function ParticleField({
  particles,
  className,
}: {
  particles: typeof CONSTELLATION_PARTICLES;
  className: string;
}) {
  return (
    <div className={className} aria-hidden="true">
      {particles.map((particle, index) => (
        <span
          key={index}
          className="triangle-particle"
          style={{
            "--particle-x": `${particle.x}%`,
            "--particle-y": `${particle.y}%`,
            "--particle-size": `${particle.size}px`,
            "--particle-rotation": `${particle.rotation}deg`,
            "--particle-color": particle.color,
            "--particle-delay": `${particle.delay}s`,
            "--particle-duration": `${particle.duration}s`,
            "--particle-opacity": particle.opacity,
          } as CSSProperties}
        >△</span>
      ))}
    </div>
  );
}

function PageHeading({ kicker, title, subtitle, onBack }: { kicker: string; title: string; subtitle: string; onBack: () => void }) {
  return (
    <div className="page-heading">
      <button className="icon-button back-button" onClick={onBack} aria-label="Voltar"><ArrowLeft size={18} /></button>
      <div><span className="page-kicker">{kicker}</span><h1>{title}</h1><p>{subtitle}</p></div>
    </div>
  );
}

function ErrorBanner({
  message,
  compact = false,
  actionLabel,
  onAction,
}: {
  message: string;
  compact?: boolean;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className={`error-banner ${compact ? "compact" : ""}`} role="alert">
      <X size={16} />
      <span>{message}</span>
      {actionLabel && onAction && <button onClick={onAction}>{actionLabel}</button>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="stat"><span>{label}</span><strong>{value}</strong></div>;
}

export default App;
