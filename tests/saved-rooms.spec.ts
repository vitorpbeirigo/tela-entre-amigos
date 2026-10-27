import { expect, test } from "@playwright/test";
import { createSavedRoom, forgetRoom, loadLocalIdentity, loadSavedRooms, parseRoomInvite, roomInvite, saveRoom } from "../src/saved-rooms";

test.beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } });
});
test.afterEach(() => { Reflect.deleteProperty(globalThis, "localStorage"); });

test("convite privado preserva sala e nome Unicode, rejeitando entrada inválida", () => {
  const room = createSavedRoom("  Café dos amigos  ");
  expect(room.name).toBe("Café dos amigos");
  expect(parseRoomInvite(roomInvite(room))).toEqual(room);
  expect(createSavedRoom(room.name).id).not.toBe(room.id);
  for (const input of ["", "a".repeat(2049), roomInvite(room).replace(room.secret, "wrong"), "INFINITY1:x:y:%", "javascript:alert(1)"]) {
    expect(() => parseRoomInvite(input)).toThrow();
  }
});

test("sala e identidade persistem, sair não apaga e convite diferente não substitui segredo", () => {
  const room = createSavedRoom("Turma");
  saveRoom(room);
  saveRoom(parseRoomInvite(roomInvite(room)));
  expect(loadSavedRooms()).toEqual([room]);
  const identity = loadLocalIdentity();
  expect(loadLocalIdentity()).toEqual(identity);
  expect(() => saveRoom({ ...room, secret: createSavedRoom("Outra").secret })).toThrow();
  forgetRoom(room.id);
  expect(loadSavedRooms()).toEqual([]);
  expect(loadLocalIdentity()).toEqual(identity);
});

test("dados corrompidos e armazenamento bloqueado não fingem que a sala ficou salva", () => {
  localStorage.setItem("infinity-saved-rooms-v1", "not-json");
  expect(() => loadSavedRooms()).toThrow();
  expect(() => saveRoom(createSavedRoom("Turma"))).toThrow();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get: () => { throw new Error("blocked"); } });
  expect(() => saveRoom(createSavedRoom("Turma"))).toThrow();
});
