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
  await expect(page.getByRole("button", { name: /^Bracelet/ })).toContainText("₽");
  await page.getByRole("button", { name: /^Bracelet/ }).click();

  await expect(page.getByRole("heading", { name: "Bracelet" })).toBeVisible();
  await expect(page.getByText("1 / 6")).toBeVisible();
  await expect(page.locator(".base-properties").getByText("Movement speed")).toBeVisible();

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

test("exhaustively ranks and loads a four-slot weighted build", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await expect(page.getByText(/EXBO LIVE/)).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: /Select a backpack or container/i }).click();
  await page.getByPlaceholder(/Search backpacks and containers/).fill("Errand Junior Backpack");
  await page.getByRole("button", { name: /Errand Junior Backpack/ }).click();

  await expect(page.getByText("4,967,690").first()).toBeVisible();
  await expect(page.locator(".container-specs")).toContainText("CARRY WEIGHT");
  await expect(page.locator(".container-specs")).toContainText("+35.00 kg");
  const objectiveRows = page.locator(".objective-row");
  await expect(objectiveRows.nth(0).getByRole("button", { name: /Neutral/ })).toHaveAttribute("aria-pressed", "true");
  await expect(objectiveRows.nth(1).getByRole("button", { name: /Neutral/ })).toHaveAttribute("aria-pressed", "true");
  await expect(objectiveRows.nth(0).locator(".objective-share")).toHaveText("50%");
  await expect(objectiveRows.nth(1).locator(".objective-share")).toHaveText("50%");
  await page.getByRole("button", { name: "Add objective" }).click();
  await expect(objectiveRows.nth(2).getByRole("button", { name: /Neutral/ })).toHaveAttribute("aria-pressed", "true");
  await expect(objectiveRows.nth(0).locator(".objective-share")).toHaveText("33.3%");
  await objectiveRows.nth(0).getByRole("button", { name: /Important/ }).click();
  await expect(objectiveRows.nth(0).locator(".objective-share")).toHaveText("50%");
  await expect(objectiveRows.nth(1).locator(".objective-share")).toHaveText("25%");
  await expect(objectiveRows.nth(2).locator(".objective-share")).toHaveText("25%");
  await page.getByRole("button", { name: "Remove objective 3" }).click();
  await expect(objectiveRows.nth(0).locator(".objective-share")).toHaveText("66.7%");
  await expect(objectiveRows.nth(1).locator(".objective-share")).toHaveText("33.3%");
  await page.getByRole("checkbox", { name: /No remaining negative effects/ }).check();
  await page.getByRole("checkbox", { name: /Require every objective/ }).check();
  const searchButton = page.getByRole("button", { name: /Search 4,967,690 combinations/ });
  await page.getByLabel("Maximum total price").fill("0");
  await expect(searchButton).toBeDisabled();
  await expect(page.getByText("Maximum total price must be greater than zero.")).toBeVisible();
  await page.getByLabel("Maximum total price").fill("999999999999");
  await expect(searchButton).toBeEnabled();
  await searchButton.click();
  await expect(page.getByText(/combinations evaluated/)).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("button", { name: "Load into calculator" }).first()).toBeVisible();
  await expect(page.locator(".optimizer-result__price").first()).toContainText("₽");
  await page.screenshot({ path: "test-results/optimizer.png", fullPage: true });

  await page.getByRole("button", { name: "Load into calculator" }).first().click();
  await expect(page.getByText("4 / 4")).toBeVisible();
});

test("uses MILP to optimize a carrier beyond the brute-force limit", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await expect(page.getByText(/EXBO LIVE/)).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: /Select a backpack or container/i }).click();
  await page.getByPlaceholder(/Search backpacks and containers/).fill("Berloga-6 Container");
  await page.getByRole("button", { name: /Berloga-6 Container/ }).click();

  await expect(page.getByText(/exceeds the brute-force/)).toBeVisible();
  await page.getByLabel("Optimization engine").selectOption("milp");
  const searchButton = page.getByRole("button", { name: "Find optimal build with MILP" });
  await expect(searchButton).toBeEnabled();
  await searchButton.click();

  await expect(page.getByText("MILP optimal")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText(/possible combinations were not enumerated/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Load into calculator" })).toBeVisible();
});
