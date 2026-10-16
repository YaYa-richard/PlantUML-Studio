const { test } = require("node:test");
const assert = require("node:assert/strict");
const { wrap, layout } = require("../label-layout.js");
const { parse, validate } = require("../parser.js");
const measure = (s) => Array.from(s).length * 10;
test("Chinese text wraps without losing characters", () => {
  const text = "这是一个需要自动换行的中文标签";
  const lines = wrap(text, 40, measure);
  assert.equal(lines.join(""), text);
  assert.ok(lines.every((s) => measure(s) <= 40));
});
test("English words wrap at spaces; long words can break", () => {
  assert.deepEqual(wrap("hello world", 60, measure), ["hello", "world"]);
  assert.deepEqual(wrap("abcdefghij", 30, measure), ["abc", "def", "ghi", "j"]);
});
test("manual newlines and empty paragraphs survive wrapping", () => {
  assert.deepEqual(wrap("AB\n\nCD", 100, measure), ["AB", "", "CD"]);
});
test("layout expands height when a label becomes narrow", () => {
  const wide = layout("abcdefghijklmnop", { w: 180, h: 28 }, measure),
    narrow = layout("abcdefghijklmnop", { w: 52, h: 28 }, measure);
  assert.equal(wide.lines.length, 1);
  assert.equal(narrow.lines.length, 4);
  assert.ok(narrow.h > wide.h);
});
test("explicit larger height is preserved, width is bounded", () => {
  assert.equal(layout("hello", { w: 80, h: 200 }, measure).h, 200);
  assert.equal(layout("hello", { w: 1 }, measure).w, 32);
  assert.equal(layout("hello", { w: 5000 }, measure).w, 2400);
});
test("mixed labels including emoji do not split surrogate pairs", () => {
  const text = "中文ABC🚀DEF";
  const lines = wrap(text, 40, measure);
  assert.equal(lines.join(""), text);
  assert.ok(lines.every((s) => !/[\uD800-\uDBFF]$/.test(s)));
});
test("line widths remain bounded after a carried long word", () => {
  const lines = wrap("hi abcdefghijk 中文中文", 50, measure);
  assert.ok(lines.every((s) => measure(s) <= 50));
});
test("label boxes roundtrip and invalid label geometry is rejected", () => {
  const g = parse("A --> B : text");
  g.edges[0].labelBox = { dx: -100, dy: 90, w: 80, h: 70 };
  assert.deepEqual(validate(JSON.parse(JSON.stringify(g))).edges, g.edges);
  for (const b of [
    { dx: NaN, dy: 0, w: 80, h: 28 },
    { dx: 0, dy: 0, w: 0, h: 28 },
    { dx: 0, dy: 0, w: 80, h: -1 },
  ]) {
    g.edges[0].labelBox = b;
    assert.throws(() => validate(g));
  }
});

test("label fill roundtrips and rejects invalid colors/opacity", () => {
  const g = parse("A --> B : text");
  g.edges[0].labelStyle = { fill: "#ffcc88", opacity: 0.45 };
  assert.deepEqual(validate(JSON.parse(JSON.stringify(g))).edges, g.edges);
  for (const style of [
    { fill: "url(x)", opacity: 0.5 },
    { fill: "#ffffff", opacity: -1 },
    { fill: "#ffffff", opacity: 1.1 },
    { fill: "#ffffff", opacity: NaN },
  ]) {
    g.edges[0].labelStyle = style;
    assert.throws(() => validate(g));
  }
});
