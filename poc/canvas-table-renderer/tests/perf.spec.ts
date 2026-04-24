import { test, expect } from "@playwright/test";

const BASE_URL = "http://localhost:5173";

test.describe("Canvas Table Renderer PoC", () => {
  test("loads and renders table", async ({ page }) => {
    await page.goto(BASE_URL);

    // Wait for canvas to appear
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // Verify the toolbar is present
    await expect(page.getByText("Canvas 表格渲染 PoC")).toBeVisible();

    // Click on a cell
    await canvas.click({ position: { x: 100, y: 80 } });

    // Verify FPS counter is present
    await expect(page.getByText("FPS:")).toBeVisible();
  });

  test("cell editing works", async ({ page }) => {
    await page.goto(BASE_URL);
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // Double-click a cell to edit
    await canvas.dblclick({ position: { x: 100, y: 80 } });

    // Verify edit input appears
    const input = page.locator("input");
    await expect(input).toBeVisible({ timeout: 3000 });

    // Type a new value
    await input.fill("测试值");
    await input.press("Enter");

    // Verify input disappears
    await expect(input).not.toBeVisible({ timeout: 1000 });
  });

  test("renders 100K rows with acceptable FPS", async ({ page }) => {
    await page.goto(BASE_URL);

    // Select 10万 rows
    const btn10w = page.getByText("10万");
    await btn10w.click();

    // Wait for canvas to re-render
    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // Wait a moment for FPS to stabilize
    await page.waitForTimeout(2000);

    // Read FPS from overlay
    const fpsText = await page.locator("text=/FPS: \\d+/").textContent();
    const fps = Number(fpsText?.match(/\d+/)?.[0] ?? 0);

    console.log(`FPS with 100K rows: ${fps}`);
    expect(fps).toBeGreaterThan(20);
  });

  test("measures scroll performance at 100K rows", async ({ page }) => {
    await page.goto(BASE_URL);
    const btn10w = page.getByText("10万");
    await btn10w.click();

    const canvas = page.locator("canvas");
    await expect(canvas).toBeVisible({ timeout: 10000 });
    await page.waitForTimeout(1000);

    // Perform continuous scroll using mouse wheel
    const startFPSText = await page.locator("text=/FPS: \\d+/").textContent();
    const startFPS = Number(startFPSText?.match(/\d+/)?.[0] ?? 0);

    // Scroll down rapidly by dispatching wheel events
    await canvas.hover();
    for (let i = 0; i < 20; i++) {
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(50);
    }

    await page.waitForTimeout(500);
    const endFPSText = await page.locator("text=/FPS: \\d+/").textContent();
    const endFPS = Number(endFPSText?.match(/\d+/)?.[0] ?? 0);

    console.log(`FPS before scroll: ${startFPS}, after scroll: ${endFPS}`);
    // FPS shouldn't drop below 10 during/after scroll
    expect(endFPS).toBeGreaterThan(10);
  });

  test("measures 200K row memory usage", async ({ page }) => {
    await page.goto(BASE_URL);

    // Select 20万 rows, 100 columns
    const btn20w = page.getByText("20万");
    await btn20w.click();
    const btn100col = page.getByText("100", { exact: true });
    await btn100col.click();

    await page.waitForTimeout(3000);

    // Read memory from overlay
    const memText = await page.locator("text=/Memory: \\d+/").textContent();
    const memMB = Number(memText?.match(/\d+/)?.[0] ?? 0);

    console.log(`Memory with 200K rows × 100 cols: ${memMB} MB`);
    expect(memMB).toBeLessThan(500); // Should stay under 500MB
  });
});
