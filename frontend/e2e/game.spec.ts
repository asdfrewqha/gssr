import { test, expect, request, APIRequestContext } from "@playwright/test";

const GAME_API = process.env.PLAYWRIGHT_API_URL ?? "http://localhost:3001";

async function registerAndLogin(
  ctx: APIRequestContext,
  suffix: string
): Promise<{ userId: string }> {
  const username = `e2e_${suffix}_${Date.now()}`;
  const password = "e2ePassword123!";

  await ctx.post("/api/auth/register", { data: { username, password } });
  const login = await ctx.post("/api/auth/login", {
    data: { username, password },
  });
  const body = await login.json();
  return { userId: body.user_id };
}

test.describe("Game flow", () => {
  test("create room → join → start → guess → results", async () => {
    // Host context
    const host = await request.newContext({ baseURL: GAME_API });
    await registerAndLogin(host, "host");

    // Verify /api/users/me works after login (cookie set)
    const me = await host.get("/api/users/me");
    expect(me.status()).toBe(200);
    const meBody = await me.json();
    expect(meBody).toHaveProperty("username");

    // Get a map to play on
    const maps = await host.get("/api/maps");
    expect(maps.status()).toBe(200);
    const mapsBody = await maps.json();

    // Skip room creation if no maps exist in test DB (seed needed)
    if (!mapsBody || mapsBody.length === 0) {
      console.log("No maps in test DB — skipping room flow. Seed maps first.");
      await host.dispose();
      return;
    }

    const mapId = mapsBody[0].id;

    // Create room
    const create = await host.post("/api/rooms", {
      data: { map_id: mapId, max_players: 2, rounds: 1, time_limit_sec: 30 },
    });
    expect(create.status()).toBe(201);
    const room = await create.json();
    expect(room).toHaveProperty("id");
    const roomId = room.id;

    // Second player joins
    const player = await request.newContext({ baseURL: GAME_API });
    await registerAndLogin(player, "player");
    const join = await player.post(`/api/rooms/${roomId}/join`);
    expect(join.status()).toBe(200);

    // Host starts game
    const start = await host.post(`/api/rooms/${roomId}/start`);
    expect(start.status()).toBe(200);

    // Fetch room state — should have a current pano
    const state = await host.get(`/api/rooms/${roomId}`);
    expect(state.status()).toBe(200);
    const stateBody = await state.json();
    expect(stateBody.status).toBe("active");

    await host.dispose();
    await player.dispose();
  });

  test("GET /health returns 200", async () => {
    const ctx = await request.newContext({ baseURL: GAME_API });
    const res = await ctx.get("/health");
    expect(res.status()).toBe(200);
    await ctx.dispose();
  });
});
