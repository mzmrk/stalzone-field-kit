import { expect, test, type Page } from "@playwright/test";

async function openCalculator(page: Page) {
  await page.getByRole("button", { name: "Build calculator", exact: true }).click();
}

async function gotoLoadedApp(page: Page) {
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/global/listing.json") && response.ok(), { timeout: 20_000 }),
    page.goto("/"),
  ]);
}

async function reloadLoadedApp(page: Page) {
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/global/listing.json") && response.ok(), { timeout: 20_000 }),
    page.reload(),
  ]);
}

test("opens the optimizer by default and shares carrier selection between both tools", async ({ page }) => {
  await gotoLoadedApp(page);

  await expect(page.getByRole("button", { name: "Build optimizer", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Weighted combination search" })).toBeVisible();
  await expect(page.locator("#optimizer .optimizer-settings > .optimizer-carrier-selector")).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore optimizer default filters" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear all optimizer filters" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset build" })).toHaveCount(0);

  await page.getByRole("button", { name: /Select a backpack or container/i }).click();
  await page.getByPlaceholder(/Search backpacks and containers/).fill("Errand Junior Backpack");
  await page.getByRole("button", { name: /Errand Junior Backpack/ }).click();
  await expect(page.locator("#optimizer .optimizer-settings .container-card")).toContainText("Errand Junior Backpack");

  await openCalculator(page);
  await expect(page.getByRole("heading", { name: "Carrier & artifacts" })).toBeVisible();
  await expect(page.locator("#loadout .container-card")).toContainText("Errand Junior Backpack");
  await expect(page.getByRole("button", { name: "Reset build" })).toBeVisible();

  await page.getByRole("button", { name: "Build optimizer", exact: true }).click();
  await expect(page.locator("#optimizer .container-card")).toContainText("Errand Junior Backpack");
});

test("creates and restores a live EXBO-backed artifact build", async ({ page }) => {
  await gotoLoadedApp(page);
  await openCalculator(page);

  await page.getByRole("button", { name: /Select a backpack or container/i }).click();
  await page.getByPlaceholder(/Search backpacks and containers/).fill("Berloga-6 Container");
  await page.getByRole("button", { name: /Berloga-6 Container/ }).click();

  await expect(page.getByText("78.5%").first()).toBeVisible();
  await expect(page.getByText("0 / 6")).toBeVisible();

  await page.getByRole("button", { name: /Add artifact/i }).first().click();
  await page.getByPlaceholder("Search artifacts…").fill("Bracelet");
  const braceletResult = page.getByRole("button", { name: /^Bracelet/ });
  await expect(braceletResult).toContainText("₽");
  const braceletPrice = braceletResult.locator(".price-display");
  await expect(braceletPrice).toHaveClass(/price-display--market/);
  await expect(braceletPrice).toHaveAttribute("aria-label", /^Market price:/);
  await expect(braceletPrice).toHaveAttribute("title", /eligible completed sales.*EU data through/);
  await page.getByRole("button", { name: /^Bracelet/ }).click();

  await expect(page.getByRole("heading", { name: "Bracelet" })).toBeVisible();
  await expect(page.getByText("1 / 6")).toBeVisible();
  await expect(page.locator(".base-properties").getByText("Movement speed")).toBeVisible();

  await page.getByLabel("Exact quality").fill("130");
  await page.getByRole("button", { name: "Rare", exact: true }).click();
  await page.getByRole("button", { name: "+10" }).click();
  await expect(page.getByText("+10 · 130% · Rare")).toBeVisible();

  await reloadLoadedApp(page);
  await openCalculator(page);
  await expect(page.getByText("Berloga-6 Container").first()).toBeVisible();
  await expect(page.getByText("Bracelet").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bracelet" })).toBeVisible();
  await page.screenshot({ path: "test-results/calculator.png", fullPage: true });
});

test("persists the selected market region independently of the build", async ({ page }) => {
  await page.goto("/");
  const marketRegion = page.getByLabel("Market region");
  await marketRegion.selectOption("ru");
  await expect(marketRegion).toHaveValue("ru");
  await page.reload();
  await expect(page.getByLabel("Market region")).toHaveValue("ru");
});

test("switches to Russian without resetting the saved build and persists the choice", async ({ page }) => {
  await gotoLoadedApp(page);
  await openCalculator(page);

  await page.getByRole("button", { name: /Select a backpack or container/i }).click();
  await page.getByPlaceholder(/Search backpacks and containers/).fill("Berloga-6 Container");
  await page.getByRole("button", { name: /Berloga-6 Container/ }).click();

  await page.getByLabel("LANGUAGE").selectOption("ru");
  await expect(page.getByRole("heading", { name: "Рюкзак и артефакты" })).toBeVisible();
  await expect(page.getByText("Контейнер «Берлога-6»").first()).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ru");

  await reloadLoadedApp(page);
  await expect(page.getByLabel("ЯЗЫК")).toHaveValue("ru");
  await page.getByRole("button", { name: "Калькулятор сборки", exact: true }).click();
  await expect(page.getByText("Контейнер «Берлога-6»").first()).toBeVisible();

  await page.getByLabel("ЯЗЫК").selectOption("en");
  await expect(page.getByText("Berloga-6 Container").first()).toBeVisible();
});

test("uses Russian for a new visitor whose browser prefers Russian", async ({ browser }) => {
  const context = await browser.newContext({ locale: "ru-RU" });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Оптимизатор сборок", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Поиск взвешенной комбинации" })).toBeVisible();
  await expect(page.getByLabel("ЯЗЫК")).toHaveValue("ru");
  await context.close();
});

test("keeps the calculator usable at a phone viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByText("EXBO Studio / Global")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Build optimizer", exact: true })).toHaveAttribute("aria-pressed", "true");
  const optimizerDimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(optimizerDimensions.scrollWidth).toBe(optimizerDimensions.clientWidth);
  await openCalculator(page);
  await expect(page.getByRole("navigation", { name: "Calculator sections" })).toBeVisible();
  const calculatorDimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(calculatorDimensions.scrollWidth).toBe(calculatorDimensions.clientWidth);
});

