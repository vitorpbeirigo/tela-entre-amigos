import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Copy, Expand, Eye, Grid2X2, Headphones, Link2, LoaderCircle, MonitorUp, Plus, Radio, RefreshCw, ScreenShareOff, ShieldCheck, Trash2, Users, Volume2, VolumeX, X } from "lucide-react";
import { joinRoom as joinNostrRoom, type Room } from "trystero";
import { joinRoom as joinMqttRoom } from "@trystero-p2p/mqtt";
import { joinRoom as joinTorrentRoom } from "@trystero-p2p/torrent";
import { FriendsSession, type FriendMember, type FriendsSnapshot } from "./friends-session";
import { cleanName, createSavedRoom, forgetRoom, loadLocalIdentity, loadSavedRooms, parseRoomInvite, roomInvite, saveRoom, type SavedRoom } from "./saved-rooms";
import { QUALITY_PRESETS, type CaptureScreen, type QualityKey } from "./screen-media";
import { connectionReport, getTransportConfig, resetConnectionDiagnostics } from "./connection-diagnostics";
import "./friends.css";

let pendingRoomLeave: Promise<void> = Promise.resolve();
const EMPTY: FriendsSnapshot = { members: [], watching: [], viewers: 0, streamId: null, quality: "performance", error: "", connectionNotice: "" };
const message = (error: unknown) => error instanceof Error ? error.message : "Não foi possível concluir. Tente novamente.";

function ScreenTile({ member, focused, muted, volume, onFocus, onVolume, onClose }: {
  member: FriendMember; focused: boolean; muted: boolean; volume: number;
  onFocus: () => void; onVolume: (volume: number) => void; onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [needsPlay, setNeedsPlay] = useState(false);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.srcObject = member.stream;
    element.volume = volume;
    element.muted = muted || volume === 0;
    if (member.stream) void element.play().then(() => setNeedsPlay(false)).catch(() => setNeedsPlay(true));
    return () => { element.srcObject = null; };
  }, [member.stream, muted, volume]);
  return (
    <article className={`friend-screen ${focused ? "audio-focus" : ""}`} data-member={member.id} aria-label={`Tela de ${member.name}`}>
      <div className="friend-screen-video">
        <video ref={video} autoPlay playsInline muted={muted || volume === 0} />
        {!member.stream && <div className="friend-screen-wait" role="status">
          <LoaderCircle size={24} className={member.streamId && member.connected ? "spin" : ""} />
          <strong>{!member.connected ? "Reconectando ao amigo…" : member.streamId ? "Conectando à tela…" : "Aguardando a próxima transmissão"}</strong>
          <small>A sala e seu acesso continuam salvos.</small>
        </div>}
        {needsPlay && member.stream && <button className="button button-primary tile-play" onClick={() => {
          void video.current?.play().then(() => setNeedsPlay(false)).catch(() => undefined);
        }}>Reproduzir tela</button>}
      </div>
      <div className="friend-screen-controls">
        <button className="screen-focus" onClick={onFocus} aria-pressed={focused} aria-label={`Ouvir ${member.name}`}>
          {focused ? <Volume2 size={15} /> : <VolumeX size={15} />} <span>{member.name}</span>
        </button>
        <input type="range" min="0" max="100" value={Math.round(volume * 100)} onChange={(event) => onVolume(Number(event.target.value) / 100)} aria-label={`Volume de ${member.name}`} />
        <button className="icon-button" onClick={onClose} aria-label={`Parar de assistir ${member.name}`} title="Parar de assistir"><X size={17} /></button>
      </div>
    </article>
  );
}

