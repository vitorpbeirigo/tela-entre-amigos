import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRejoinProof, verifyRejoinProof, randomSecret, loadRoomGrant, saveRoomGrant, forgetRoomGrant } from "../src/room-access";

function audioQueue(sampleRate = 48_000) {
  let Queue: any;
  vm.runInNewContext(readFileSync("public/tela-pcm-worklet.js", "utf8"), {
    Float32Array, sampleRate,
    AudioWorkletProcessor: class { port = { onmessage: null, postMessage() {} }; },
    registerProcessor(_name: string, constructor: any) { Queue = constructor; },
  });
  const queue = new Queue();
  return { queue, push: (data: Float32Array) => queue.port.onmessage({ data }),
    read: (frames = 128) => {
      const output = [new Float32Array(frames), new Float32Array(frames)];
      queue.process([], [output]);
      return output;
    } };
}

test("PCM preserva stereo, ordem e silêncio no underrun", () => {
  const { push, read } = audioQueue();
  push(new Float32Array([0.25, -0.25, 0.5, -0.5]));
  expect(read(3).map((channel) => [...channel])).toEqual([[0.25, 0.5, 0], [-0.25, -0.5, 0]]);
  expect(read(2).map((channel) => [...channel])).toEqual([[0, 0], [0, 0]]);
});

for (const rate of [44100, 48000]) {
  test(`PCM limita backlog a 120ms e volta para 40ms sob sobrecarga (${rate}Hz)`, () => {
    const { queue, push, read } = audioQueue(rate);
    push(new Float32Array(rate * 2 * 4).fill(0.1)); // Old implementation buffered seconds.
    expect(queue.queuedSamples).toBe(Math.round(rate * 0.04) * 2);
    push(new Float32Array(rate * 2).fill(0.5));
    expect(read(128)[0][0]).toBe(0.5); // Newest audio, not the old backlog.
    for (let i = 0; i < 100; i++) {
      push(new Float32Array(2048).fill(i % 2 ? 0.25 : 0.5));
      read();
      expect(queue.queuedSamples).toBeLessThanOrEqual(queue.capacity);
    }
    expect(queue.droppedSamples).toBeGreaterThan(0);
  });
}

test("autorização de retorno exige segredo e desafio ligados à mesma sessão e pessoa", async () => {
  const grant = { id: randomSecret(), secret: randomSecret() };
  const nonce = randomSecret();
  const proof = await createRejoinProof(grant, "room", "host", "viewer", nonce);
  expect(await verifyRejoinProof(grant, "room", "host", "viewer", nonce, proof)).toBe(true);
  for (const [room, host, viewer, challenge] of [
    ["other-room", "host", "viewer", nonce], ["room", "other-host", "viewer", nonce],
    ["room", "host", "other-viewer", nonce], ["room", "host", "viewer", randomSecret()],
  ]) expect(await verifyRejoinProof(grant, room, host, viewer, challenge, proof)).toBe(false);
  expect(await verifyRejoinProof({ ...grant, secret: randomSecret() }, "room", "host", "viewer", nonce, proof)).toBe(false);
  expect(await verifyRejoinProof(grant, "room", "host", "viewer", nonce, "malformed")).toBe(false);
});

test("credenciais locais são limitadas e podem ser revogadas sem expirar uma transmissão longa", () => {
  const storage: Record<string, string> = {};
  Object.defineProperties(storage, {
    getItem: { value: (key: string) => storage[key] ?? null },
    setItem: { value: (key: string, value: string) => { storage[key] = value; } },
    removeItem: { value: (key: string) => { delete storage[key]; } },
  });
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  try {
    const grant = { id: randomSecret(), secret: randomSecret() };
    for (let i = 0; i < 25; i++) saveRoomGrant(String(i), grant, "host");
    expect(Object.keys(storage)).toHaveLength(20);
    expect(loadRoomGrant("24")?.secret).toBe(grant.secret);
    forgetRoomGrant("24");
    expect(loadRoomGrant("24")).toBeNull();
    storage["infinity-room-grant-v1:expired"] = JSON.stringify({ ...grant, hostPeerId: "host", savedAt: Date.now() - 86_400_001 });
    expect(loadRoomGrant("expired")?.secret).toBe(grant.secret);
    storage["infinity-room-grant-v1:bad"] = "broken-json";
    expect(loadRoomGrant("bad")).toBeNull();
  } finally { Reflect.deleteProperty(globalThis, "localStorage"); }
});
