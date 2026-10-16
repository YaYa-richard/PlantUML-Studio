const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const fs = require("node:fs/promises");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : {}),
    args: ["--no-sandbox"],
  });
  try {
    const dir = path.resolve(__dirname, "../test-results");
    await fs.mkdir(dir, { recursive: true });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 960 },
      acceptDownloads: true,
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    await page.goto(
      pathToFileURL(path.resolve(__dirname, "../index.html")).href,
    );
    const node = (id, x, y) => ({
      id,
      label: id,
      kind: "rectangle",
      body: "",
      x,
      y,
      w: 150,
      h: 80,
      fill: "#edf7f4",
      stroke: "#497e72",
    });
    const text = "发送导航目标 Navigation request 包含目标坐标与任务编号";
    const fixture = {
      version: 1,
      source: "A --> B",
      direction: "LR",
      nodes: [node("A", 80, 120), node("B", 500, 120)],
      edges: [
        {
          id: "e",
          source: "A",
          target: "B",
          label: text,
          arrow: true,
          waypoints: [{ x: 350, y: 160 }],
        },
        {
          id: "other",
          source: "B",
          target: "A",
          label: "另一条线",
          arrow: true,
          waypoints: [{ x: 350, y: 320 }],
        },
      ],
    };
    await page.setInputFiles("#project-input", {
      name: "labels.pumlstudio",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(fixture)),
    });
    await page.waitForFunction(() => PumlStudio.getGraph().nodes[0].id === "A");
    const label = page.locator('[data-label="e"]'),
      rect = label.locator("rect");
    const original = await rect.boundingBox();
    await page.mouse.move(
      original.x + original.width / 2,
      original.y + original.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      original.x + original.width / 2 + 45,
      original.y + original.height / 2 - 80,
      { steps: 8 },
    );
    await page.mouse.up();
    assert.ok(
      await page.evaluate(() => PumlStudio.getGraph().edges[0].labelBox),
    );
    assert.equal(
      await page.evaluate(() => PumlStudio.getGraph().edges[1].labelBox),
      undefined,
    );
    const moved = await rect.boundingBox();
    assert.ok(moved.y < original.y - 60);
    await page.fill("#label-w", "80");
    await page.locator("#label-w").blur();
    assert.ok((await label.locator("tspan").count()) > 2);
    assert.ok(Number(await page.locator("#label-h").inputValue()) > 28);
    const geometry = await label.evaluate((g) => {
      const rect = g.querySelector("rect"),
        box = {
          x: +rect.getAttribute("x"),
          y: +rect.getAttribute("y"),
          w: +rect.getAttribute("width"),
          h: +rect.getAttribute("height"),
        };
      return {
        box,
        lines: [...g.querySelectorAll("tspan")].map((t) => ({
          text: t.textContent,
          width: t.getComputedTextLength(),
          bbox: { y: t.getBBox().y, height: t.getBBox().height },
        })),
      };
    });
    assert.equal(geometry.box.w, 80);
    assert.ok(geometry.lines.every((l) => l.width <= 68.5));
    assert.ok(
      geometry.lines.every(
        (l) =>
          l.bbox.y >= geometry.box.y &&
          l.bbox.y + l.bbox.height <= geometry.box.y + geometry.box.h,
      ),
    );
    // Real resize handle drag changes width, retains the top-left and reflows text.
    const beforeResize = await page.evaluate(
      () => PumlStudio.getGraph().edges[0].labelBox,
    );
    const h = await page.locator('[data-handle="label-resize"]').boundingBox();
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + h.width / 2 - 20, h.y + h.height / 2 + 15, {
      steps: 5,
    });
    await page.mouse.up();
    const afterResize = await page.evaluate(
      () => PumlStudio.getGraph().edges[0].labelBox,
    );
    assert.ok(afterResize.w < beforeResize.w);
    assert.ok(afterResize.h >= beforeResize.h);
    await page.click("#undo");
    assert.deepEqual(
      await page.evaluate(() => PumlStudio.getGraph().edges[0].labelBox),
      beforeResize,
    );
    await page.click("#redo");
    // Modal editing works on the draggable label.
    await label.dblclick();
    await page.fill("#edit-text", text + "\n手动换行");
    await page.click("#edit-confirm");
    await page.waitForFunction(() =>
      PumlStudio.getGraph().edges[0].label.endsWith("手动换行"),
    );
    await page.screenshot({
      path: path.join(dir, "label-editor.png"),
      fullPage: true,
    });
    // Transparent labels remain draggable; fill changes are independent of geometry.
    assert.equal(await rect.getAttribute("fill"), "none");
    const labelGeometry = await page.evaluate(
      () => PumlStudio.getGraph().edges[0].labelBox,
    );
    await page.selectOption("#label-fill-mode", "color");
    assert.equal(await rect.getAttribute("fill"), "#ffffff");
    await page.locator("#label-fill-color").fill("#ffcc88");
    await page.locator("#label-fill-color").dispatchEvent("change");
    await page.fill("#label-fill-opacity", "45");
    await page.locator("#label-fill-opacity").blur();
    assert.equal(await rect.getAttribute("fill"), "#ffcc88");
    assert.equal(await rect.getAttribute("fill-opacity"), "0.45");
    assert.deepEqual(
      await page.evaluate(() => PumlStudio.getGraph().edges[0].labelBox),
      labelGeometry,
    );
    const fillSvg = await page.evaluate(() => PumlStudio.svgString());
    assert.ok(fillSvg.includes('fill-opacity="0.45"'));
    const fillStyle = await page.evaluate(() =>
      new DOMParser()
        .parseFromString(PumlStudio.drawioString(), "application/xml")
        .querySelector('mxCell[vertex="1"][parent="e"]')
        .getAttribute("style"),
    );
    assert.ok(fillStyle.includes("fillColor=#ffcc88;"));
    assert.ok(fillStyle.includes("fillOpacity=45;"));
    await page.selectOption("#label-fill-mode", "transparent");
    assert.equal(await rect.getAttribute("fill"), "none");
    await page.click("#undo");
    assert.equal(await rect.getAttribute("fill-opacity"), "0.45");
    const expected = await page.evaluate(() => PumlStudio.getGraph());
    const pd = page.waitForEvent("download");
    await page.click("#save-project");
    const project = await pd;
    const projectPath = path.join(dir, "label-roundtrip.pumlstudio");
    await project.saveAs(projectPath);
    await page.click("#reset-label");
    assert.equal(
      await page.evaluate(() => PumlStudio.getGraph().edges[0].labelBox),
      undefined,
    );
    await page.setInputFiles("#project-input", projectPath);
    await page.waitForFunction(() => !!PumlStudio.getGraph().edges[0].labelBox);
    assert.deepEqual(
      await page.evaluate(() => PumlStudio.getGraph().edges),
      expected.edges,
    );
    const svg = await page.evaluate(
      () =>
        new DOMParser()
          .parseFromString(PumlStudio.svgString(), "image/svg+xml")
          .querySelector('[data-label="e"]').outerHTML,
    );
    assert.ok(svg.includes("手动换行"));
    assert.ok(svg.includes("<tspan"));
    const native = await page.evaluate(() => {
      const xml = new DOMParser().parseFromString(
          PumlStudio.drawioString(),
          "application/xml",
        ),
        label = xml.querySelector('mxCell[vertex="1"][parent="e"]');
      return {
        errors: xml.querySelectorAll("parsererror").length,
        value: label.getAttribute("value"),
        style: label.getAttribute("style"),
        width: +label.querySelector("mxGeometry").getAttribute("width"),
        height: +label.querySelector("mxGeometry").getAttribute("height"),
      };
    });
    assert.equal(native.errors, 0);
    assert.equal(native.width, afterResize.w);
    assert.ok(native.value.includes("\n"));
    assert.ok(native.style.includes("whiteSpace=wrap"));
    await page.click("#export-menu");
    const pngPromise = page.waitForEvent("download");
    await page.click('[data-export="png"]');
    const png = await pngPromise;
    await png.saveAs(path.join(dir, "labels.png"));
    assert.equal(
      (await fs.readFile(path.join(dir, "labels.png")))
        .subarray(1, 4)
        .toString(),
      "PNG",
    );
    // Very distant labels enlarge export bounds rather than being clipped.
    await label.dispatchEvent("pointerdown", { button: 0, pointerId: 1 });
    await page.fill("#label-x", "-300");
    await page.locator("#label-x").blur();
    assert.ok(
      await page.evaluate(
        () =>
          +new DOMParser()
            .parseFromString(PumlStudio.svgString(), "image/svg+xml")
            .documentElement.getAttribute("viewBox")
            .split(" ")[0] <= -340,
      ),
    );
    assert.deepEqual(errors, []);
    console.log(
      "PASS: independent label drag, numeric sizing, Chinese/English wrapping, auto height, resize handle, history, double-click edit, project roundtrip, SVG/PNG/native drawio label boxes, export bounds.",
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
