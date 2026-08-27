const credentialCache = {
  expiresAt: 0,
  payload: null,
};
const requestHistory = new Map();

const json = (response, status, body) => {
  response.status(status);
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "private, no-store");
  response.end(JSON.stringify(body));
};

const clientIp = (request) => {
  const forwarded = request.headers["x-forwarded-for"];
  return String(Array.isArray(forwarded) ? forwarded[0] : forwarded ?? request.socket?.remoteAddress ?? "unknown")
    .split(",")[0]
    .trim();
};

const isRateLimited = (ip) => {
  const now = Date.now();
  const recent = (requestHistory.get(ip) ?? []).filter((timestamp) => now - timestamp < 60 * 60_000);
  recent.push(now);
  requestHistory.set(ip, recent);
  return recent.length > 12;
};

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    json(response, 405, { error: "Método não permitido" });
    return;
  }

  if (!/^(Tela|Infinity)\//.test(String(request.headers["user-agent"] ?? ""))) {
    json(response, 403, { error: "Cliente não autorizado" });
    return;
  }

  if (isRateLimited(clientIp(request))) {
    json(response, 429, { error: "Muitas solicitações" });
    return;
  }

  const keyId = process.env.TURN_KEY_ID;
  const apiToken = process.env.TURN_API_TOKEN;
  if (!keyId || !apiToken) {
    json(response, 503, { error: "TURN ainda não configurado" });
    return;
  }

  if (credentialCache.payload && credentialCache.expiresAt > Date.now()) {
    json(response, 200, credentialCache.payload);
    return;
  }

  try {
    const upstream = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: 21_600 }),
      },
    );

    if (!upstream.ok) throw new Error(`Cloudflare respondeu HTTP ${upstream.status}`);
    const payload = await upstream.json();
    if (!Array.isArray(payload?.iceServers)) throw new Error("Resposta TURN inválida");

    credentialCache.payload = payload;
    credentialCache.expiresAt = Date.now() + 5 * 60_000;
    json(response, 200, payload);
  } catch (error) {
    console.error("Falha ao gerar credenciais TURN", error);
    json(response, 502, { error: "Não foi possível preparar o relay" });
  }
}
