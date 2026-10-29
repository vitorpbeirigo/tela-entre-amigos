import { expect, test } from "@playwright/test";
import { mockFriendsDesktop } from "./helpers/friends-desktop";

test("MQTT com ICE completo conecta quando candidatos incrementais são descartados", async ({ browser }) => {
  test.setTimeout(100_000);
  const contexts = await Promise.all([0, 1].map(() => browser.newContext()));
  const pages = await Promise.all(contexts.map((context) => context.newPage()));
  const roomId = `full-ice-${Date.now()}`;
  try {
    for (const page of pages) {
      await mockFriendsDesktop(page);
      await page.goto("/");
      await page.evaluate(async (id) => {
        const { getTransportConfig } = await import("/src/connection-diagnostics.ts");
        const { joinRoom } = await import("/@id/@trystero-p2p/mqtt");
        const config = getTransportConfig("MQTT");
        const probe = { dropped: 0, received: false, room: null as any };
        class DropIncrementalCandidates extends config.rtcPolyfill {
          constructor(configuration?: RTCConfiguration) {
            super(configuration);
            this.addEventListener("icecandidate", (event) => { if (event.candidate) probe.dropped++; event.stopImmediatePropagation(); });
          }
        }
        const room = joinRoom({ ...config, rtcPolyfill: DropIncrementalCandidates, appId: "infinity.qa.full-ice.v2", password: id }, id);
        probe.room = room;
        const action = room.makeAction("probe");
        action.onMessage = () => { probe.received = true; };
        room.onPeerJoin = (peerId: string) => { void action.send("hello", { target: peerId }); };
        (window as any).__iceProbe = probe;
      }, roomId);
    }
    for (const page of pages) {
      await expect.poll(() => page.evaluate(() => (window as any).__iceProbe.received), { timeout: 65_000 }).toBe(true);
      expect(await page.evaluate(() => (window as any).__iceProbe.dropped)).toBeGreaterThan(0);
    }
  } finally { await Promise.allSettled(contexts.map((context) => context.close())); }
});
