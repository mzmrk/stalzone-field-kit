import { expect, test } from "@playwright/test";

test("creates and restores a live EXBO-backed artifact build", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/EXBO LIVE/)).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: /Select a backpack or container/i }).click();
  await page.getByPlaceholder(/Search backpacks and containers/).fill("Berloga-6 Container");
  await page.getByRole("button", { name: /Berloga-6 Container/ }).click();

  await expect(page.getByText("78.5%").first()).toBeVisible();
  await expect(page.getByText("0 / 6")).toBeVisible();

  await page.getByRole("button", { name: /Add artifact/i }).first().click();
  await page.getByPlaceholder("Search artifacts…").fill("Bracelet");
  await page.getByRole("button", { name: /^Bracelet/ }).click();

  await expect(page.getByRole("heading", { name: "Bracelet" })).toBeVisible();
  await expect(page.getByText("1 / 6")).toBeVisible();
  await expect(page.getByText("Movement speed").last()).toBeVisible();

  await page.getByLabel("Exact quality").fill("130");
  await page.getByRole("button", { name: "Rare", exact: true }).click();
  await page.getByRole("button", { name: "+10" }).click();
  await expect(page.getByText("+10 · 130% · Rare")).toBeVisible();

  await page.reload();
  await expect(page.getByText("Berloga-6 Container").first()).toBeVisible();
  await expect(page.getByText("Bracelet").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bracelet" })).toBeVisible();
  await page.screenshot({ path: "test-results/calculator.png", fullPage: true });
});

test("keeps the calculator usable at a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("EXBO Studio / Global")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("navigation", { name: "Calculator sections" })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBe(dimensions.clientWidth);
});