export default function FriendsHub({ platform, capture, stopAudio, onBack, captureError }: {
  platform: string; capture: CaptureScreen; stopAudio: () => void; onBack: () => void; captureError: string;
}) {
  const [initial] = useState(() => { try { return { rooms: loadSavedRooms(), error: "" }; } catch (error) { return { rooms: [], error: message(error) }; } });
  const [rooms, setRooms] = useState(initial.rooms);
  const [name, setName] = useState(() => { try { return localStorage.getItem("tela-viewer-name") ?? ""; } catch { return ""; } });
  const [roomName, setRoomName] = useState("");
  const [invite, setInvite] = useState("");
  const [active, setActive] = useState<SavedRoom | null>(null);
  const [state, setState] = useState(EMPTY);
  const [error, setError] = useState(initial.error);
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [layout, setLayout] = useState<"mosaic" | "focus">("mosaic");
  const [focus, setFocus] = useState("");
  const [volumes, setVolumes] = useState<Record<string, number>>({});
  const [copied, setCopied] = useState(false);
  const [diagnosticCopied, setDiagnosticCopied] = useState(false);
  const [picker, setPicker] = useState(false);
  const [sources, setSources] = useState<CaptureSource[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [quality, setQuality] = useState<QualityKey>("performance");
  const [withAudio, setWithAudio] = useState(true);
  const [qualityBusy, setQualityBusy] = useState(false);
  const session = useRef<FriendsSession | null>(null);
  const localStream = useRef<MediaStream | null>(null);
  const mounted = useRef(true);
  const operation = useRef(0);
  const captureOperation = useRef(0);
  const busyRef = useRef(false);
  const sourcesOperation = useRef(0);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; operation.current++; captureOperation.current++; sourcesOperation.current++;
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      localStream.current?.getTracks().forEach((track) => track.stop()); localStream.current = null;
      stopAudio();
      if (session.current) { pendingRoomLeave = session.current.close(); session.current = null; }
    };
  }, [stopAudio]);

  useEffect(() => {
    if (picker && !dialog.current?.open) dialog.current?.showModal();
    if (!picker && dialog.current?.open) dialog.current.close();
  }, [picker]);

  const stopSharing = () => {
    captureOperation.current++;
    session.current?.setStream(null);
    localStream.current?.getTracks().forEach((track) => track.stop()); localStream.current = null;
    stopAudio(); setSharing(false);
  };

  const leave = async () => {
    operation.current++; sourcesOperation.current++; stopSharing(); setPicker(false); setActive(null); setState(EMPTY); setFocus("");
    const current = session.current; session.current = null;
    if (current) pendingRoomLeave = current.close();
    await pendingRoomLeave;
  };

  const enter = async (room: SavedRoom) => {
    if (busyRef.current) return;
    const displayName = cleanName(name).slice(0, 32);
    if (displayName.length < 2) { setError("Digite seu nome para seus amigos reconhecerem você."); return; }
    busyRef.current = true; setBusy(true); setError("");
    try {
      const identity = loadLocalIdentity();
      localStorage.setItem("tela-viewer-name", displayName); setName(displayName);
      await leave();
      const epoch = ++operation.current;
      if (!mounted.current) return;
      resetConnectionDiagnostics(); setDiagnosticCopied(false);
      // Trystero 0.26 changed its action wire format; old clients must use a separate namespace.
      const config = { appId: "com.gregpreto.infinity.friends.v2", password: room.secret };
      const routes: Room[] = [];
      let controller: FriendsSession | undefined;
      const strategies = new Map<Room, { name: string; join: typeof joinNostrRoom }>();
      const createRoute = (strategy: string, join: typeof joinNostrRoom): Room => {
        const route = join({ ...config, ...getTransportConfig(strategy) }, room.id, { onJoinError: (details) => {
          if (mounted.current && operation.current === epoch) controller?.reportRouteFailure(route, details.error, details.peerId, strategy);
        } });
        strategies.set(route, { name: strategy, join });
        return route;
      };
      try {
        for (const [strategy, join] of [["Nostr", joinNostrRoom], ["MQTT", joinMqttRoom], ["Torrent", joinTorrentRoom]] as const) routes.push(createRoute(strategy, join));
        controller = new FriendsSession(identity, displayName, routes, (snapshot) => {
          if (mounted.current && session.current === controller) setState(snapshot);
        }, (previous) => {
          const strategy = strategies.get(previous);
          if (!strategy) throw new Error("Rota de conexão indisponível.");
          const replacement = createRoute(strategy.name, strategy.join);
          strategies.delete(previous);
          return replacement;
        });
        session.current = controller;
        setState(controller.snapshot()); setActive(room); setQuality("performance"); setLayout("mosaic");
      } catch (joinError) {
        await Promise.allSettled(routes.map((route) => route.leave())); throw joinError;
      }
    } catch (enterError) { if (mounted.current) setError(message(enterError)); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };

  const saveAndEnter = async (kind: "create" | "invite") => {
    if (busyRef.current) return;
    try {
      if (cleanName(name).length < 2) throw new Error("Digite seu nome para seus amigos reconhecerem você.");
      const room = kind === "create" ? createSavedRoom(roomName) : parseRoomInvite(invite);
      saveRoom(room); setRooms(loadSavedRooms()); setInvite(""); setRoomName("");
      await enter(room);
    } catch (saveError) { setError(message(saveError)); }
  };

  const copyInvite = async () => {
    if (!active) return;
    try {
      if (!await window.telaDesktop.copyText(roomInvite(active))) throw new Error();
      setCopied(true); if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => { if (mounted.current) setCopied(false); }, 2000);
    } catch { setError("Não foi possível copiar o convite. Tente novamente."); }
  };

  const loadSources = async () => {
    const epoch = ++sourcesOperation.current;
    setSourcesLoading(true); setError("");
    try {
      const available = await window.telaDesktop.getSources();
      if (!mounted.current || sourcesOperation.current !== epoch) return;
      setSources(available); setSourceId((current) => available.some((source) => source.id === current) ? current : available[0]?.id ?? "");
      if (!available.length) setError("Nenhuma tela disponível. Confira as permissões de captura do sistema.");
    } catch (sourceError) { if (mounted.current && sourcesOperation.current === epoch) setError(message(sourceError)); }
    finally { if (mounted.current && sourcesOperation.current === epoch) setSourcesLoading(false); }
  };

  const startSharing = async () => {
    const current = session.current;
    if (!current || !sourceId || busyRef.current) return;
    const epoch = ++captureOperation.current;
    const isCurrent = () => mounted.current && captureOperation.current === epoch && session.current === current;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const preset = QUALITY_PRESETS.find((item) => item.key === quality)!;
      const stream = await capture(sourceId, preset, withAudio, isCurrent);
      if (!isCurrent()) { stream.getTracks().forEach((track) => track.stop()); return; }
      await current.setQuality(preset);
      if (!isCurrent()) { stream.getTracks().forEach((track) => track.stop()); return; }
      localStream.current = stream;
      stream.getVideoTracks()[0].addEventListener("ended", () => { if (isCurrent()) stopSharing(); }, { once: true });
      current.setStream(stream); setSharing(true); setPicker(false);
    } catch (captureFailure) {
      if (!isCurrent()) return;
      stopSharing();
      const denied = captureFailure instanceof DOMException && captureFailure.name === "NotAllowedError";
      setError(denied && platform === "darwin" ? "Permita o Infinity em Privacidade e Segurança > Gravação de Tela e Áudio do Sistema e abra o app novamente." : message(captureFailure));
    } finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  };

  const changeQuality = async (key: QualityKey) => {
    const current = session.current;
    if (!current || qualityBusy) return;
    setQualityBusy(true); setError("");
    try { await current.setQuality(QUALITY_PRESETS.find((item) => item.key === key)!); if (session.current === current) setQuality(key); }
    catch { setError("A tela não aceitou esta qualidade. Sua transmissão continua na configuração anterior."); }
    finally { if (mounted.current) setQualityBusy(false); }
  };

  const selected = state.members.filter((member) => state.watching.includes(member.id));
  const focused = selected.find((member) => member.id === focus) ?? selected[0];
  const displayed = layout === "focus" && focused ? [focused] : selected;
  const online = state.members.filter((member) => member.connected);
  const visibleError = error || state.error || captureError;

  return (
    <section className="friends-layout">
      <aside className="friends-sidebar" aria-label="Suas salas">
        <button className="button button-ghost friends-back" disabled={busy} onClick={onBack}><ArrowLeft size={15} /> Início</button>
        <div className="friends-sidebar-heading"><span className="eyebrow">Seu ponto de encontro</span><h2>Suas salas<span>.</span></h2></div>
        <label htmlFor="friends-name">Seu nome na sala</label>
        <input id="friends-name" value={name} maxLength={32} disabled={Boolean(active) || busy} onChange={(event) => setName(event.target.value)} placeholder="Como a turma te chama?" autoComplete="nickname" />
        <nav className="saved-room-list" aria-label="Salas salvas">
          {rooms.map((room) => <div key={room.id} className={`saved-room ${active?.id === room.id ? "active" : ""}`}>
            <button onClick={() => void enter(room)} disabled={busy || active?.id === room.id} aria-label={`Entrar na sala ${room.name}`}><span className="saved-room-icon"><Users size={19} /></span><span>{room.name}<small>{active?.id === room.id ? "Você está aqui" : "Salva neste computador"}</small></span></button>
            {!active && <button className="forget-room icon-button" disabled={busy} aria-label={`Esquecer sala ${room.name}`} title="Esquecer neste computador" onClick={() => {
              if (!window.confirm(`Esquecer “${room.name}” neste computador? Para voltar, será necessário o convite.`)) return;
              try { forgetRoom(room.id); setRooms(loadSavedRooms()); } catch (forgetError) { setError(message(forgetError)); }
            }}><Trash2 size={14} /></button>}
          </div>)}
        </nav>
        {active && <button className="button button-secondary" disabled={busy} onClick={() => void leave()}><Plus size={16} /> Adicionar outra sala</button>}
        <div className="friends-sidebar-note"><ShieldCheck size={17} /><p>Convite uma vez.<br />Sua turma sempre por perto.</p></div>
        <p className="friends-voice-note"><Headphones size={15} /> A conversa continua no Discord.</p>
      </aside>

      <div className="friends-content">
        {visibleError && <div className="friends-error" role="alert"><span>{visibleError}</span><button className="icon-button" aria-label="Abrir permissões" title="Abrir permissões de rede" onClick={() => void window.telaDesktop.openConnectionSettings()}><ShieldCheck size={17} /></button></div>}
        {active && state.connectionNotice && <div className="friends-error friends-connection-notice" role="status"><span>{state.connectionNotice}</span><button className="button button-secondary" onClick={() => void session.current?.retryConnections(true)}><RefreshCw size={15} /> Tentar reconectar</button></div>}
        {!active ? <div className="friends-welcome">
          <span className="eyebrow"><Users size={14} /> Entre uma vez. Volte sempre.</span>
          <h1>A turma junta.<br /><em>Cada um na sua tela.</em></h1>
          <p>Crie o ponto de encontro dos seus amigos ou entre com um convite. A sala fica salva, mesmo depois de fechar o Infinity.</p>
          <div className="friends-entry-forms">
            <form onSubmit={(event) => { event.preventDefault(); void saveAndEnter("create"); }}>
              <span className="friends-form-icon"><Plus size={22} /></span><h2>Comece uma sala</h2>
              <label htmlFor="friends-room-name">Nome da sala</label><input id="friends-room-name" value={roomName} maxLength={48} onChange={(event) => setRoomName(event.target.value)} placeholder="Sala da turma" required />
              <button className="button button-primary" disabled={busy} type="submit">Criar sala</button>
            </form>
            <form onSubmit={(event) => { event.preventDefault(); void saveAndEnter("invite"); }}>
              <span className="friends-form-icon"><Link2 size={22} /></span><h2>Recebeu um convite?</h2>
              <label htmlFor="friends-invite">Convite da sala</label><input id="friends-invite" value={invite} maxLength={1024} onChange={(event) => setInvite(event.target.value)} placeholder="Cole o convite do seu amigo" required spellCheck={false} autoComplete="off" />
              <button className="button button-secondary" disabled={busy} type="submit">Salvar e entrar</button>
            </form>
          </div>
          <small>Compartilhe o convite somente com sua turma. Quem tiver o convite poderá entrar.</small>
        </div> : <>
          <header className="friends-room-heading">
            <div><span className="eyebrow"><i className="status-dot" /> Sala privada</span><h1>{active.name}</h1><p>{online.length + 1} {online.length ? "pessoas conectadas" : "pessoa conectada"} · {online.filter((member) => member.streamId).length + Number(sharing)} telas ao vivo</p></div>
            <div className="friends-room-actions">
              <button className="icon-button" aria-label="Atualizar conexões" title="Atualizar conexões" onClick={() => void session.current?.retryConnections(true)}><RefreshCw size={17} /></button>
              <button className="button button-secondary" onClick={() => void (async () => {
                const epoch = operation.current;
                try {
                  const version = await window.telaDesktop.getVersion();
                  const ok = await window.telaDesktop.copyText(connectionReport(version, platform, online.length + 1));
                  if (!ok) throw new Error("Não foi possível copiar o diagnóstico.");
                  if (mounted.current && operation.current === epoch) setDiagnosticCopied(true);
                } catch (copyError) { if (mounted.current && operation.current === epoch) setError(message(copyError)); }
              })()} aria-label="Copiar diagnóstico de conexão">{diagnosticCopied ? <Check size={15} /> : <Copy size={15} />}{diagnosticCopied ? "Diagnóstico copiado" : "Diagnóstico"}</button>
              <button className="button button-secondary" onClick={() => void copyInvite()} aria-label="Copiar convite">{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copiado" : "Convidar amigos"}</button><button className="icon-button" disabled={busy} aria-label="Sair da sala" title="Sair da sala" onClick={() => void leave()}><ArrowLeft size={18} /></button>
            </div>
          </header>
          <p className="friends-version-note">Todos da sala precisam atualizar para o Infinity 0.11.0. O convite continua o mesmo.</p>
          <div className="friends-stage-toolbar">
            <span><Eye size={15} /> {selected.length}/4 telas abertas</span>
            <div><button className={layout === "mosaic" ? "selected" : ""} aria-pressed={layout === "mosaic"} onClick={() => setLayout("mosaic")}><Grid2X2 size={15} /> Mosaico</button><button className={layout === "focus" ? "selected" : ""} aria-pressed={layout === "focus"} onClick={() => setLayout("focus")}><Expand size={15} /> Foco</button><button aria-label="Tela cheia" onClick={() => void stage.current?.requestFullscreen().catch(() => setError("Não foi possível abrir a tela cheia."))}><Expand size={16} /></button></div>
          </div>
          <div ref={stage} className={`friends-stage ${layout} count-${displayed.length}`}>
            {!displayed.length ? <div className="friends-empty"><span className="friends-empty-icon"><MonitorUp size={38} /></span><h2>{online.length ? "Escolha uma tela para assistir" : "Só você por enquanto"}</h2><p>{online.length ? "Quem compartilhar aparece logo abaixo. Clique em Assistir para abrir a transmissão." : "Chame a turma pelo convite. Seus amigos podem entrar mesmo quando você estiver offline."}</p><small>Até quatro telas no mosaico. Áudio de uma por vez.</small></div> : displayed.map((member) => <ScreenTile key={member.id} member={member} focused={focused?.id === member.id} muted={sharing || busy || focused?.id !== member.id} volume={volumes[member.id] ?? 0.75} onFocus={() => setFocus(member.id)} onVolume={(volume) => setVolumes((values) => ({ ...values, [member.id]: volume }))} onClose={() => session.current?.unwatch(member.id)} />)}
          </div>
          {sharing && selected.length > 0 && <p className="friends-audio-note"><VolumeX size={14} /> Áudio das outras telas pausado enquanto você compartilha, para evitar retorno.</p>}
          {selected.some((member) => !member.stream) && <p className="friends-audio-note">Aguardando vídeo? Confira as permissões de rede nos dois computadores. Redes restritas podem impedir P2P.</p>}
          <section className="friends-people" aria-label="Pessoas na sala">
            <div className="friends-section-heading"><h2>Na sala <span>{online.length + 1}</span></h2><small>{sharing ? `${state.viewers} assistindo à sua tela` : "Você escolhe o que assistir"}</small></div>
            <div className="friends-member-grid">
              <article className={`friend-person self ${sharing ? "is-live" : ""}`}><span className="friend-avatar">{name.slice(0, 2).toUpperCase()}</span><div><strong>{name} <small>você</small></strong><span>{sharing ? "Sua tela está ao vivo" : "Pronto para compartilhar"}</span></div>{sharing ? <span className="friend-live"><Radio size={12} /> AO VIVO</span> : <ShieldCheck className="friend-self-check" size={18} />}</article>
              {state.members.map((member) => <article key={member.id} className={`friend-person ${member.streamId ? "is-live" : ""}`}><span className="friend-avatar">{member.name.slice(0, 2).toUpperCase()}</span><div><strong>{member.name}</strong><span>{!member.connected ? "Reconectando…" : member.streamId ? "Compartilhando tela" : "Na sala"}</span></div>{state.watching.includes(member.id) ? <button className="friend-watch watching" onClick={() => session.current?.unwatch(member.id)} aria-label={`Parar de assistir ${member.name}`}><X size={14} /> Fechar</button> : member.streamId && member.connected ? <button className="friend-watch" onClick={() => {
                try { session.current?.watch(member.id); if (!focus) setFocus(member.id); setError(""); } catch (watchError) { setError(message(watchError)); }
              }} aria-label={`Assistir ${member.name}`}><Eye size={14} /> Assistir</button> : null}</article>)}
            </div>
          </section>
          <footer className="friends-share-bar"><div><MonitorUp size={20} /><span><strong>{sharing ? "Você está compartilhando" : "Mostre o que está acontecendo"}</strong><small>{sharing ? "Parar a tela mantém você na sala." : "Jogos, filmes ou qualquer janela. Sua voz continua no Discord."}</small></span></div>
            {sharing && <select aria-label="Qualidade da sua transmissão" value={quality} disabled={qualityBusy || busy} onChange={(event) => void changeQuality(event.target.value as QualityKey)}>{QUALITY_PRESETS.map((preset) => <option key={preset.key} value={preset.key}>{preset.label} · {preset.height}p · {preset.frameRate} FPS</option>)}</select>}
            <button className={`button ${sharing ? "button-danger" : "button-primary"}`} disabled={busy || !platform} onClick={() => {
              if (sharing) stopSharing(); else { setWithAudio(platform !== "darwin"); setPicker(true); void loadSources(); }
            }} aria-label={sharing ? "Parar compartilhamento" : "Compartilhar tela"}>{sharing ? <ScreenShareOff size={17} /> : <MonitorUp size={17} />}{sharing ? "Parar compartilhamento" : "Compartilhar tela"}</button>
          </footer>
        </>}
      </div>

      <dialog ref={dialog} className="friends-capture-dialog" aria-labelledby="friends-capture-title" onCancel={(event) => { if (busy) event.preventDefault(); else setPicker(false); }}>
        <div className="friends-capture-heading"><div><span className="eyebrow">Compartilhar nesta sala</span><h2 id="friends-capture-title">O que a turma vai ver?</h2></div><button className="icon-button" disabled={busy} aria-label="Fechar seleção de tela" onClick={() => setPicker(false)}><X size={19} /></button></div>
        {visibleError && <p className="friends-error" role="alert">{visibleError}<button className="button button-ghost" onClick={() => void window.telaDesktop.openCaptureSettings()}>Ajustes de captura</button></p>}
        <div className="friends-source-heading"><span>Tela ou janela</span><button className="icon-button" disabled={busy || sourcesLoading} aria-label="Atualizar telas e janelas" onClick={() => void loadSources()}><RefreshCw size={16} className={sourcesLoading ? "spin" : ""} /></button></div>
        <div className="source-grid friends-source-grid">{sources.map((source) => <button key={source.id} className={`source-card ${sourceId === source.id ? "selected" : ""}`} disabled={busy} onClick={() => setSourceId(source.id)} aria-pressed={sourceId === source.id}><div className="source-preview"><img src={source.thumbnail} alt="" /></div><div className="source-name"><MonitorUp size={15} /><span>{source.name}</span></div></button>)}</div>
        <div className="friends-capture-options"><label>Qualidade<select aria-label="Qualidade ao compartilhar" value={quality} disabled={busy} onChange={(event) => setQuality(event.target.value as QualityKey)}>{QUALITY_PRESETS.map((preset) => <option key={preset.key} value={preset.key}>{preset.label} · {preset.detail}</option>)}</select></label><label className="friends-audio-checkbox"><input type="checkbox" checked={withAudio} disabled={busy} onChange={(event) => setWithAudio(event.target.checked)} /> Compartilhar áudio do computador</label></div>
        <p className="friends-capture-note">{platform === "win32" ? "O filtro do Discord continua ativo. Use Jogar para reduzir o uso da GPU." : "No Mac, o áudio do sistema também inclui o Discord. Mantenha desativado para evitar retorno na chamada."}</p>
        <button className="button button-primary friends-start" disabled={busy || sourcesLoading || !sourceId} onClick={() => void startSharing()}>{busy ? <LoaderCircle className="spin" size={18} /> : <MonitorUp size={18} />} {busy ? "Iniciando…" : "Iniciar compartilhamento"}</button>
      </dialog>
    </section>
  );
}