test("exhaustively ranks and loads a four-slot weighted build", async ({ page }) => {
  test.setTimeout(90_000);
  await gotoLoadedApp(page);

  await page.getByRole("button", { name: /Select a backpack or container/i }).click();
  await page.getByPlaceholder(/Search backpacks and containers/).fill("Errand Junior Backpack");
  await page.getByRole("button", { name: /Errand Junior Backpack/ }).click();

  await expect(page.getByText("4,967,690").first()).toBeVisible();
  await expect(page.getByText(/Brute force selected automatically/)).toBeVisible();
  await expect(page.getByLabel("Optimization engine")).toHaveCount(0);
  await expect(page.getByText("Allow duplicate artifacts")).toHaveCount(0);
  await expect(page.locator("#optimizer .container-specs")).toContainText("CARRY WEIGHT");
  await expect(page.locator("#optimizer .container-specs")).toContainText("+35.00 kg");
  const movementRow = page.locator(".positive-filter").filter({ hasText: "Movement speed" });
  const runningRow = page.locator(".positive-filter").filter({ hasText: "Running speed" });
  const staminaRow = page.locator(".positive-filter").filter({ hasText: "Stamina regeneration" });
  const bulletRow = page.locator(".positive-filter").filter({ hasText: "Bullet resistance" });
  await expect(movementRow).toHaveClass(/positive-filter--enabled/);
  await expect(runningRow).toHaveClass(/positive-filter--enabled/);
  await expect(staminaRow).toHaveClass(/positive-filter--enabled/);
  await expect(bulletRow).toHaveClass(/positive-filter--enabled/);
  const periodicHealingRow = page.locator(".positive-filter").filter({ hasText: "Periodic healing" });
  const radiationCounteringRow = page.locator(".positive-filter").filter({ hasText: "Radiation countering" });
  await expect(periodicHealingRow).toBeVisible();
  await expect(radiationCounteringRow).toBeVisible();
  await page.getByLabel("Optimize Radiation countering").check();
  await expect(page.getByLabel("Minimum Radiation countering magnitude from artifacts")).toHaveAttribute("placeholder", "Any < 0");
  await page.getByLabel("Optimize Radiation countering").uncheck();
  await expect(page.getByLabel("Radiation policy")).toHaveValue("safe");
  await expect(page.getByLabel("Vitality policy")).toHaveValue("strict");
  await expect(movementRow.getByRole("button", { name: /Important/ })).toHaveAttribute("aria-pressed", "true");
  await expect(runningRow.getByRole("button", { name: /Neutral/ })).toHaveAttribute("aria-pressed", "true");
  await expect(movementRow.locator(".objective-share")).toHaveText("40%");
  await expect(runningRow.locator(".objective-share")).toHaveText("20%");
  await expect(staminaRow.locator(".objective-share")).toHaveText("20%");
  await expect(bulletRow.locator(".objective-share")).toHaveText("20%");
  await expect(page.getByLabel("Minimum Running speed from artifacts")).toBeVisible();
  await page.getByLabel("Minimum Running speed from artifacts").fill("0.2");
  await movementRow.getByRole("button", { name: /Essential/ }).click();
  await expect(movementRow.locator(".objective-share")).toHaveText("57.1%");
  await expect(runningRow.locator(".objective-share")).toHaveText("14.3%");
  await page.getByLabel("Optimize Running speed").uncheck();
  await expect(page.getByLabel("Minimum Running speed from artifacts")).toHaveCount(0);
  await page.getByLabel("Optimize Running speed").check();
  await expect(page.getByLabel("Minimum Running speed from artifacts")).toHaveValue("");
  await page.getByLabel("Optimize Running speed").uncheck();
  await expect(movementRow.locator(".objective-share")).toHaveText("66.7%");
  await expect(staminaRow.locator(".objective-share")).toHaveText("16.7%");
  await expect(bulletRow.locator(".objective-share")).toHaveText("16.7%");
  const searchButton = page.getByRole("button", { name: /Search 4,967,690 combinations/ });
  await page.getByLabel("Minimum Movement speed from artifacts").fill("0");
  await expect(searchButton).toBeDisabled();
  await expect(page.getByText("Positive minimums must be greater than zero.")).toBeVisible();
  await page.getByLabel("Minimum Movement speed from artifacts").fill("0.1");
  await page.getByLabel("Temperature policy").selectOption("custom");
  await expect(searchButton).toBeDisabled();
  await page.getByLabel("Temperature accepted penalty").fill("0.5");
  await page.getByRole("button", { name: "Counter all" }).click();
  await expect(page.getByLabel("Radiation policy")).toHaveValue("strict");
  await expect(page.getByLabel("Temperature policy")).toHaveValue("strict");
  await expect(page.getByLabel("Vitality policy")).toHaveValue("strict");
  await page.getByRole("button", { name: "Allow all" }).click();
  await expect(page.getByLabel("Radiation policy")).toHaveValue("allow");
  await page.getByRole("button", { name: "Game-safe" }).click();
  await expect(page.getByLabel("Radiation policy")).toHaveValue("safe");
  await expect(page.getByLabel("Temperature policy")).toHaveValue("safe");
  await expect(page.getByLabel("Vitality policy")).toHaveValue("strict");
  await page.getByLabel("Maximum total price").fill("0");
  await expect(searchButton).toBeDisabled();
  await expect(page.getByText("Maximum total price must be greater than zero.")).toBeVisible();
  await page.getByLabel("Maximum total price").fill("999999999999");
  await expect(searchButton).toBeEnabled();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("field-kit-optimizer-v1"))).toContain("999999999999");
  await reloadLoadedApp(page);
  await expect(movementRow.getByRole("button", { name: /Essential/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Optimize Running speed")).not.toBeChecked();
  await expect(page.getByLabel("Minimum Movement speed from artifacts")).toHaveValue("0.1");
  await expect(page.getByLabel("Maximum total price")).toHaveValue("999999999999");
  await expect(page.getByLabel("Temperature policy")).toHaveValue("safe");
  await searchButton.click();
  await expect(page.getByText(/combinations evaluated/)).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("button", { name: "Load into calculator" }).first()).toBeVisible();
  await expect.poll(() => page.locator(".optimizer-result").first().evaluate((element) => Math.round(element.getBoundingClientRect().top))).toBeLessThan(150);
  await expect(page.locator(".optimizer-result__price").first()).toContainText("₽");
  await expect(page.locator(".optimizer-effect-group--searched").first()).toContainText("Searched effects");
  await expect(page.locator(".optimizer-effect-group").filter({ hasText: "Exposure" }).first()).toBeVisible();
  const resultCards = page.locator(".optimizer-result");
  const firstResultBox = await resultCards.nth(0).boundingBox();
  const secondResultBox = await resultCards.nth(1).boundingBox();
  expect(firstResultBox?.x).toBe(secondResultBox?.x);
  expect(secondResultBox?.y).toBeGreaterThan(firstResultBox?.y ?? 0);
  const searchedEffectsBox = await resultCards.first().locator(".optimizer-effect-group--searched").boundingBox();
  const otherEffectsBox = await resultCards.first().locator(".optimizer-effect-groups__other").boundingBox();
  expect(otherEffectsBox?.x).toBeGreaterThan(searchedEffectsBox?.x ?? 0);
  await page.screenshot({ path: "test-results/optimizer.png", fullPage: true });

  await page.getByRole("button", { name: "Load into calculator" }).first().click();
  await expect(page.getByText("4 / 4")).toBeVisible();
  await page.getByRole("button", { name: "Build optimizer", exact: true }).click();
  await expect(page.locator(".optimizer-result")).toHaveCount(10);
  await page.getByRole("button", { name: "Clear all optimizer filters" }).click();
  await expect(page.locator(".positive-filter__toggle input:checked")).toHaveCount(0);
  await expect(page.getByLabel("Radiation policy")).toHaveValue("safe");
  await expect(page.getByLabel("Vitality policy")).toHaveValue("strict");
  await expect(page.getByLabel("Maximum total price")).toHaveValue("");
  await expect(page.getByLabel("Search Ordinary rarity")).toBeChecked();
  await page.getByRole("button", { name: "Restore optimizer default filters" }).click();
  await expect(movementRow.getByRole("button", { name: /Important/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Optimize Running speed")).toBeChecked();
  await expect(page.getByLabel("Maximum total price")).toHaveValue("");
  await expect(page.getByLabel("Search Ordinary rarity")).toBeChecked();
  await openCalculator(page);
  await expect(page.getByText("4 / 4")).toBeVisible();
});

test("uses MILP to optimize a carrier beyond the brute-force limit", async ({ page }) => {
  test.setTimeout(60_000);
  await gotoLoadedApp(page);

  await page.getByRole("button", { name: /Select a backpack or container/i }).click();
  await page.getByPlaceholder(/Search backpacks and containers/).fill("Berloga-6 Container");
  await page.getByRole("button", { name: /Berloga-6 Container/ }).click();

  await expect(page.getByText(/MILP selected automatically/)).toBeVisible();
  await expect(page.getByLabel("Optimization engine")).toHaveCount(0);
  await expect(page.getByLabel("Search Ordinary rarity")).toBeChecked();
  await page.getByLabel("Search Uncommon rarity").check();
  await expect(page.getByText(/MILP selected automatically/)).toBeVisible();
  const searchButton = page.getByRole("button", { name: "Find optimal build with MILP" });
  await expect(searchButton).toBeEnabled();
  await page.evaluate(() => {
    document.body.dataset.sawStreamingMilpResult = "false";
    const observer = new MutationObserver(() => {
      const hasResult = document.querySelectorAll(".optimizer-result").length > 0;
      const stillSolving = document.querySelector(".optimizer-search")?.textContent?.includes("Solving bounded search");
      if (hasResult && stillSolving) {
        document.body.dataset.sawStreamingMilpResult = "true";
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  await searchButton.click();

  await expect(page.getByText("MILP bounded")).toBeVisible({ timeout: 45_000 });
  await expect.poll(() => page.locator(".optimizer-result").first().evaluate((element) => Math.round(element.getBoundingClientRect().top))).toBeLessThan(150);
  await expect(page.getByText(/possible combinations were not enumerated/)).toBeVisible({ timeout: 45_000 });
  expect(await page.evaluate(() => document.body.dataset.sawStreamingMilpResult)).toBe("true");
  await expect(page.getByRole("button", { name: "Load into calculator" })).toHaveCount(10);
  await expect(page.getByText("Proven optimal for this rank").first()).toBeVisible();
  await expect(page.locator(".optimizer-objective__track").first()).toBeVisible();
  await expect(page.locator(".optimizer-objective__meta").first()).toContainText(/MAX (PROVEN|NOT PROVEN)/);
  await expect(page.locator(".optimizer-objective__best").first()).toContainText(/Best (possible|found)/);
  await expect(page.locator(".optimizer-artifacts small").first()).toContainText("Uncommon");
  await page.getByRole("button", { name: "Load into calculator" }).first().click();
  await expect(page.getByText(/107.5% · Uncommon/).first()).toBeVisible();
});
