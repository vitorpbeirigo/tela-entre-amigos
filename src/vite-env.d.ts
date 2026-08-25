/// <reference types="vite/client" />

interface CaptureSource {
  id: string;
  name: string;
  displayId: string;
  thumbnail: string;
  appIcon: string | null;
  type: "screen" | "window";
}

interface Window {
  telaDesktop: {
    getSources(): Promise<CaptureSource[]>;
    selectSource(sourceId: string, withSystemAudio: boolean): Promise<boolean>;
    getVersion(): Promise<string>;
  };
}
