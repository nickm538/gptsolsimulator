import { expect, test } from "@playwright/test";

test("configures an airliner and enters an interactive flight deck", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/");
  await expect(page.locator("#preflight-screen")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator("[data-aircraft]")).toHaveCount(3);

  await page.locator('[data-aircraft="max9"]').click();
  await page.locator('[data-weather="storm"]').click();
  await page.locator('[data-time="night"]').click();
  await page.locator("#callsign-input").fill("AER 739");
  await page.locator("label.toggle", { has: page.locator("#ready-toggle") }).click();
  await page.locator("#review-flight-button").click();

  await expect(page.locator("#briefing-modal")).toBeVisible();
  await expect(page.locator("#briefing-title")).toContainText("737 MAX 9");
  await expect(page.locator("#briefing-vr")).toContainText("148");
  await page.locator("#begin-flight-button").click();

  await expect(page.locator("#flight-ui")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("#flight-callsign")).toHaveText("AER 739");
  await expect(page.locator("#pfd-screen")).not.toHaveClass(/is-off/);
  await expect(page.locator("#mobile-controls")).toBeHidden();
  await expect(page.locator("#heading-left-two")).toHaveText("07");
  await expect(page.locator("#heading-left-one")).toHaveText("08");
  await expect(page.locator("#heading-right-one")).toHaveText("10");
  await expect(page.locator("#heading-right-two")).toHaveText("11");

  await page.locator("#camera-button").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#camera-label")).toHaveText("CHASE");
  await expect(page.locator("#tutorial-title")).toHaveText("Welcome aboard");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

  await page.keyboard.press("b");
  await expect(page.locator("#parking-brake-button")).not.toHaveClass(/is-active/);
  await page.keyboard.press("g");
  await expect(page.locator("#gear-value")).toHaveText("DOWN");
  await page.keyboard.press("r");
  await expect(page.locator("#reverse-value")).toHaveText("ARM");
  await page.keyboard.press("r");
  await page.locator("#throttle-input").fill("18");
  await page.waitForTimeout(700);
  await expect(page.locator("#throttle-readout")).toHaveText("18%");
  await page.locator("#pause-button").click();
  await page.locator("#retry-approach-button").click();
  await expect(page.locator("#tutorial-title")).toHaveText(
    /Configure for landing|Stabilize the final/,
  );
  await expect(page.locator("#pause-overlay")).toBeHidden();
  await page.waitForTimeout(700);
  await expect(page.locator("#crash-overlay")).toBeHidden();
  await expect(page.locator("canvas#sim-canvas")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test.describe("mobile", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });

  test("presents touch-first controls on a mobile viewport", async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto("/");
    await expect(page.locator("#preflight-screen")).toBeVisible({ timeout: 5_000 });
    await page.locator('[data-aircraft="cessna"]').click();
    await page
      .locator("label.toggle", { has: page.locator("#tutorial-toggle") })
      .click();
    await page.locator("#review-flight-button").click();
    await page.locator("#begin-flight-button").click();

    await expect(page.locator("#flight-ui")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator("#mobile-controls")).toBeVisible();
    await expect(page.locator("#touch-stick")).toBeVisible();
    await expect(page.locator("#cockpit-console")).toBeHidden();
    await expect(page.locator("#tutorial-card")).toBeHidden();

    for (const system of [
      "battery",
      "avionics",
      "beacon",
      "engineMaster",
      "navLights",
      "landingLights",
    ]) {
      await page.locator(`[data-mobile-system="${system}"]`).click();
    }
    await expect(page.locator("#pfd-screen")).not.toHaveClass(/is-off/);
    await expect(page.locator('[data-mobile-system="engineMaster"]')).toHaveClass(
      /is-active/,
    );
    await page.locator("#mobile-flaps-down").click();
    await expect(page.locator("#flaps-value")).toHaveText("1");
    await page.locator("#mobile-flaps-up").click();
    await expect(page.locator("#flaps-value")).toHaveText("UP");
    for (let setting = 0; setting < 4; setting += 1) {
      await page.locator("#mobile-flaps-down").click();
    }
    await expect(page.locator("#flaps-value")).toHaveText("3");
    await page.locator("#mobile-flaps-up").click();
    await expect(page.locator("#flaps-value")).toHaveText("2");
    await page.locator("#mobile-flaps-up").click();
    await page.locator("#mobile-flaps-up").click();
    await expect(page.locator("#flaps-value")).toHaveText("UP");
    await expect(page.locator("#mobile-reverse")).toBeVisible();
    const systemButton = await page
      .locator('[data-mobile-system="battery"]')
      .boundingBox();
    expect(systemButton?.height).toBeGreaterThanOrEqual(48);
    await page.locator("#mobile-parking-brake").click();
    await page.locator("#mobile-throttle-input").fill("40");
    await expect(page.locator("#mobile-throttle-readout")).toHaveText("40%");
    await expect
      .poll(async () => Number(await page.locator("#ground-speed").textContent()), {
        timeout: 6_000,
      })
      .toBeGreaterThan(0);
    const headingBefore = await page.locator("#pfd-heading").textContent();
    await page.locator('[data-rudder="1"]').dispatchEvent("pointerdown");
    await page.waitForTimeout(1_200);
    await page.locator('[data-rudder="1"]').dispatchEvent("pointerup");
    await expect
      .poll(async () => page.locator("#pfd-heading").textContent(), {
        timeout: 4_000,
      })
      .not.toBe(headingBefore);
    await page.locator("#mobile-brake").dispatchEvent("pointerdown");
    await page.waitForTimeout(300);
    await page.locator("#mobile-brake").dispatchEvent("pointerup");
    expect(pageErrors).toEqual([]);
  });
});
