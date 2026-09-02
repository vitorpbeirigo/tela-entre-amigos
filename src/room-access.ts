// Grants live only for one host transmission. Announce ids, never the secret.
export interface RoomGrant { id: string; secret: string }
export interface SavedRoomGrant extends RoomGrant { hostPeerId: string; savedAt: number }
export const randomSecret = () => Array.from(crypto.getRandomValues(new Uint8Array(32)),
  (byte) => byte.toString(16).padStart(2, "0")).join("");
export const isSecret = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export const isGrant = (value: unknown): value is RoomGrant => {
  const grant = value as RoomGrant | undefined;
  return Boolean(grant && isSecret(grant.id) && isSecret(grant.secret));
};
const storageKey = (code: string) => `infinity-room-grant-v1:${code}`;
export function loadRoomGrant(code: string): SavedRoomGrant | null {
  try {
    const grant = JSON.parse(localStorage.getItem(storageKey(code)) || "null");
    return isGrant(grant) && typeof (grant as SavedRoomGrant).hostPeerId === "string" &&
      Number.isFinite((grant as SavedRoomGrant).savedAt) ? grant as SavedRoomGrant : null;
  } catch { return null; }
}
export function saveRoomGrant(code: string, grant: RoomGrant, hostPeerId: string) {
  try {
    const keys = Object.keys(localStorage).filter((key) => key.startsWith("infinity-room-grant-v1:"));
    keys.sort((a, b) => {
      try { return JSON.parse(localStorage.getItem(a)!).savedAt - JSON.parse(localStorage.getItem(b)!).savedAt; }
      catch { return 0; }
    });
    while (keys.length >= 20) localStorage.removeItem(keys.shift()!);
    localStorage.setItem(storageKey(code), JSON.stringify({ ...grant, hostPeerId, savedAt: Date.now() }));
  } catch { /* Without storage, manual approval still works. */ }
}
export function forgetRoomGrant(code: string) {
  try { localStorage.removeItem(storageKey(code)); } catch { /* optional cache */ }
}
function proofPayload(code: string, hostId: string, viewerId: string, nonce: string, grantId: string) {
  return new TextEncoder().encode(JSON.stringify(["infinity-rejoin-v1", code, hostId, viewerId, nonce, grantId]));
}
async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function createRejoinProof(grant: RoomGrant, code: string, hostId: string, viewerId: string, nonce: string) {
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(grant.secret), proofPayload(code, hostId, viewerId, nonce, grant.id));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function verifyRejoinProof(grant: RoomGrant, code: string, hostId: string, viewerId: string, nonce: string, proof: unknown) {
  if (!isSecret(proof)) return false;
  const bytes = Uint8Array.from(proof.match(/../g)!, (pair) => parseInt(pair, 16));
  return crypto.subtle.verify("HMAC", await hmacKey(grant.secret), bytes, proofPayload(code, hostId, viewerId, nonce, grant.id));
}
