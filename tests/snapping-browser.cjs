const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
    });
    page.on("dialog", (d) => d.accept());
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../index.html")).href,
    );
    const nodes = [
      {
        id: "a",
        label: "A",
        kind: "rectangle",
        body: "",
        x: 80,
        y: 80,
        w: 160,
        h: 80,
        fill: "#edf7f4",
        stroke: "#497e72",
      },
      {
        id: "b",
        label: "B",
        kind: "rectangle",
        body: "",
        x: 400,
        y: 300,
        w: 160,
        h: 80,
        fill: "#edf7f4",
        stroke: "#497e72",
      },
    ];
    const fixture = {
      version: 1,
      source: "A --> B",
      direction: "TB",
      nodes,
      edges: [
        {
          id: "e",
          source: "a",
          target: "b",
          label: "route",
          arrow: true,
          dashed: false,
          sourceAnchor: { x: 0.5, y: 1 },
          targetAnchor: { x: 0, y: 0.5 },
          waypoints: [
            { x: 160, y: 230 },
            { x: 300, y: 230 },
            { x: 300, y: 340 },
          ],
        },
      ],
    };
    await page.setInputFiles("#project-input", {
      name: "snap.pumlstudio",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(fixture)),
    });
    await page.waitForFunction(() => PumlStudio.getGraph().nodes[0].id === "a");
    async function selectEdge() {
      await page
        .locator(".edge")
        .first()
        .dispatchEvent("pointerdown", { button: 0, pointerId: 1 });
    }
    async function screen(p) {
      return page.evaluate((p) => {
        const t = new DOMPoint(p.x, p.y).matrixTransform(
          document.getElementById("viewport").getScreenCTM(),
        );
        return { x: t.x, y: t.y };
      }, p);
    }
    async function drag(target, p, { alt = false, during } = {}) {
      const b = await target.boundingBox(),
        end = await screen(p);
      if (alt) await page.keyboard.down("Alt");
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 6 });
      if (during) await during();
      await page.mouse.up();
      if (alt) await page.keyboard.up("Alt");
    }
    await selectEdge();
    await drag(
      page.locator('[data-handle="waypoint"]').first(),
      { x: 295, y: 192 },
      {
        during: async () => {
          assert.ok(await page.locator("#snap-guides line").count());
          await page.screenshot({
            path: path.resolve(__dirname, "../test-results/snapping.png"),
          });
        },
      },
    );
    assert.equal(
      await page.evaluate(() => PumlStudio.getGraph().edges[0].waypoints[0].x),
      300,
    );
    assert.equal(await page.locator("#snap-guides line").count(), 0);
    await drag(
      page.locator('[data-handle="waypoint"]').first(),
      { x: 295, y: 190 },
      {
        alt: true,
        during: async () =>
          assert.equal(await page.locator("#snap-guides line").count(), 0),
      },
    );
    assert.equal(
      await page.evaluate(() => PumlStudio.getGraph().edges[0].waypoints[0].x),
      295,
    );
    await page.click("#snap-toggle");
    assert.equal(
      await page.locator("#snap-toggle").getAttribute("aria-pressed"),
      "false",
    );
    await drag(page.locator('[data-handle="waypoint"]').first(), {
      x: 296,
      y: 180,
    });
    assert.equal(
      await page.evaluate(() => PumlStudio.getGraph().edges[0].waypoints[0].x),
      296,
    );
    await page.click("#snap-toggle");
    // Node edge alignment: drag B close to A's left edge.
    const b = await page.locator('[data-node="b"]').boundingBox(),
      start = await screen({ x: 480, y: 340 }),
      end = await screen({ x: 164, y: 340 });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    assert.ok(await page.locator("#snap-guides line").count());
    await page.mouse.up();
    assert.equal(
      await page.evaluate(() => PumlStudio.getGraph().nodes[1].x),
      80,
    );
    assert.equal(await page.locator("#snap-guides line").count(), 0);
    assert.ok(
      !(await page.evaluate(() => PumlStudio.svgString().includes("垂直对齐"))),
    );
    await page.click("#undo");
    assert.equal(
      await page.evaluate(() => PumlStudio.getGraph().nodes[1].x),
      400,
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: waypoint axis snapping, live guides and cleanup, Alt bypass, toggle, node alignment, undo, clean export.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
