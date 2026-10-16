const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parse, layout, validate } = require("../parser.js");
test("Chinese aliases, direction, color, relationships and implicit references", () => {
  const g = parse(
    'left to right direction\ncomponent "前端\\n工作台" as UI #DDEEF3\nUI --> API : 请求\ndatabase "存储" as DB\nAPI ..> DB',
  );
  assert.equal(g.nodes.length, 3);
  assert.equal(g.edges.length, 2);
  assert.equal(g.nodes[0].label, "前端\n工作台");
  assert.equal(g.nodes[0].fill, "#DDEEF3");
  assert.equal(g.edges[1].dashed, true);
  assert.equal(g.nodes[0].x < g.nodes[1].x, true);
  assert.equal(g.warnings.length, 0);
});
test("declarations after an edge reuse the same node", () => {
  const g = parse('A --> B\ncomponent "服务" as A');
  assert.equal(g.nodes.length, 2);
  assert.equal(g.nodes[0].label, "服务");
});
test("reverse arrows and inheritance retain relationship direction", () => {
  const g = parse("A <-- B\nclass Parent\nParent <|.. Child");
  assert.equal(g.edges.length, 2);
  assert.equal(g.nodes.find((n) => n.id === g.edges[0].source).alias, "B");
  assert.equal(g.nodes.find((n) => n.id === g.edges[1].target).alias, "Parent");
  assert.ok(g.warnings.length);
});
test("class members and Unicode identifiers", () => {
  const g = parse("class 用户 {\n+ name: string\n+ login()\n}\n用户 --> 会话");
  assert.equal(g.nodes[0].body, "+ name: string\n+ login()");
  assert.equal(g.nodes.length, 2);
  assert.equal(g.warnings.length, 0);
});
test("bracket components and quoted endpoints", () => {
  const g = parse('[Web App] as WEB\nWEB --> [API]\n"用户" --> WEB');
  assert.equal(g.nodes.length, 3);
  assert.equal(g.edges.length, 2);
});
test("activity chain becomes separately editable nodes", () => {
  const g = parse("start\n:导入;\n:编辑;\nstop");
  assert.equal(g.nodes.length, 4);
  assert.equal(g.edges.length, 3);
  assert.equal(g.nodes[0].kind, "start");
  assert.equal(g.nodes[3].kind, "end");
});
test("cycles, disconnected nodes and self loops produce finite bounded layout", () => {
  const g = parse("A --> B\nB --> C\nC --> A\nA --> A\nclass D");
  layout(g);
  assert.ok(g.nodes.every((n) => [n.x, n.y].every(Number.isFinite)));
  assert.ok(g.nodes.every((n) => n.x < 2000 && n.y < 2000));
  assert.equal(new Set(g.nodes.map((n) => `${n.x},${n.y}`)).size, 4);
});
test("unsupported syntax is diagnosed with source lines", () => {
  const g = parse(
    'skinparam dpi 160\npackage "Core" {\ncomponent A\n}\nif (ready?) then (yes)',
  );
  assert.deepEqual(
    g.warnings.map((w) => w.line),
    [1, 2, 5],
  );
  assert.equal(g.nodes.length, 1);
});
test("style and note blocks do not leak contents into graph", () => {
  const g = parse(
    "skinparam component {\nbackgroundColor red\n}\nnote right\nA --> B\nend note\nC --> D",
  );
  assert.equal(g.nodes.length, 2);
  assert.equal(g.edges.length, 1);
  assert.equal(g.warnings.length, 2);
});
test("unterminated block emits diagnostic", () => {
  assert.ok(
    parse("class A {\nfoo").warnings.some((w) => w.text.includes("未关闭")),
  );
});
test("project roundtrip preserves positions and bends", () => {
  const g = parse("A --> B");
  g.nodes[0].x = -100;
  g.edges[0].bend = { x: 200, y: 200 };
  const restored = validate(JSON.parse(JSON.stringify(g)));
  assert.equal(restored.nodes[0].x, -100);
  assert.deepEqual(restored.edges[0].bend, { x: 200, y: 200 });
});
test("reject corrupt projects and dangling edges", () => {
  const g = parse("A --> B");
  g.edges[0].target = "missing";
  assert.throws(() => validate(g));
  assert.throws(() => validate({ version: 2, nodes: [], edges: [] }));
});
test("reject duplicate IDs, invalid sizes and bends", () => {
  for (const mutate of [
    (g) => (g.nodes[1].id = g.nodes[0].id),
    (g) => (g.nodes[0].w = NaN),
    (g) => (g.edges[0].bend = { x: "x", y: 0 }),
  ]) {
    const g = parse("A --> B");
    mutate(g);
    assert.throws(() => validate(g));
  }
});
test("multiline labels remain plain text, not HTML", () => {
  const g = parse('rectangle "<script>alert(1)</script>" as A');
  assert.equal(g.nodes[0].label, "<script>alert(1)</script>");
});
test("colored arrows are preserved and approximation disclosed", () => {
  const g = parse("A -[#2485B4]> B : data");
  assert.equal(g.edges.length, 1);
  assert.ok(g.warnings.length);
});

test("new projects retain multiple waypoints and relative anchors", () => {
  const g = parse("A --> B");
  const e = g.edges[0];
  e.waypoints = [
    { x: 180, y: 200 },
    { x: 300, y: 200 },
    { x: 300, y: 450 },
  ];
  e.sourceAnchor = { x: 1, y: 0.3 };
  e.targetAnchor = { x: 0, y: 0.8 };
  assert.deepEqual(validate(JSON.parse(JSON.stringify(g))).edges, g.edges);
});
test("reject malformed waypoint arrays and invalid relative anchors", () => {
  for (const mutate of [
    (e) => (e.waypoints = {}),
    (e) => (e.waypoints = [null]),
    (e) => (e.waypoints = [{ x: 1, y: Infinity }]),
    (e) => (e.waypoints = Array(501).fill({ x: 1, y: 2 })),
    (e) => (e.sourceAnchor = { x: -0.1, y: 0.5 }),
    (e) => (e.targetAnchor = { x: 0, y: 1.1 }),
    (e) => (e.sourceAnchor = { x: "1", y: 0 }),
  ]) {
    const g = parse("A --> B");
    mutate(g.edges[0]);
    assert.throws(() => validate(g));
  }
});
test("auto layout clears manual waypoints but retains attachment choices", () => {
  const g = parse("A --> B");
  g.edges[0].waypoints = [{ x: 200, y: 300 }];
  g.edges[0].sourceAnchor = { x: 1, y: 0.4 };
  layout(g);
  assert.equal(g.edges[0].waypoints, null);
  assert.deepEqual(g.edges[0].sourceAnchor, { x: 1, y: 0.4 });
});
