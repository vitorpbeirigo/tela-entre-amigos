import { isSecret, randomSecret } from "./room-access";

export interface SavedRoom { id: string; name: string; secret: string }
const STORAGE_KEY = "infinity-saved-rooms-v1";
const IDENTITY_KEY = "infinity-device-v1";
export const cleanName = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 48);

function isRoom(value: unknown): value is SavedRoom {
  const room = value as SavedRoom | null;
  return Boolean(room && isSecret(room.id) && isSecret(room.secret) && typeof room.name === "string" &&
    room.name.length > 0 && room.name === cleanName(room.name));
}

export function createSavedRoom(name: string): SavedRoom {
  const normalized = cleanName(name);
  if (!normalized) throw new Error("Dê um nome para a sala.");
  return { id: randomSecret(), secret: randomSecret(), name: normalized };
}

export function roomInvite(room: SavedRoom) {
  return `INFINITY1:${room.id}:${room.secret}:${encodeURIComponent(room.name)}`;
}

export function parseRoomInvite(value: string): SavedRoom {
  try {
    if (value.length > 1024) throw new Error();
    const [version, id, secret, encodedName, extra] = value.trim().split(":");
    const room = { id, secret, name: decodeURIComponent(encodedName ?? "") };
    if (version !== "INFINITY1" || extra !== undefined || !isRoom(room)) throw new Error();
    return room;
  } catch { throw new Error("Convite inválido. Cole o convite completo enviado pelo seu amigo."); }
}

export function loadSavedRooms(): SavedRoom[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    if (data?.version !== 1 || !Array.isArray(data.rooms) || data.rooms.length > 20 || !data.rooms.every(isRoom) ||
      new Set(data.rooms.map((room: SavedRoom) => room.id)).size !== data.rooms.length) throw new Error();
    return data.rooms;
  } catch { throw new Error("Não foi possível ler as salas salvas. Verifique os dados do aplicativo antes de importar outra sala."); }
}

function store(rooms: SavedRoom[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, rooms })); }
  catch { throw new Error("Não foi possível salvar neste computador. Libere o armazenamento do aplicativo e tente novamente."); }
}

export function saveRoom(room: SavedRoom) {
  if (!isRoom(room)) throw new Error("Sala inválida.");
  const rooms = loadSavedRooms();
  const existing = rooms.find((item) => item.id === room.id);
  if (existing && existing.secret !== room.secret) throw new Error("Esse convite não corresponde à chave da sala salva.");
  if (!existing && rooms.length >= 20) throw new Error("Você já tem 20 salas salvas. Esqueça uma sala antes de adicionar outra.");
  store([...rooms.filter((item) => item.id !== room.id), room]);
}

export function forgetRoom(id: string) { store(loadSavedRooms().filter((room) => room.id !== id)); }

export function loadLocalIdentity(): string {
  try {
    const saved = localStorage.getItem(IDENTITY_KEY);
    if (isSecret(saved)) return saved;
    const identity = randomSecret();
    localStorage.setItem(IDENTITY_KEY, identity);
    return identity;
  } catch { throw new Error("Não foi possível salvar sua identificação neste computador."); }
}
