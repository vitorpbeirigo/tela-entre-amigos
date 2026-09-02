/// <reference types="vite/client" />

interface CaptureSource {
  id: string;
  name: string;
  displayId: string;
  thumbnail: string;
  appIcon: string | null;
  type: "screen" | "window";
}

interface TurnServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

interface UpdateStatus {
  state: "checking" | "available" | "downloading" | "downloaded" | "current" | "error" | "development" | "manual";
  version?: string;
  percent?: number;
}

interface FilteredAudioStatus {
  state: "ready" | "error";
  discordExcluded?: boolean;
}

type ConnectionPermissionState = "allowed" | "blocked" | "missing" | "unavailable" | "cancelled" | "failed" | "requested" | "system-managed";

interface ConnectionPermissionStatus {
  state: ConnectionPermissionState;
  verificationState?: ConnectionPermissionState;
  blockedRules?: number;
  allowedRules?: number;
  matchingAllowedRules?: number;
}

interface Window {
  telaDesktop: {
    getSources(): Promise<CaptureSource[]>;
    selectSource(sourceId: string): Promise<boolean>;
    startDiscordFilteredAudio(): Promise<{ discordExcluded: boolean }>;
    stopDiscordFilteredAudio(): Promise<boolean>;
    onAudioPcm(callback: (chunk: Uint8Array, capturedAt?: number) => void): () => void;
    onAudioStatus(callback: (status: FilteredAudioStatus) => void): () => void;
    getVersion(): Promise<string>;
    getPlatform(): Promise<NodeJS.Platform>;
    getCapturePermission(): Promise<"not-determined" | "granted" | "denied" | "restricted" | "unknown">;
    requestCapturePermission(): Promise<"not-determined" | "granted" | "denied" | "restricted" | "unknown">;
    openCaptureSettings(): Promise<boolean>;
    getConnectionPermission(): Promise<ConnectionPermissionStatus>;
    requestConnectionPermission(): Promise<ConnectionPermissionStatus>;
    openConnectionSettings(): Promise<boolean>;
    copyText(value: string): Promise<boolean>;
    getTurnServers(): Promise<TurnServerConfig[]>;
    logEvent(name: string, details?: Record<string, string | number | boolean>): void;
    checkForUpdates(): Promise<{ state: string }>;
    installUpdate(): Promise<boolean>;
    onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  };
}
