/* npm install; npx playwright install chromium; npm run test:browser
   Or set CHROME_PATH to an existing Chromium executable. */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
(async () => {
  const dir = path.resolve(__dirname, "../test-results");
  await fs.mkdir(dir, { recursive: true });
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
      acceptDownloads: true,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    const network = [];
    page.on("request", (r) => {
      if (/^https?:/.test(r.url())) network.push(r.url());
    });
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../index.html")).href,
    );
    await page.waitForSelector(".node");
    assert.equal(await page.locator(".node").count(), 6);
    assert.equal(await page.locator(".edge").count(), 5);
    await page.screenshot({
      path: path.join(dir, "desktop.png"),
      fullPage: true,
    });
    const first = page.locator(".node").first();
    const box = await first.boundingBox();
    const before = await page.evaluate(() => PumlStudio.getGraph().nodes[0]);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 50,
      box.y + box.height / 2 + 60,
      { steps: 8 },
    );
    await page.mouse.up();
    const moved = await page.evaluate(() => PumlStudio.getGraph().nodes[0]);
    assert.notEqual(before.x, moved.x);
    assert.notEqual(before.y, moved.y);
    await page.locator("#prop-label").fill("已编辑 <text> & 用户");
    await page.locator("#prop-label").blur();
    assert.equal(
      await page.evaluate(() => PumlStudio.getGraph().nodes[0].label),
      "已编辑 <text> & 用户",
    );
    await page.click("#undo");
    assert.equal(
      await page.evaluate(() => PumlStudio.getGraph().nodes[0].label),
      before.label,
    );
    await page.click("#redo");
    // Double-click editor modifies a real node.
    await page.locator(".node").first().dblclick();
    await page.locator("#edit-text").fill("手动微调");
    await page.click("#edit-confirm");
    await page.waitForFunction(
      () => PumlStudio.getGraph().nodes[0].label === "手动微调",
    );
    assert.equal(
      await page.evaluate(() => PumlStudio.getGraph().nodes[0].label),
      "手动微调",
    );
    // Edge bending handle is draggable, exported as independent points.
    await page
      .locator(".edge")
      .last()
      .evaluate((el) => {
        const p = el.querySelector("path").getPointAtLength(20);
        el.dispatchEvent(
          new PointerEvent("pointerdown", {
            bubbles: true,
            button: 0,
            pointerId: 1,
            clientX: p.x,
            clientY: p.y,
          }),
        );
      });
    // Select using the SVG hit target, avoiding node overlap.
    await page.evaluate(() => {
      const g = document.querySelector(".edge");
      g.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          pointerId: 2,
          clientX: 10,
          clientY: 10,
        }),
      );
    });
    const handle = page.locator('[data-handle="waypoint"]').first();
    assert.ok(await handle.count());
    const hb = await handle.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + 25, hb.y + hb.height / 2 + 40, {
      steps: 5,
    });
    await page.mouse.up();
    assert.ok(
      await page.evaluate(() => PumlStudio.getGraph().edges[0].waypoints),
    );
    // Insert via the segment affordance, edit coordinates, delete and undo.
    const originalCount = await page
      .locator('[data-handle="waypoint"]')
      .count();
    await page.locator('[data-handle="insert"]').first().click();
    assert.equal(
      await page.locator('[data-handle="waypoint"]').count(),
      originalCount + 1,
    );
    await page
      .getByRole("spinbutton", { name: "折点 1 X", exact: true })
      .fill("333");
    await page
      .getByRole("spinbutton", { name: "折点 1 X", exact: true })
      .blur();
    assert.equal(
      await page.evaluate(() => PumlStudio.getGraph().edges[0].waypoints[0].x),
      333,
    );
    await page.getByRole("button", { name: "删除折点 1", exact: true }).click();
    assert.equal(
      await page.locator('[data-handle="waypoint"]').count(),
      originalCount,
    );
    await page.click("#undo");
    assert.equal(
      await page.locator('[data-handle="waypoint"]').count(),
      originalCount + 1,
    );
    await page.locator('[data-handle="waypoint"]').first().dblclick();
    assert.equal(
      await page.locator('[data-handle="waypoint"]').count(),
      originalCount,
    );
    await page.click("#undo");
    await page.click("#add-waypoint");
    assert.equal(
      await page.locator('[data-handle="waypoint"]').count(),
      originalCount + 2,
    );
    await page.click("#undo");
    // Fine endpoint placement and physical dragging, both ends independently.
    await page.fill("#source-x", "100");
    await page.fill("#source-y", "30");
    await page.locator("#source-y").blur();
    // Filling X commits on blur when Y receives focus; Y then refines it.
    assert.ok(
      await page.evaluate(() => PumlStudio.getGraph().edges[0].sourceAnchor),
    );
    for (const type of ["source-anchor", "target-anchor"]) {
      const handle = page.locator(`[data-handle="${type}"]`),
        h = await handle.boundingBox();
      await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
      await page.mouse.down();
      await page.mouse.move(h.x + h.width / 2 + 22, h.y + h.height / 2 - 14, {
        steps: 5,
      });
      await page.mouse.up();
    }
    assert.ok(
      await page.evaluate(() => PumlStudio.getGraph().edges[0].targetAnchor),
    );
    const anchors = await page.evaluate(() => ({
      source: PumlStudio.getGraph().edges[0].sourceAnchor,
      target: PumlStudio.getGraph().edges[0].targetAnchor,
    }));
    // Move source node through the inspector's normal canvas drag; attachment stays relative.
    const nodeBeforeMove = await page.evaluate(
      () => PumlStudio.getGraph().nodes[0],
    );
    const b = await page.locator(".node").first().boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + 16, b.y + b.height / 2 + 16, {
      steps: 4,
    });
    await page.mouse.up();
    assert.notEqual(
      await page.evaluate(() => PumlStudio.getGraph().nodes[0].x),
      nodeBeforeMove.x,
    );
    assert.deepEqual(
      await page.evaluate(() => PumlStudio.getGraph().edges[0].sourceAnchor),
      anchors.source,
    );
    // Re-select edge and capture the enhanced editor.
    await page
      .locator(".edge")
      .first()
      .dispatchEvent("pointerdown", { button: 0, pointerId: 4 });
    await page.screenshot({
      path: path.join(dir, "edge-editor.png"),
      fullPage: true,
    });
    const style = await page.evaluate(() =>
      new DOMParser()
        .parseFromString(PumlStudio.drawioString(), "application/xml")
        .querySelector('mxCell[edge="1"]')
        .getAttribute("style"),
    );
    assert.ok(style.includes("exitX=" + anchors.source.x + ";"));
    assert.ok(style.includes("entryY=" + anchors.target.y + ";"));
    const expected = await page.evaluate(() => PumlStudio.getGraph());
    const projectDownload = page.waitForEvent("download");
    await page.click("#save-project");
    const project = await projectDownload;
    const projectPath = path.join(dir, "roundtrip.pumlstudio");
    await project.saveAs(projectPath);
    const saved = JSON.parse(await fs.readFile(projectPath, "utf8"));
    assert.deepEqual(saved.nodes, expected.nodes);
    assert.deepEqual(saved.edges, expected.edges);
    await page.click("#add-node");
    assert.equal(await page.locator(".node").count(), 7);
    await page.setInputFiles("#project-input", projectPath);
    await page.waitForFunction(() => PumlStudio.getGraph().nodes.length === 6);
    assert.deepEqual(
      await page.evaluate(() => PumlStudio.getGraph().nodes),
      expected.nodes,
    );
    assert.deepEqual(
      await page.evaluate(() => PumlStudio.getGraph().edges),
      expected.edges,
    );
    const exported = await page.evaluate(() => {
      const xml = new DOMParser().parseFromString(
        PumlStudio.drawioString(),
        "application/xml",
      );
      return {
        errors: xml.querySelectorAll("parsererror").length,
        vertices: xml.querySelectorAll('mxCell[vertex="1"][parent="1"]').length,
        edges: xml.querySelectorAll('mxCell[edge="1"]').length,
      };
    });
    assert.equal(exported.errors, 0);
    assert.equal(exported.vertices, 6);
    assert.equal(exported.edges, 5);
    for (const format of ["svg", "png", "drawio"]) {
      await page.click("#export-menu");
      const promise = page.waitForEvent("download");
      await page.click(`[data-export="${format}"]`);
      const d = await promise;
      const target = path.join(dir, "export." + format);
      await d.saveAs(target);
      const bytes = await fs.readFile(target);
      assert.ok(bytes.length > 100);
      if (format === "png")
        assert.equal(bytes.subarray(1, 4).toString(), "PNG");
      if (format === "svg") assert.ok(bytes.toString().includes("手动微调"));
    }
    // Example switches and class compartment export.
    await page.selectOption("#examples", "classes");
    assert.ok((await page.locator(".node").count()) >= 4);
    assert.equal(
      await page.evaluate(
        () =>
          new DOMParser()
            .parseFromString(PumlStudio.drawioString(), "application/xml")
            .querySelectorAll("parsererror").length,
      ),
      0,
    );
    await page.selectOption("#examples", "activity");
    assert.equal(await page.locator(".node").count(), 8);
    // Malicious labels stay text; unknown syntax is visibly diagnosed.
    await page.fill(
      "#source",
      '@startuml\nrectangle "<img src=x onerror=alert(1)>" as X\nX --> Y\nunsupported syntax\n@enduml',
    );
    await page.click("#convert");
    assert.equal(await page.locator(".node").count(), 2);
    assert.equal(await page.locator(".node img").count(), 0);
    assert.ok(await page.locator(".warning").count());
    await page.selectOption("#examples", "components");
    await page.click("#fit");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.join(dir, "mobile.png"),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(network, []);
    console.log(
      "PASS: direct-file load; node drag; text edit; undo/redo; multiple waypoints; endpoint anchors; node-relative attachment; save/open; SVG/PNG/drawio downloads; examples; diagnostics; injection; mobile; no network requests.",
    );
    await page.close();
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
