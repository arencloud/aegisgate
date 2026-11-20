import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const env = Object.fromEntries(
  readFileSync(new URL("../../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => l.split("=")),
);
async function login(page: Page, role: string) {
  await page.goto("/auth/login/keycloak");
  await page.locator("#username").fill(role);
  await page
    .locator("#password")
    .fill(env[`DEMO_${role.toUpperCase()}_PASSWORD`]);
  await page.locator("#kc-login").click();
  await page.waitForURL("http://localhost:8080/");
  await expect(
    page.getByRole("button", {
      name: `Demo ${role[0].toUpperCase() + role.slice(1)}`,
    }),
  ).toBeVisible();
}
async function call(
  page: Page,
  path: string,
  method = "GET",
  body?: unknown,
  withCsrf = true,
) {
  return page.evaluate(
    async ({ path, method, body, withCsrf }) => {
      const me = await fetch("/auth/me").then((r) => r.json());
      const response = await fetch(path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(withCsrf ? { "X-CSRF-Token": me.csrf } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, body: await response.text() };
    },
    { path, method, body, withCsrf },
  );
}
test("anonymous dashboard and mobile layout, API denies anonymous access", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Security, in the clear." }),
  ).toBeVisible();
  expect((await page.request.get("/api/projects")).status()).toBe(401);
  expect((await page.request.get("/internal/check")).status()).toBe(404);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Connect your identity" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Continue with Keycloak" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({
    path: "../artifacts/overview-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../artifacts/overview-mobile.png",
    fullPage: true,
  });
});
test("viewer can read but role escalation and unsafe requests are denied", async ({
  page,
}) => {
  await login(page, "viewer");
  expect((await call(page, "/api/projects")).status).toBe(200);
  expect(
    (await call(page, "/api/deployments", "POST", { project: "payments" }))
      .status,
  ).toBe(403);
  expect((await call(page, "/api/admin")).status).toBe(403);
  expect(
    (
      await page.request.get("/api/admin", {
        headers: { "x-aegis-roles": "admin" },
      })
    ).status(),
  ).toBe(403);
  expect((await call(page, "/auth/sessions")).status).toBe(403);
  expect(
    (await call(page, "/auth/logout", "POST", undefined, false)).status,
  ).toBe(403);
  await page
    .getByRole("button", { name: "Applications", exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "Payments API" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Test operator action" })
    .first()
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Your role does not permit",
  );
});
test("operator action succeeds, CSRF rejection and logout invalidate session", async ({
  page,
  context,
}) => {
  await login(page, "operator");
  expect(
    (await call(page, "/api/deployments", "POST", { project: "payments" }))
      .status,
  ).toBe(200);
  expect(
    (
      await call(
        page,
        "/api/deployments",
        "POST",
        { project: "payments" },
        false,
      )
    ).status,
  ).toBe(403);
  const cookie = (await context.cookies()).find(
    (c) => c.name === "ag_session",
  )!;
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe("Lax");
  expect((await call(page, "/auth/logout", "POST")).status).toBe(204);
  expect(
    (
      await page.request.get("/api/projects", {
        headers: { cookie: `ag_session=${cookie.value}` },
      })
    ).status(),
  ).toBe(401);
});
test("admin sees live audit and can revoke a session immediately", async ({
  page,
  context,
}) => {
  await login(page, "admin");
  expect((await call(page, "/api/admin")).status).toBe(200);
  const events = await call(page, "/auth/events");
  expect(events.status).toBe(200);
  expect(JSON.parse(events.body).events.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Sessions", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Active sessions" }),
  ).toBeVisible();
  const cookie = (await context.cookies()).find(
    (c) => c.name === "ag_session",
  )!;
  const id = createHash("sha256").update(cookie.value).digest("hex");
  expect((await call(page, `/auth/sessions/${id}`, "DELETE")).status).toBe(204);
  expect((await page.request.get("/api/projects")).status()).toBe(401);
});
test("callback refuses unrecognized login state", async ({ request }) => {
  expect(
    (
      await request.get("/auth/callback?state=untrusted&code=untrusted")
    ).status(),
  ).toBe(401);
});
