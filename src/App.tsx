import {
  ArrowLeft,
  Check,
  ChevronRight,
  CircleHelp,
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
  Settings2,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UserMinus,
  UserX,
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
import {
  getRelaySockets as getTorrentRelaySockets,
  joinRoom as joinTorrentRoom,
} from "@trystero-p2p/torrent";

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

type ViewerAdmissionStatus = "pending" | "approved";

interface ViewerParticipant {
  peerId: string;
  name: string;
  status: ViewerAdmissionStatus;
  strategy: string;
}

interface ViewerRoute {
  room: Room;
  strategy: string;
  sendAdmission: (data: unknown, options: { target: string }) => Promise<unknown>;
}

interface ViewerConnection extends ViewerParticipant {
  routes: ViewerRoute[];
  activeRoom?: Room;
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
const PARTICLE_COLORS = ["#19d0e8", "#44ccff", "#617176", "#ffffff", "#062f34"];
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

function normalizeDisplayName(value: string) {
  return value.replace(/\s+/g, " ").replace(/[^\p{L}\p{N} ._'-]/gu, "").slice(0, 32);
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
  const [qualityChanging, setQualityChanging] = useState(false);
  const [qualityNotice, setQualityNotice] = useState("");
  const [hostStarting, setHostStarting] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [viewerName, setViewerName] = useState(() => localStorage.getItem("tela-viewer-name") ?? "");
  const [viewerParticipants, setViewerParticipants] = useState<ViewerParticipant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [connectionState, setConnectionState] = useState("Preparando");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [version, setVersion] = useState("0.9.4");
  const [platform, setPlatform] = useState<NodeJS.Platform | "">("");
  const [showPermissionGuide, setShowPermissionGuide] = useState(false);
  const [connectionPermission, setConnectionPermission] = useState<ConnectionPermissionStatus | null>(null);
  const [capturePermission, setCapturePermission] = useState<"not-determined" | "granted" | "denied" | "restricted" | "unknown">("unknown");
  const [permissionBusy, setPermissionBusy] = useState<"connection" | "capture" | null>(null);
  const [permissionNotice, setPermissionNotice] = useState("");
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
  const viewerConnectionsRef = useRef(new Map<string, ViewerConnection>());
  const deniedViewerIdsRef = useRef(new Set<string>());
  const hostSessionRef = useRef<{ peerId: string; room: Room } | null>(null);
  const viewerAdmissionStateRef = useRef<"pending" | "approved" | "denied" | "kicked">("pending");
  const connectionErrorsRef = useRef(new Set<string>());
  const connectionTimeoutRef = useRef<number | null>(null);
  const hostStartingRef = useRef(false);
  const hostRoomCodeRef = useRef("");
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioWorkletRef = useRef<AudioWorkletNode | null>(null);
  const audioDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const audioPcmUnsubscribeRef = useRef<(() => void) | null>(null);
  const audioStatusUnsubscribeRef = useRef<(() => void) | null>(null);
  const pendingPermissionActionRef = useRef<(() => void) | null>(null);

  const quality = useMemo(
    () => QUALITY_PRESETS.find((preset) => preset.key === qualityKey) ?? QUALITY_PRESETS[0],
    [qualityKey],
  );

  useEffect(() => {
    window.telaDesktop?.getVersion().then(setVersion).catch(() => undefined);
    window.telaDesktop?.getPlatform().then(async (detectedPlatform) => {
      setPlatform(detectedPlatform);
      const [connectionStatus, screenStatus] = await Promise.all([
        window.telaDesktop.getConnectionPermission().catch(() => ({ state: "unavailable" as const })),
        window.telaDesktop.getCapturePermission().catch(() => "unknown" as const),
      ]);
      setConnectionPermission(connectionStatus);
      setCapturePermission(screenStatus);
      if (detectedPlatform === "win32" && connectionStatus.state === "allowed") {
        localStorage.setItem("infinity-permissions-v1-seen", "1");
        const pendingAction = pendingPermissionActionRef.current;
        if (pendingAction) {
          pendingPermissionActionRef.current = null;
          setShowPermissionGuide(false);
          pendingAction();
        }
      } else if (
        (detectedPlatform === "win32" || detectedPlatform === "darwin") &&
        localStorage.getItem("infinity-permissions-v1-seen") !== "1"
      ) {
        setShowPermissionGuide(true);
      }
    }).catch(() => undefined);
    return window.telaDesktop?.onUpdateStatus?.(setUpdateStatus);
  }, []);

  const closePermissionGuide = useCallback(() => {
    localStorage.setItem("infinity-permissions-v1-seen", "1");
    const pendingAction = pendingPermissionActionRef.current;
    pendingPermissionActionRef.current = null;
    setPermissionNotice("");
    setShowPermissionGuide(false);
    pendingAction?.();
  }, []);

  const requestConnectionPermission = useCallback(async () => {
    setPermissionBusy("connection");
    setPermissionNotice("");
    try {
      const result = await window.telaDesktop.requestConnectionPermission();
      setConnectionPermission(result);
      if (result.state === "allowed") {
        localStorage.setItem("infinity-permissions-v1-seen", "1");
        setShowPermissionGuide(false);
        const pendingAction = pendingPermissionActionRef.current;
        pendingPermissionActionRef.current = null;
        pendingAction?.();
      } else if (result.state === "requested") {
        setPermissionNotice("Pedido enviado. Clique em Permitir no aviso do macOS.");
      } else if (result.state === "cancelled") {
        setPermissionNotice("A autorização foi cancelada. O Infinity não alterou o Firewall.");
      } else {
        setPermissionNotice("O Windows não confirmou a alteração. Você ainda pode continuar e testar a conexão.");
      }
    } catch {
      setPermissionNotice("Não foi possível abrir a solicitação do sistema.");
    } finally {
      setPermissionBusy(null);
    }
  }, []);

  const requestCapturePermission = useCallback(async () => {
    setPermissionBusy("capture");
    setPermissionNotice("");
    try {
      const result = await window.telaDesktop.requestCapturePermission();
      setCapturePermission(result);
      if (result === "granted") {
        setPermissionNotice("Gravação de tela liberada.");
      } else if (result === "denied" || result === "restricted") {
        setPermissionNotice("O acesso já foi negado. Abra Gravação de Tela nos Ajustes e ative o Infinity.");
      } else {
        setPermissionNotice("Responda ao aviso do macOS. Se ele não aparecer, abra os Ajustes abaixo.");
      }
    } catch {
      setPermissionNotice("Não foi possível solicitar a gravação de tela.");
    } finally {
      setPermissionBusy(null);
    }
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
    const moduleUrl = new URL("tela-pcm-worklet.js", window.location.href).toString();
    await context.audioWorklet.addModule(moduleUrl);

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

  const configureVideoSender = useCallback(async (pc: RTCPeerConnection, preset: QualityPreset) => {
    const sender = pc.getSenders().find((item) => item.track?.kind === "video");
    if (!sender) return;

    const parameters = sender.getParameters();
    parameters.degradationPreference = preset.key === "performance" ? "maintain-framerate" : "balanced";
    parameters.encodings = parameters.encodings?.length ? parameters.encodings : [{}];
    parameters.encodings[0].maxBitrate = preset.maxBitrate;
    parameters.encodings[0].maxFramerate = preset.frameRate;

    const settings = sender.track?.getSettings();
    const scale = Math.max(
      (settings?.width ?? preset.width) / preset.width,
      (settings?.height ?? preset.height) / preset.height,
      1,
    );
    parameters.encodings[0].scaleResolutionDownBy = scale > 1.05 ? scale : 1;

    try {
      await sender.setParameters(parameters);
    } catch (senderError) {
      console.warn("O navegador ajustará automaticamente o bitrate", senderError);
    }
  }, []);

  const syncViewerParticipants = useCallback(() => {
    const participants = [...viewerConnectionsRef.current.values()].map(({ peerId, name, status, strategy }) => ({
      peerId,
      name,
      status,
      strategy,
    }));
    setViewerParticipants(participants);
    setViewerCount(participants.filter((participant) => participant.status === "approved").length);
  }, []);

  const joinP2PRoom = useCallback((
    role: Role,
    code: string,
    turnConfig: TurnServerConfig[],
    stream?: MediaStream,
    initialQuality: QualityPreset = QUALITY_PRESETS[0],
  ) => {
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
      window.telaDesktop.logEvent("discovery-error", {
        role,
        strategy,
        message: String(error).slice(0, 240),
      });
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
      {
        strategy: "Torrent",
        room: joinTorrentRoom(roomConfig, roomId, { onJoinError: onJoinError("Torrent") }),
      },
    ];
    roomRefs.current = strategyRooms.map(({ room }) => room);

    const startViewerStream = async (connection: ViewerConnection, preferredRoute?: ViewerRoute) => {
      if (!stream || connection.status !== "approved") return;
      const route = preferredRoute ?? connection.routes[0];
      if (!route) return;

      connection.activeRoom = route.room;
      viewerRoomsRef.current.set(connection.peerId, route.room);
      syncViewerParticipants();
      setConnectionState(`Transmitindo · ${route.strategy}`);
      await Promise.allSettled(connection.routes.map((candidate) =>
        candidate.sendAdmission({ status: "approved" }, { target: connection.peerId }),
      ));
      route.room.addStream(stream, {
        target: connection.peerId,
        metadata: { kind: "screen", strategy: route.strategy },
      });
      window.setTimeout(() => {
        const pc = route.room.getPeers()[connection.peerId];
        if (pc) void configureVideoSender(pc, initialQuality);
      }, 500);
    };

    for (const { room, strategy } of strategyRooms) {
      const presence = room.makeAction("presence");
      const admission = room.makeAction("admission");
      const announceRole = (target: string) => {
        void presence.send(
          role === "viewer" ? { role, name: normalizeDisplayName(viewerName).trim() } : { role },
          { target },
        );
      };

      room.onPeerJoin = (peerId) => {
        connectionErrorsRef.current.delete(strategy);
        window.telaDesktop.logEvent("peer-discovered", {
          role,
          strategy,
          peer: peerId.slice(0, 8),
        });
        if (role === "viewer") setError("");
        announceRole(peerId);
      };
      room.onPeerLeave = (peerId) => {
        if (role === "host") {
          const connection = viewerConnectionsRef.current.get(peerId);
          if (!connection) return;
          connection.routes = connection.routes.filter((route) => route.room !== room);
          if (connection.activeRoom === room) {
            viewerRoomsRef.current.delete(peerId);
            connection.activeRoom = undefined;
            const fallbackRoute = connection.routes[0];
            if (connection.status === "approved" && fallbackRoute) {
              void startViewerStream(connection, fallbackRoute);
              return;
            }
          }
          if (connection.routes.length === 0) viewerConnectionsRef.current.delete(peerId);
          syncViewerParticipants();
        } else if (
          role === "viewer" &&
          hostSessionRef.current?.peerId === peerId &&
          hostSessionRef.current.room === room
        ) {
          hostSessionRef.current = null;
          remoteStreamRef.current = null;
          setRemoteStream(null);
          if (viewerAdmissionStateRef.current !== "denied" && viewerAdmissionStateRef.current !== "kicked") {
            setConnectionState("A transmissão terminou");
          }
        }
      };

      presence.onMessage = (data, { peerId }) => {
        const presenceData = data as { role?: Role; name?: string };
        const remoteRole = presenceData?.role;
        if (role === "host" && remoteRole === "viewer" && stream) {
          const route: ViewerRoute = {
            room,
            strategy,
            sendAdmission: admission.send as ViewerRoute["sendAdmission"],
          };
          if (deniedViewerIdsRef.current.has(peerId)) {
            void route.sendAdmission({ status: "denied" }, { target: peerId });
            return;
          }

          const current = viewerConnectionsRef.current.get(peerId);
          if (current) {
            if (!current.routes.some((candidate) => candidate.room === room)) current.routes.push(route);
            if (presenceData.name) current.name = normalizeDisplayName(presenceData.name).trim() || current.name;
            syncViewerParticipants();
          } else {
            viewerConnectionsRef.current.set(peerId, {
              peerId,
              name: normalizeDisplayName(presenceData.name ?? "").trim() || `Amigo ${peerId.slice(0, 4).toUpperCase()}`,
              status: "pending",
              strategy,
              routes: [route],
            });
            setConnectionState("Aguardando sua aprovação");
            syncViewerParticipants();
          }
        }

        if (role === "viewer" && remoteRole === "host" && !hostSessionRef.current) {
          hostSessionRef.current = { peerId, room };
          if (connectionTimeoutRef.current !== null) {
            window.clearTimeout(connectionTimeoutRef.current);
            connectionTimeoutRef.current = null;
          }
          setConnectionState(`Aguardando aprovação · ${strategy}`);
        }
      };

      if (role === "viewer") {
        admission.onMessage = (data, { peerId }) => {
          if (hostSessionRef.current?.peerId !== peerId) return;
          const status = (data as { status?: string })?.status;
          if (status === "approved") {
            viewerAdmissionStateRef.current = "approved";
            hostSessionRef.current = { peerId, room };
            setConnectionState(`Aguardando vídeo · ${strategy}`);
            setError("");
          } else if (status === "denied" || status === "kicked") {
            viewerAdmissionStateRef.current = status;
            remoteStreamRef.current?.getTracks().forEach((track) => track.stop());
            remoteStreamRef.current = null;
            setRemoteStream(null);
            setConnectionState(status === "kicked" ? "Você foi removido" : "Entrada não autorizada");
            setError(status === "kicked"
              ? "O anfitrião encerrou seu acesso a esta transmissão."
              : "O anfitrião não autorizou sua entrada nesta transmissão.");
          }
        };
      }

      if (role === "viewer") {
        room.onPeerStream = (incomingStream, peerId, metadata) => {
          if (
            (metadata as { kind?: string } | undefined)?.kind !== "screen" ||
            remoteStreamRef.current ||
            hostSessionRef.current?.peerId !== peerId ||
            viewerAdmissionStateRef.current !== "approved"
          ) return;
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
        if (remoteStreamRef.current || hostSessionRef.current) return;
        const sockets = [
          ...Object.values(getNostrRelaySockets()),
          ...Object.values(getMqttRelaySockets()),
          ...Object.values(getTorrentRelaySockets()),
        ] as WebSocket[];
        const openRelays = sockets.filter((socket) => socket.readyState === WebSocket.OPEN).length;
        const failedStrategies = [...connectionErrorsRef.current].join(",") || "nenhuma";
        window.telaDesktop.logEvent("connection-timeout", {
          role,
          openRelays,
          failedStrategies,
          directMode: turnConfig.length === 0,
        });
        setConnectionState(openRelays > 0 ? "Sala não encontrada" : "Descoberta indisponível");
        setError(openRelays > 0
          ? "A sala não respondeu. Confirme o código, mantenha o anfitrião transmitindo e verifique se os dois estão usando a versão mais recente."
          : "Não foi possível acessar os canais públicos de descoberta. Verifique a internet e tente novamente em alguns instantes.");
      }, CONNECTION_TIMEOUT_MS);
    }
  }, [configureVideoSender, syncViewerParticipants, viewerName]);

  const approveViewer = useCallback(async (peerId: string) => {
    const connection = viewerConnectionsRef.current.get(peerId);
    const stream = localStreamRef.current;
    if (!connection || !stream || connection.status === "approved") return;
    const route = connection.routes[0];
    if (!route) return;

    connection.status = "approved";
    connection.activeRoom = route.room;
    viewerRoomsRef.current.set(peerId, route.room);
    syncViewerParticipants();
    setConnectionState(`Transmitindo · ${route.strategy}`);
    await Promise.allSettled(connection.routes.map((candidate) =>
      candidate.sendAdmission({ status: "approved" }, { target: peerId }),
    ));
    route.room.addStream(stream, { target: peerId, metadata: { kind: "screen", strategy: route.strategy } });
    window.setTimeout(() => {
      const pc = route.room.getPeers()[peerId];
      if (pc) void configureVideoSender(pc, quality);
    }, 500);
    window.telaDesktop.logEvent("viewer-approved", { peer: peerId.slice(0, 8) });
  }, [configureVideoSender, quality, syncViewerParticipants]);

  const removeViewer = useCallback(async (peerId: string, status: "denied" | "kicked") => {
    const connection = viewerConnectionsRef.current.get(peerId);
    if (!connection) return;

    deniedViewerIdsRef.current.add(peerId);
    await Promise.allSettled(connection.routes.map((route) =>
      route.sendAdmission({ status }, { target: peerId }),
    ));
    for (const route of connection.routes) {
      const pc = route.room.getPeers()[peerId];
      if (pc) {
        for (const sender of pc.getSenders()) {
          if (sender.track) await sender.replaceTrack(null).catch(() => undefined);
        }
        window.setTimeout(() => pc.close(), 250);
      }
    }
    viewerRoomsRef.current.delete(peerId);
    viewerConnectionsRef.current.delete(peerId);
    syncViewerParticipants();
    setConnectionState(viewerRoomsRef.current.size ? "Transmitindo" : "Sala aberta");
    window.telaDesktop.logEvent(status === "kicked" ? "viewer-kicked" : "viewer-denied", { peer: peerId.slice(0, 8) });
  }, [syncViewerParticipants]);

  const changeLiveQuality = useCallback(async (nextKey: QualityKey) => {
    const preset = QUALITY_PRESETS.find((candidate) => candidate.key === nextKey);
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!preset || !track || nextKey === qualityKey || qualityChanging) return;

    setQualityChanging(true);
    setQualityNotice("Ajustando para todos…");
    setError("");
    try {
      await track.applyConstraints({
        width: { ideal: preset.width, max: preset.width },
        height: { ideal: preset.height, max: preset.height },
        frameRate: { ideal: preset.frameRate, max: preset.frameRate },
      });
      const peerConnections = [...viewerRoomsRef.current.entries()].flatMap(([peerId, room]) => {
        const pc = room.getPeers()[peerId];
        return pc ? [pc] : [];
      });
      await Promise.all(peerConnections.map((pc) => configureVideoSender(pc, preset)));
      setQualityKey(nextKey);
      setQualityNotice(`${preset.label} aplicada sem desconectar ninguém.`);
      window.telaDesktop.logEvent("quality-change", {
        quality: preset.key,
        width: preset.width,
        height: preset.height,
        fps: preset.frameRate,
        bitrate: preset.maxBitrate,
      });
      window.setTimeout(() => setQualityNotice(""), 3_000);
    } catch (qualityError) {
      console.warn("Não foi possível alterar a qualidade ao vivo", qualityError);
      setQualityNotice("");
      setError("Este monitor não aceitou a nova qualidade. A transmissão continuou na configuração anterior.");
    } finally {
      setQualityChanging(false);
    }
  }, [configureVideoSender, qualityChanging, qualityKey]);

  const cleanup = useCallback(() => {
    const hadActiveSession = Boolean(localStreamRef.current || remoteStreamRef.current || roomRefs.current.length);
    roomRefs.current.forEach((room) => {
      const peers = Object.values(room.getPeers()) as RTCPeerConnection[];
      room.leave();
      peers.forEach((peer) => peer.close());
    });
    roomRefs.current = [];
    viewerRoomsRef.current.clear();
    viewerConnectionsRef.current.clear();
    deniedViewerIdsRef.current.clear();
    hostSessionRef.current = null;
    viewerAdmissionStateRef.current = "pending";
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
    setViewerParticipants([]);
    setQualityChanging(false);
    setQualityNotice("");
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
        setError("O macOS bloqueou a gravação de tela. Abra Privacidade e Segurança, permita o Infinity e reinicie o aplicativo.");
        return;
      }
      const availableSources = await window.telaDesktop.getSources();
      if (platform === "darwin" && availableSources.length === 0) {
        const currentPermission = await window.telaDesktop.getCapturePermission();
        if (currentPermission !== "granted") {
          setError("O macOS ainda não liberou a gravação de tela. Autorize o Infinity em Privacidade e Segurança e abra o aplicativo novamente.");
          return;
        }
      }
      setSources(availableSources);
      const entireScreen = availableSources.find((source) => source.type === "screen");
      setSelectedSourceId((current) => current || entireScreen?.id || availableSources[0]?.id || "");
    } catch {
      setError(platform === "darwin"
        ? "Não foi possível acessar as telas. Autorize o Infinity em Privacidade e Segurança > Gravação de Tela e Áudio do Sistema."
        : "Não foi possível listar as telas e janelas deste computador.");
    } finally {
      setSourcesLoading(false);
    }
  }, [platform]);

  const openHostSetup = useCallback(() => {
    const proceed = () => {
      const code = generateRoomCode();
      hostRoomCodeRef.current = code;
      setRoomCode(code);
      setView("host-setup");
      void loadSources();
    };
    if (platform === "win32" && connectionPermission?.state !== "allowed") {
      pendingPermissionActionRef.current = proceed;
      setPermissionNotice("");
      setShowPermissionGuide(true);
      return;
    }
    proceed();
  }, [connectionPermission?.state, loadSources, platform]);

  const openViewerJoin = useCallback(() => {
    const proceed = () => {
      setError("");
      setView("viewer-join");
    };
    if (platform === "win32" && connectionPermission?.state !== "allowed") {
      pendingPermissionActionRef.current = proceed;
      setPermissionNotice("");
      setShowPermissionGuide(true);
      return;
    }
    proceed();
  }, [connectionPermission?.state, platform]);

  const startHosting = useCallback(async () => {
    if (!selectedSourceId || hostStartingRef.current || localStreamRef.current) return;
    hostStartingRef.current = true;
    setHostStarting(true);
    setError("");
    setConnectionState("Abrindo a tela");

    let stream: MediaStream | null = null;
    const code = hostRoomCodeRef.current || generateRoomCode();
    hostRoomCodeRef.current = code;
    setRoomCode(code);
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

      const turnServers = await turnServersPromise;
      localStreamRef.current = stream;
      setLocalStream(stream);
      setRoomCode(code);
      setView("host-live");
      setConnectionState(turnServers.length ? "Sala aberta · TURN pronto" : "Sala aberta · P2P direto");
      window.telaDesktop.logEvent("capture-start", {
        quality: quality.key,
        width: quality.width,
        height: quality.height,
        fps: quality.frameRate,
        bitrate: quality.maxBitrate,
      });
      joinP2PRoom("host", code, turnServers, stream, quality);
    } catch (startError) {
      stream?.getTracks().forEach((track) => track.stop());
      cleanup();
      setView("host-setup");
      const permissionDenied = startError instanceof DOMException && startError.name === "NotAllowedError";
      setError(permissionDenied && platform === "darwin"
        ? "O macOS não liberou a captura. Permita o Infinity em Privacidade e Segurança > Gravação de Tela e Áudio do Sistema e abra o app novamente."
        : startError instanceof Error ? startError.message : "Não foi possível iniciar a transmissão.");
    } finally {
      hostStartingRef.current = false;
      setHostStarting(false);
    }
  }, [cleanup, createFilteredAudioTrack, joinP2PRoom, platform, quality, selectedSourceId]);

  const joinRoom = useCallback(async () => {
    const code = normalizeRoomCode(joinCode);
    const name = normalizeDisplayName(viewerName).trim();
    if (name.length < 2) {
      setError("Digite seu nome para o anfitrião reconhecer você.");
      return;
    }
    if (code.replaceAll("-", "").length !== 20) {
      setError("Cole o código completo da sala.");
      return;
    }

    localStorage.setItem("tela-viewer-name", name);
    setViewerName(name);
    viewerAdmissionStateRef.current = "pending";
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
  }, [cleanup, joinCode, joinP2PRoom, viewerName]);

  const leaveSession = useCallback(() => {
    cleanup();
    hostStartingRef.current = false;
    hostRoomCodeRef.current = "";
    setHostStarting(false);
    setRoomCode("");
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
          <img className="brand-logo" src="./brand/infinity-app-icon.png" alt="" />
          <span>Infinity</span>
        </button>
        <div className="topbar-actions">
          {(platform === "darwin" || platform === "win32") && (
            <button className="mac-help-button" onClick={() => { setPermissionNotice(""); setShowPermissionGuide(true); }}>
              <CircleHelp size={15} /> {platform === "darwin" ? "Guia do Mac" : "Permissões"}
            </button>
          )}
          <div className="topbar-status">
            <span className="status-dot" />
            P2P privado
            <span className="version">v{version}</span>
          </div>
        </div>
      </header>

      {updateStatus && ["available", "downloading", "downloaded"].includes(updateStatus.state) && (
        <div className="update-notice" role="status">
          <span className="update-icon"><Download size={16} /></span>
          <span>
            <strong>{updateStatus.state === "downloaded" ? `Versão ${updateStatus.version} pronta` : "Baixando atualização"}</strong>
            <small>{updateStatus.state === "downloading" ? `${updateStatus.percent ?? 0}% concluído` : "O Infinity se mantém atualizado automaticamente no Windows."}</small>
          </span>
          {updateStatus.state === "downloaded" && (
            <button className="button button-primary" onClick={() => void window.telaDesktop.installUpdate()}>
              Reiniciar agora
            </button>
          )}
        </div>
      )}

      {showPermissionGuide && platform && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !permissionBusy) closePermissionGuide();
        }}>
          <section className="mac-guide-dialog" role="dialog" aria-modal="true" aria-labelledby="mac-guide-title">
            <button className="dialog-close" disabled={Boolean(permissionBusy)} onClick={closePermissionGuide} aria-label="Fechar guia">
              <X size={18} />
            </button>
            {platform === "win32" ? (
              <>
                <span className="dialog-kicker">Primeiro acesso no Windows</span>
                <h2 id="mac-guide-title">Libere a conexão direta.</h2>
                <p className="dialog-intro">O Infinity precisa receber a conexão criptografada dos seus amigos. Ele alterará somente as regras ligadas ao próprio aplicativo.</p>
                <div className="permission-list">
                  <div className="permission-row">
                    <span className="permission-icon"><Wifi size={19} /></span>
                    <span><strong>Firewall do Windows</strong><small>TCP e UDP para redes privadas e públicas</small></span>
                    <span className={`permission-state ${connectionPermission?.state === "allowed" ? "allowed" : "attention"}`}>
                      {connectionPermission?.state === "allowed" ? "Liberado" : connectionPermission?.state === "blocked" ? "Bloqueado" : "Pendente"}
                    </span>
                  </div>
                  <div className="permission-row">
                    <span className="permission-icon"><ShieldCheck size={19} /></span>
                    <span><strong>Controle do Windows</strong><small>Você confirma a mudança no aviso de administrador</small></span>
                    <span className="permission-state">Seguro</span>
                  </div>
                </div>
                {permissionNotice && <p className="permission-notice" role="status">{permissionNotice}</p>}
                <div className="dialog-actions">
                  <button className="button button-primary" disabled={Boolean(permissionBusy)} onClick={() => void requestConnectionPermission()}>
                    {permissionBusy === "connection" ? <><LoaderCircle className="spin" size={17} /> Aguardando o Windows…</> : <><ShieldCheck size={17} /> Permitir conexão</>}
                  </button>
                  <button className="button button-ghost" disabled={Boolean(permissionBusy)} onClick={closePermissionGuide}>
                    {pendingPermissionActionRef.current ? "Continuar mesmo assim" : "Agora não"}
                  </button>
                </div>
                <small>O Infinity não desativa o Firewall e não abre portas para outros programas.</small>
              </>
            ) : (
              <>
                <span className="dialog-kicker">Primeiro acesso no macOS</span>
                <h2 id="mac-guide-title">O Mac precisa conhecer o Infinity.</h2>
                <p className="dialog-intro">O macOS pede duas autorizações separadas. Use os botões abaixo e escolha Permitir nos avisos do sistema.</p>
                <div className="permission-list">
                  <div className="permission-row mac-permission-row">
                    <span className="permission-icon"><Wifi size={19} /></span>
                    <span><strong>Rede local</strong><small>Encontra conexões P2P próximas sem expor seus arquivos</small></span>
                    <button disabled={Boolean(permissionBusy)} onClick={() => void requestConnectionPermission()}>
                      {permissionBusy === "connection" ? <LoaderCircle className="spin" size={15} /> : "Solicitar"}
                    </button>
                  </div>
                  <div className="permission-row mac-permission-row">
                    <span className="permission-icon"><MonitorUp size={19} /></span>
                    <span><strong>Tela e áudio</strong><small>Necessário somente para quem inicia uma transmissão</small></span>
                    <button disabled={Boolean(permissionBusy)} onClick={() => void requestCapturePermission()}>
                      {permissionBusy === "capture" ? <LoaderCircle className="spin" size={15} /> : capturePermission === "granted" ? "Liberado" : "Solicitar"}
                    </button>
                  </div>
                </div>
                <ol className="mac-steps compact-steps">
                  <li><span>01</span><p>Se o Mac bloqueou a instalação, abra <strong>Privacidade e Segurança</strong> e clique em <strong>Abrir Mesmo Assim</strong>.</p></li>
                  <li><span>02</span><p>Se uma permissão já foi negada, use os atalhos abaixo para ativar o Infinity manualmente.</p></li>
                </ol>
                {permissionNotice && <p className="permission-notice" role="status">{permissionNotice}</p>}
                <div className="dialog-actions permission-settings-actions">
                  <button className="button button-secondary" onClick={() => void window.telaDesktop.openConnectionSettings()}>
                    <Wifi size={16} /> Ajustes de rede
                  </button>
                  <button className="button button-secondary" onClick={() => void window.telaDesktop.openCaptureSettings()}>
                    <Settings2 size={16} /> Ajustes de captura
                  </button>
                  <button className="button button-ghost" onClick={closePermissionGuide}>Entendi</button>
                </div>
                <small>Esta edição gratuita ainda não possui o certificado pago da Apple. Faça isso somente com o instalador recebido do seu grupo ou baixado no site oficial.</small>
              </>
            )}
          </section>
        </div>
      )}

      {view === "home" && (
        <section className="home-grid page-enter">
          <div className="hero-wordmark" aria-hidden="true">Infinity</div>
          <div className="hero-copy">
            <div className="eyebrow"><Sparkles size={14} /> Só a sua turma entra</div>
            <h1>Sua tela.<br /><span>Sem distância.</span></h1>
            <p>Vídeo e áudio em alta qualidade, direto entre os computadores dos seus amigos. Sem cadastro, sem gravação e sem servidor de vídeo no meio.</p>
            <div className="home-actions">
              <button className="button button-primary" onClick={openHostSetup}>
                <MonitorUp size={18} /> Compartilhar minha tela
              </button>
              <button className="button button-ghost" onClick={openViewerJoin}>
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
            <div className="hero-device-card">
              <span className="device-label">PRIVATE DISPLAY LINK</span>
              <img src="./brand/infinity-app-icon.png" alt="" />
              <div className="device-readout">
                <span><i className="status-dot" /> conectado</span>
                <strong>1440P · 60 FPS</strong>
              </div>
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

              <button className="button button-primary start-button" disabled={!selectedSourceId || sourcesLoading || hostStarting} onClick={() => void startHosting()}>
                {hostStarting ? <><LoaderCircle className="spin" size={18} /> Iniciando…</> : <>Iniciar transmissão <ChevronRight size={18} /></>}
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
            <label htmlFor="viewer-name">Seu nome</label>
            <input
              id="viewer-name"
              className="room-input name-input"
              value={viewerName}
              onChange={(event) => setViewerName(normalizeDisplayName(event.target.value))}
              placeholder="Como seus amigos te chamam"
              maxLength={32}
              autoComplete="nickname"
              autoFocus
            />
            <label htmlFor="room-code">Código da sala</label>
            <input
              id="room-code"
              className="room-input"
              value={joinCode}
              onChange={(event) => setJoinCode(normalizeRoomCode(event.target.value))}
              onKeyDown={(event) => { if (event.key === "Enter") void joinRoom(); }}
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
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
                <p>Envie este código. Você ainda aprova cada pessoa antes de liberar o vídeo.</p>
                <button className="room-code-copy" onClick={() => void copyInvite()}>
                  <span>{roomCode}</span>{copied ? <Check size={18} /> : <Copy size={18} />}
                </button>
                <button className="button button-primary copy-button" onClick={() => void copyInvite()}>
                  {copied ? <><Check size={16} /> Copiado</> : <><Clipboard size={16} /> Copiar código</>}
                </button>
              </div>

              <div className="panel live-quality-card">
                <div className="sidebar-heading">
                  <span className="card-kicker">QUALIDADE AO VIVO</span>
                  <span className={qualityChanging ? "quality-pulse active" : "quality-pulse"} />
                </div>
                <label htmlFor="live-quality">Qualidade ao vivo</label>
                <select
                  id="live-quality"
                  value={qualityKey}
                  disabled={qualityChanging}
                  onChange={(event) => void changeLiveQuality(event.target.value as QualityKey)}
                >
                  {QUALITY_PRESETS.map((preset) => (
                    <option key={preset.key} value={preset.key}>{preset.label} — {preset.detail}</option>
                  ))}
                </select>
                <p>{qualityNotice || "Troque sem encerrar a tela, desconectar amigos ou mudar o código."}</p>
              </div>

              <div className="panel participants-card">
                <div className="sidebar-heading">
                  <span className="card-kicker">PESSOAS</span>
                  <span className="participant-total">{viewerParticipants.length}</span>
                </div>
                {viewerParticipants.length === 0 ? (
                  <div className="participants-empty"><Users size={17} /> Ninguém pediu para entrar.</div>
                ) : (
                  <div className="participant-list">
                    {viewerParticipants.map((participant) => (
                      <div className={`participant-row ${participant.status}`} key={participant.peerId}>
                        <span className="participant-avatar">{participant.name.slice(0, 1).toUpperCase()}</span>
                        <span className="participant-name">
                          <strong>{participant.name}</strong>
                          <small>{participant.status === "pending" ? "Quer assistir" : `Assistindo · ${participant.strategy}`}</small>
                        </span>
                        {participant.status === "pending" ? (
                          <span className="participant-actions">
                            <button
                              type="button"
                              className="participant-allow"
                              onClick={() => void approveViewer(participant.peerId)}
                              aria-label={`Permitir ${participant.name}`}
                              title="Permitir"
                            ><UserCheck size={16} /></button>
                            <button
                              type="button"
                              className="participant-deny"
                              onClick={() => void removeViewer(participant.peerId, "denied")}
                              aria-label={`Recusar ${participant.name}`}
                              title="Recusar"
                            ><UserX size={16} /></button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="participant-deny"
                            onClick={() => void removeViewer(participant.peerId, "kicked")}
                            aria-label={`Remover ${participant.name}`}
                            title="Remover"
                          ><UserMinus size={16} /></button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
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
