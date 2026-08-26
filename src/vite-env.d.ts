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

interface Window {
  telaDesktop: {
    getSources(): Promise<CaptureSource[]>;
    selectSource(sourceId: string, withSystemAudio: boolean): Promise<boolean>;
    getVersion(): Promise<string>;
    getPlatform(): Promise<NodeJS.Platform>;
    getCapturePermission(): Promise<"not-determined" | "granted" | "denied" | "restricted" | "unknown">;
    openCaptureSettings(): Promise<boolean>;
    copyText(value: string): Promise<boolean>;
    getTurnServers(): Promise<TurnServerConfig[]>;
    checkForUpdates(): Promise<{ state: string }>;
    installUpdate(): Promise<boolean>;
    onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  };
}
