import { expect, test } from "@playwright/test";
import handler from "../turn-service/api/turn.mjs";

const makeRequest = (overrides: Record<string, unknown> = {}) => ({
  method: "GET",
  headers: { "user-agent": "Infinity/0.9.0", "x-forwarded-for": `127.0.0.${Math.floor(Math.random() * 200) + 1}` },
  socket: {},
  ...overrides,
});

const makeResponse = () => {
  const result = { statusCode: 0, headers: {} as Record<string, string>, body: "" };
  return {
    result,
    response: {
      status(value: number) { result.statusCode = value; },
      setHeader(name: string, value: string) { result.headers[name] = value; },
      end(value: string) { result.body = value; },
    },
  };
};

test("endpoint TURN rejeita clientes que não são o Infinity", async () => {
  const { response, result } = makeResponse();
  await handler(makeRequest({ headers: { "user-agent": "Mozilla/5.0" } }), response);
  expect(result.statusCode).toBe(403);
});

test("endpoint TURN devolve credenciais temporárias válidas", async () => {
  const previousKeyId = process.env.TURN_KEY_ID;
  const previousToken = process.env.TURN_API_TOKEN;
  const previousFetch = globalThis.fetch;
  process.env.TURN_KEY_ID = "test-key";
  process.env.TURN_API_TOKEN = "test-token";
  globalThis.fetch = async () => new Response(JSON.stringify({
    iceServers: [{
      urls: ["turn:turn.cloudflare.com:3478?transport=udp"],
      username: "temporary-user",
      credential: "temporary-password",
    }],
  }), { status: 201, headers: { "Content-Type": "application/json" } });

  try {
    const { response, result } = makeResponse();
    await handler(makeRequest(), response);
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body).iceServers[0].urls[0]).toContain("turn.cloudflare.com");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKeyId === undefined) delete process.env.TURN_KEY_ID;
    else process.env.TURN_KEY_ID = previousKeyId;
    if (previousToken === undefined) delete process.env.TURN_API_TOKEN;
    else process.env.TURN_API_TOKEN = previousToken;
  }
});
