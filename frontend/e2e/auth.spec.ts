import { test, expect, request } from "@playwright/test";

// Game API base (test stack: game-test on port 3001)
const API = process.env.PLAYWRIGHT_API_URL ?? "http://localhost:3001";

// These tests hit the API directly (no browser UI yet — UI tests come after frontend is built)
test.describe("Auth API", () => {
  test("register + login flow", async () => {
    const ctx = await request.newContext({ baseURL: API });
    const username = `e2e_${Date.now()}`;
    const password = "e2ePassword123!";

    // Register
    const reg = await ctx.post("/api/auth/register", {
      data: { username, password },
    });
    expect(reg.status()).toBe(201);

    // Login
    const login = await ctx.post("/api/auth/login", {
      data: { username, password },
    });
    expect(login.status()).toBe(200);
    const body = await login.json();
    expect(body).toHaveProperty("user_id");

    await ctx.dispose();
  });

  test("login with wrong password returns 401", async () => {
    const ctx = await request.newContext({ baseURL: API });

    const res = await ctx.post("/api/auth/login", {
      data: { username: "nonexistent_user", password: "wrongpassword" },
    });
    expect(res.status()).toBe(401);

    await ctx.dispose();
  });

  test("access protected endpoint without token returns 401", async () => {
    const ctx = await request.newContext({ baseURL: API });

    const res = await ctx.get("/api/users/me");
    expect(res.status()).toBe(401);

    await ctx.dispose();
  });
});
