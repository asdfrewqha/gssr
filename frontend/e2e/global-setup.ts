import { request } from "@playwright/test";

const GAME_HEALTH = process.env.GAME_HEALTH_URL ?? "http://localhost:3001/health";
const WORKERS_HEALTH =
  process.env.WORKERS_HEALTH_URL ?? "http://localhost:8001/health";

const TIMEOUT_MS = 60_000;
const INTERVAL_MS = 2_000;

async function waitForService(name: string, url: string): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS;
  const ctx = await request.newContext();

  while (Date.now() < deadline) {
    try {
      const res = await ctx.get(url);
      if (res.ok()) {
        console.log(`[global-setup] ${name} is healthy`);
        await ctx.dispose();
        return;
      }
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }

  await ctx.dispose();
  throw new Error(
    `[global-setup] Timed out waiting for ${name} at ${url}. ` +
      "Did you run 'make test-up'?"
  );
}

export default async function globalSetup(): Promise<void> {
  await Promise.all([
    waitForService("game-test", GAME_HEALTH),
    waitForService("workers-test", WORKERS_HEALTH),
  ]);
}
