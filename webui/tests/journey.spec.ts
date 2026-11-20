import { test, expect } from "@playwright/test";

test("walkthrough explains allowed and denied paths without sending API actions", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "GET") writes.push(request.url());
  });
  await page.goto("/#journey");
  await expect(
    page.getByRole("heading", {
      name: "From your first click. To a protected application.",
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Illustrative scenarios · no test traffic is sent"),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Step 8: Application access granted",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Application access granted",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Malicious request", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Step 3: Threat blocked", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Threat blocked", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Explore Threat inspection",
      exact: true,
    }),
  ).toHaveClass(/blocked/);
  await expect(
    page.getByRole("button", {
      name: "Explore Protected application",
      exact: true,
    }),
  ).not.toHaveClass(/visited/);
  await page
    .getByRole("button", { name: "Insufficient role", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Step 6: Permission denied", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Permission denied", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Expired session", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Step 6: Fresh sign-in required",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "Fresh sign-in required", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Direct backend access", exact: true })
    .click();
  await page.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Service identity denied", exact: true }),
  ).toBeVisible();
  expect(writes).toEqual([]);
});

test("sign-in explains identity and Redis; playback and keyboard inspection work", async ({
  page,
}) => {
  await page.goto("/#journey");
  await page
    .getByRole("button", { name: "First sign-in", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Step 5: Prove your identity", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Explore Identity provider",
      exact: true,
    }),
  ).toHaveClass(/current/);
  await page
    .getByRole("button", {
      name: "Step 7: Save the application session",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Explore Shared session memory",
      exact: true,
    }),
  ).toHaveClass(/current/);
  await page
    .getByRole("button", { name: "Show technical details", exact: true })
    .click();
  await expect(
    page.getByText(/Redis does not make RBAC decisions/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "You are signed in", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Restart scenario", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Follow request", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Find the sign-in route", exact: true }),
  ).toBeVisible({ timeout: 6000 });
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Follow request", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Explore Protected service hop", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Protected service hop", exact: true }),
  ).toBeVisible();
});

test("architecture is readable on desktop and mobile and supports printing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1512, height: 1100 });
  await page.goto("/");
  await page.getByRole("button", { name: "How it works", exact: true }).click();
  await expect(page).toHaveURL(/#journey$/);
  await page.screenshot({
    path: "../artifacts/journey-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Explore Shared session memory", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Shared session memory", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "../artifacts/journey-mobile.png",
    fullPage: true,
  });
  await page.emulateMedia({ media: "print" });
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Shared session memory", exact: true }),
  ).toBeVisible();
});
