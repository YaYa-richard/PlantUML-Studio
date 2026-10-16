/* No network requests, no runtime dependencies. Open index.html directly. */
"use strict";
const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
const samples = {
  components: `@startuml
top to bottom direction

actor "用户" as User
component "Web 工作台" as Web
component "API 网关" as API
component "转换引擎" as Engine
database "项目存储" as Store
component "导出服务" as Export

User --> Web : 导入 .puml
Web --> API : 生成图形
Web --> Engine : 解析与布局
API --> Store : 保存项目
Engine --> Export : SVG / PNG
@enduml`,
  classes: `@startuml
left to right direction

interface Renderer {
  + render(graph): SVG
  + export(format): Blob
}
class Diagram {
  + nodes: Node[]
  + edges: Edge[]
  + layout()
}
class Editor {
  + selected: string
  + undo()
  + redo()
}
class Exporter {
  + toSVG()
  + toPNG()
}
Editor --> Diagram : edits
Diagram --> Renderer : renders
Renderer <|.. Exporter
@enduml`,
  activity: `@startuml
start
:导入 PlantUML 文件;
:解析节点与关系;
:生成可编辑画布;
:拖动节点，调整连线;
:保存项目;
:导出 SVG 或 PNG;
stop
@enduml`,
};
let graph = PumlParser.parse(samples.components),
  selected = null,
  tool = "select",
  connectFrom = null;
let view = { x: 20, y: 20, scale: 1 },
  history = [],
  future = [],
  gesture = null,
  space = false,
  dirty = false,
  fileName = "diagram";
let toastTimer, autosaveTimer;
const clone = (value) => JSON.parse(JSON.stringify(value));
function el(tag, attrs = {}, children = []) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  for (const c of children) n.append(c);
  return n;
}
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 3500);
}
function commit() {
  history.push(JSON.stringify(graph));
  if (history.length > 80) history.shift();
  future = [];
}
function changed(message = "已保存到本机草稿") {
  dirty = true;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        "puml-studio-v1",
        JSON.stringify({ ...graph, source: $("source").value }),
      );
      $("status").textContent = message;
    } catch {
      $("status").textContent = "草稿存储不可用，请保存项目";
    }
  }, 300);
  render();
}
function restore(stack, other) {
  if (!stack.length) return;
  other.push(JSON.stringify(graph));
  graph = JSON.parse(stack.pop());
  $("source").value = graph.source;
  if (!item()) selected = null;
  connectFrom = null;
  showWarnings();
  changed("已恢复历史版本");
}
function item() {
  return (
    graph.nodes.find((n) => n.id === selected) ||
    graph.edges.find((e) => e.id === selected)
  );
}
function bounds() {
  if (!graph.nodes.length) return { x: 0, y: 0, w: 600, h: 400 };
  let x = Math.min(...graph.nodes.map((n) => n.x)),
    y = Math.min(...graph.nodes.map((n) => n.y)),
    right = Math.max(...graph.nodes.map((n) => n.x + n.w)),
    bottom = Math.max(...graph.nodes.map((n) => n.y + n.h));
  for (const e of graph.edges) {
    const r = route(e);
    for (const p of r.points) {
      x = Math.min(x, p.x);
      y = Math.min(y, p.y);
      right = Math.max(right, p.x);
      bottom = Math.max(bottom, p.y);
    }
    if (e.label) {
      const box = labelBounds(e);
      x = Math.min(x, box.x);
      right = Math.max(right, box.x + box.w);
      y = Math.min(y, box.y);
      bottom = Math.max(bottom, box.y + box.h);
    }
  }
  return { x: x - 40, y: y - 40, w: right - x + 80, h: bottom - y + 80 };
}
function fit() {
  const b = bounds(),
    r = $("canvas-container").getBoundingClientRect();
  view.scale = Math.min(
    1.3,
    Math.max(0.08, Math.min((r.width - 60) / b.w, (r.height - 95) / b.h)),
  );
  view.x = (r.width - b.w * view.scale) / 2 - b.x * view.scale;
  view.y = (r.height - b.h * view.scale) / 2 - b.y * view.scale;
  updateView();
}
function updateView() {
  $("viewport").setAttribute(
    "transform",
    `translate(${view.x} ${view.y}) scale(${view.scale})`,
  );
  $("zoom-label").textContent = Math.round(view.scale * 100) + "%";
  $("grid").setAttribute(
    "patternTransform",
    `translate(${view.x} ${view.y}) scale(${view.scale})`,
  );
}
function point(event) {
  const r = $("canvas").getBoundingClientRect();
  return {
    x: (event.clientX - r.left - view.x) / view.scale,
    y: (event.clientY - r.top - view.y) / view.scale,
  };
}
function center(n) {
  return { x: n.x + n.w / 2, y: n.y + n.h / 2 };
}
function border(n, towards) {
  const c = center(n),
    dx = towards.x - c.x,
    dy = towards.y - c.y;
  if (!dx && !dy) return { x: c.x, y: n.y };
  let s;
  if (["circle", "start", "end", "usecase"].includes(n.kind))
    s =
      1 /
      Math.sqrt((dx * dx) / ((n.w * n.w) / 4) + (dy * dy) / ((n.h * n.h) / 4));
  else if (n.kind === "diamond")
    s = 1 / (Math.abs(dx) / (n.w / 2) + Math.abs(dy) / (n.h / 2));
  else
    s = Math.min(
      dx ? Math.abs(n.w / 2 / dx) : Infinity,
      dy ? Math.abs(n.h / 2 / dy) : Infinity,
    );
  return { x: c.x + dx * s, y: c.y + dy * s };
}
function automaticRoute(e) {
  const a = graph.nodes.find((n) => n.id === e.source),
    b = graph.nodes.find((n) => n.id === e.target);
  if (!a || !b)
    return { points: [], label: { x: 0, y: 0 }, handle: { x: 0, y: 0 } };
  let points, handle;
  if (a === b) {
    const bend = e.bend || { x: a.x + a.w + 65, y: a.y - 48 };
    points = [
      { x: a.x + a.w, y: a.y + a.h * 0.65 },
      { x: bend.x, y: a.y + a.h * 0.65 },
      bend,
      { x: a.x + a.w * 0.5, y: bend.y },
      { x: a.x + a.w * 0.5, y: a.y },
    ];
    handle = bend;
  } else if (e.bend) {
    points = [border(a, e.bend), e.bend, border(b, e.bend)];
    handle = e.bend;
  } else {
    const ca = center(a),
      cb = center(b),
      horizontal = graph.direction === "LR";
    const siblings = graph.edges.filter(
      (x) =>
        (x.source === e.source && x.target === e.target) ||
        (x.source === e.target && x.target === e.source),
    );
    const offset = (siblings.indexOf(e) - (siblings.length - 1) / 2) * 26;
    if (horizontal) {
      const mx = (ca.x + cb.x) / 2 + offset;
      points = [
        border(a, { x: cb.x, y: ca.y }),
        { x: mx, y: ca.y },
        { x: mx, y: cb.y },
        border(b, { x: ca.x, y: cb.y }),
      ];
      handle = { x: mx, y: (ca.y + cb.y) / 2 };
      if (Math.abs(ca.x - cb.x) < 2) {
        const y = Math.min(a.y, b.y) - 45 - offset;
        points = [
          { x: ca.x, y: a.y },
          { x: ca.x, y },
          { x: cb.x, y },
          { x: cb.x, y: b.y },
        ];
        handle = { x: (ca.x + cb.x) / 2, y };
      }
    } else {
      const my = (ca.y + cb.y) / 2 + offset;
      points = [
        border(a, { x: ca.x, y: cb.y }),
        { x: ca.x, y: my },
        { x: cb.x, y: my },
        border(b, { x: cb.x, y: ca.y }),
      ];
      handle = { x: (ca.x + cb.x) / 2, y: my };
      if (Math.abs(ca.y - cb.y) < 2) {
        const x = Math.max(a.x + a.w, b.x + b.w) + 45 + offset;
        points = [
          { x: a.x + a.w, y: ca.y },
          { x, y: ca.y },
          { x, y: cb.y },
          { x: b.x + b.w, y: cb.y },
        ];
        handle = { x, y: (ca.y + cb.y) / 2 };
      }
    }
  }
  return { points, label: { x: handle.x, y: handle.y - 10 }, handle };
}
// Anchors use node-relative coordinates so moving/resizing a node keeps attachment.
function anchorAt(node, anchor) {
  return { x: node.x + anchor.x * node.w, y: node.y + anchor.y * node.h };
}
function projectAnchor(node, position) {
  const p = border(node, position);
  return {
    x: Math.max(0, Math.min(1, (p.x - node.x) / node.w)),
    y: Math.max(0, Math.min(1, (p.y - node.y) / node.h)),
  };
}
function route(e) {
  const a = graph.nodes.find((n) => n.id === e.source);
  const b = graph.nodes.find((n) => n.id === e.target);
  if (!a || !b)
    return { points: [], label: { x: 0, y: 0 }, handle: { x: 0, y: 0 } };
  const automatic = automaticRoute(e);
  let points = automatic.points.map((p) => ({ ...p }));
  if (Array.isArray(e.waypoints)) {
    const middle = e.waypoints;
    points = [
      border(a, middle[0] || center(b)),
      ...middle.map((p) => ({ ...p })),
      border(b, middle.at(-1) || center(a)),
    ];
  }
  if (e.sourceAnchor) points[0] = anchorAt(a, e.sourceAnchor);
  if (e.targetAnchor) points[points.length - 1] = anchorAt(b, e.targetAnchor);
  // Keep explicit points, even when coincident: their indices are editable identities.
  if (!Array.isArray(e.waypoints))
    points = points.filter(
      (p, i) =>
        !i || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > 0.01,
    );
  if (points.length === 1) points.push({ ...points[0] });
  let total = 0;
  const lengths = points.slice(1).map((p, i) => {
    const d = Math.hypot(p.x - points[i].x, p.y - points[i].y);
    total += d;
    return d;
  });
  let remaining = total / 2,
    middle = points[0];
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) {
      const t = lengths[i] ? remaining / lengths[i] : 0;
      middle = {
        x: points[i].x + (points[i + 1].x - points[i].x) * t,
        y: points[i].y + (points[i + 1].y - points[i].y) * t,
      };
      break;
    }
    remaining -= lengths[i];
  }
  return { points, label: { x: middle.x, y: middle.y - 10 }, handle: middle };
}
function editableWaypoints(e) {
  if (!Array.isArray(e.waypoints))
    e.waypoints = route(e)
      .points.slice(1, -1)
      .map((p) => ({ ...p }));
  e.bend = null;
  return e.waypoints;
}
function insertWaypoint(e, index, position) {
  editableWaypoints(e).splice(index, 0, {
    x: Math.round(position.x),
    y: Math.round(position.y),
  });
}
function textLines(
  parent,
  text,
  x,
  y,
  {
    size = 13,
    anchor = "middle",
    weight = 400,
    color = "#29483f",
    lineHeight = 20,
  } = {},
) {
  const node = el("text", {
    x,
    y,
    "text-anchor": anchor,
    "font-size": size,
    "font-weight": weight,
    fill: color,
    "font-family": "Arial, Microsoft YaHei, sans-serif",
  });
  String(text)
    .split("\n")
    .forEach((line, i) => {
      const span = el("tspan", { x, dy: i ? lineHeight : 0 });
      span.textContent = line;
      node.append(span);
    });
  parent.append(node);
}
function nodeElement(n) {
  const g = el("g", {
    "data-node": n.id,
    class: "node",
    transform: `translate(${n.x} ${n.y})`,
  });
  const attrs = { fill: n.fill, stroke: n.stroke, "stroke-width": 1.5 };
  if (["circle", "start", "end", "usecase"].includes(n.kind)) {
    g.append(
      el("ellipse", {
        cx: n.w / 2,
        cy: n.h / 2,
        rx: n.w / 2,
        ry: n.h / 2,
        ...attrs,
        fill: n.kind === "start" ? n.stroke : n.fill,
      }),
    );
    if (n.kind === "end")
      g.append(
        el("ellipse", {
          cx: n.w / 2,
          cy: n.h / 2,
          rx: Math.max(3, n.w / 2 - 6),
          ry: Math.max(3, n.h / 2 - 6),
          fill: n.stroke,
        }),
      );
  } else if (n.kind === "diamond")
    g.append(
      el("polygon", {
        points: `${n.w / 2},0 ${n.w},${n.h / 2} ${n.w / 2},${n.h} 0,${n.h / 2}`,
        ...attrs,
      }),
    );
  else if (n.kind === "database") {
    g.append(
      el("path", {
        d: `M0 13 C0 -4 ${n.w} -4 ${n.w} 13 V${n.h - 13} C${n.w} ${n.h + 4} 0 ${n.h + 4} 0 ${n.h - 13} Z`,
        ...attrs,
      }),
    );
    g.append(
      el("path", {
        d: `M0 13 C0 30 ${n.w} 30 ${n.w} 13`,
        fill: "none",
        stroke: n.stroke,
        "stroke-width": 1.5,
      }),
    );
  } else if (n.kind === "actor") {
    const x = n.w / 2;
    g.append(el("circle", { cx: x, cy: 13, r: 11, ...attrs }));
    g.append(
      el("path", {
        d: `M${x} 24 V55 M${x - 24} 36 H${x + 24} M${x} 55 L${x - 19} 75 M${x} 55 L${x + 19} 75`,
        fill: "none",
        stroke: n.stroke,
        "stroke-width": 1.8,
      }),
    );
  } else {
    g.append(
      el("rect", {
        width: n.w,
        height: n.h,
        rx: ["round", "state"].includes(n.kind) ? 15 : 5,
        ...attrs,
      }),
    );
    if (n.kind === "component") {
      g.append(
        el("rect", {
          x: n.w - 24,
          y: 10,
          width: 12,
          height: 16,
          fill: n.fill,
          stroke: n.stroke,
        }),
      );
      g.append(
        el("path", {
          d: `M${n.w - 28} 13 h8 v4 h-8 Z M${n.w - 28} 20 h8 v4 h-8 Z`,
          fill: n.fill,
          stroke: n.stroke,
        }),
      );
    }
  }
  if (n.body) {
    const headerHeight = 24 + n.label.split("\n").length * 20;
    g.append(
      el("path", {
        d: `M0 ${headerHeight} H${n.w}`,
        stroke: n.stroke,
        "stroke-width": 1,
      }),
    );
    textLines(g, n.label, n.w / 2, 24, { weight: 600 });
    textLines(g, n.body, 14, headerHeight + 25, {
      anchor: "start",
      size: 12,
      lineHeight: 19,
    });
  } else if (!["start", "end"].includes(n.kind))
    textLines(
      g,
      n.label,
      n.w / 2,
      n.kind === "actor"
        ? 94
        : n.h / 2 + 5 - (n.label.split("\n").length - 1) * 10,
      { weight: 500 },
    );
  return g;
}
const labelMeasureContext = document.createElement("canvas").getContext("2d");
function measureLabel(text) {
  if (!labelMeasureContext) return Array.from(text).length * 11;
  labelMeasureContext.font = '11px Arial, "Microsoft YaHei", sans-serif';
  return labelMeasureContext.measureText(text).width;
}
function labelBounds(e) {
  const base = route(e).label,
    options = e.labelBox || {};
  const layout = PumlLabelLayout.layout(e.label, options, measureLabel);
  return {
    ...layout,
    x: base.x + (options.dx || 0) - layout.w / 2,
    y: base.y + (options.dy || 0) - layout.h / 2,
  };
}
function positionLabel(e, box) {
  const base = route(e).label;
  e.labelBox = {
    dx: box.x + box.w / 2 - base.x,
    dy: box.y + box.h / 2 - base.y,
    w: box.w,
    h: box.h,
  };
}
function resizeLabel(e, width, height, origin = labelBounds(e)) {
  const layout = PumlLabelLayout.layout(
    e.label,
    { w: width, h: height },
    measureLabel,
  );
  positionLabel(e, { ...origin, ...layout });
}
function labelFill(e) {
  return e.labelStyle || { fill: "#ffffff", opacity: 0 };
}
function labelElement(e) {
  const box = labelBounds(e),
    group = el("g", {
      "data-label": e.id,
      "data-edge": e.id,
      class: "edge-label",
    });
  group.append(
    el("rect", {
      x: box.x,
      y: box.y,
      width: box.w,
      height: box.h,
      rx: 3,
      fill: labelFill(e).opacity === 0 ? "none" : labelFill(e).fill,
      "fill-opacity": labelFill(e).opacity,
      "pointer-events": "all",
    }),
  );
  const top = box.y + (box.h - box.lines.length * 16) / 2 + 12;
  textLines(group, box.lines.join("\n"), box.x + box.w / 2, top, {
    size: 11,
    color: "#587269",
    lineHeight: 16,
  });
  return group;
}
function edgeElement(e) {
  const r = route(e),
    g = el("g", { "data-edge": e.id, class: "edge" });
  if (!r.points.length) return g;
  const d = r.points.map((p, i) => (i ? "L" : "M") + p.x + " " + p.y).join(" ");
  g.append(
    el("path", { d, fill: "none", stroke: "transparent", "stroke-width": 18 }),
  );
  const attrs = {
    d,
    fill: "none",
    stroke: selected === e.id ? "#159574" : "#607b76",
    "stroke-width": 1.7,
    "stroke-linejoin": "round",
  };
  if (e.dashed) attrs["stroke-dasharray"] = "6 5";
  if (e.arrow) attrs["marker-end"] = "url(#arrow)";
  if (e.startArrow) attrs["marker-start"] = "url(#arrow)";
  g.append(el("path", attrs));
  return g;
}
let snapEnabled = true;
let snapGuides = [];
function drawSnapGuides() {
  const layer = $("snap-guides");
  layer.replaceChildren();
  for (const guide of snapGuides) {
    const vertical = guide.axis === "x",
      a = guide.from,
      b = guide.to;
    const min = vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
    const max = vertical
      ? Math.max(a.y + (a.h || 0), b.y + (b.h || 0))
      : Math.max(a.x + (a.w || 0), b.x + (b.w || 0));
    layer.append(
      el("line", {
        x1: vertical ? guide.value : min - 25 / view.scale,
        y1: vertical ? min - 25 / view.scale : guide.value,
        x2: vertical ? guide.value : max + 25 / view.scale,
        y2: vertical ? max + 25 / view.scale : guide.value,
        stroke: "#c14f9f",
        "stroke-width": 1,
        "stroke-dasharray": "5 4",
        "vector-effect": "non-scaling-stroke",
      }),
    );
    const text = el("text", {
      x: vertical ? guide.value + 6 / view.scale : max + 6 / view.scale,
      y: vertical ? min - 30 / view.scale : guide.value - 6 / view.scale,
      fill: "#aa3c89",
      "font-size": 10 / view.scale,
    });
    text.textContent = vertical ? "垂直对齐" : "水平对齐";
    layer.append(text);
  }
}
$("snap-toggle").onclick = () => {
  snapEnabled = !snapEnabled;
  $("snap-toggle").classList.toggle("active", snapEnabled);
  $("snap-toggle").setAttribute("aria-pressed", String(snapEnabled));
  snapGuides = [];
  drawSnapGuides();
  toast(snapEnabled ? "吸附已开启 · 按住 Alt 可临时关闭" : "吸附已关闭");
};
function render(rebuild = true) {
  const nodes = $("nodes"),
    edges = $("edges"),
    handles = $("handles");
  if (rebuild) {
    nodes.replaceChildren(...graph.nodes.map(nodeElement));
    edges.replaceChildren(...graph.edges.map(edgeElement));
    $("labels").replaceChildren(
      ...graph.edges.filter((e) => e.label).map(labelElement),
    );
  } else {
    for (const g of edges.children) {
      for (const p of g.querySelectorAll("path"))
        if (p.getAttribute("stroke") !== "transparent")
          p.setAttribute(
            "stroke",
            g.dataset.edge === selected ? "#159574" : "#607b76",
          );
    }
  }
  handles.replaceChildren();
  const n = graph.nodes.find((n) => n.id === selected),
    e = graph.edges.find((e) => e.id === selected);
  if (n) {
    handles.append(
      el("rect", {
        x: n.x - 5,
        y: n.y - 5,
        width: n.w + 10,
        height: n.h + 10,
        rx: 7,
        class: "selection-outline",
      }),
    );
    handles.append(
      el("rect", {
        x: n.x + n.w - 4,
        y: n.y + n.h - 4,
        width: 9,
        height: 9,
        class: "handle",
        "data-handle": "resize",
      }),
    );
  }
  if (e) {
    const points = route(e).points;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i],
        b = points[i + 1];
      if (Math.hypot(b.x - a.x, b.y - a.y) < 24) continue;
      const x = (a.x + b.x) / 2,
        y = (a.y + b.y) / 2;
      const g = el("g", {
        "data-handle": "insert",
        "data-index": i,
        class: "insert-handle",
        transform: `translate(${x} ${y})`,
      });
      const title = el("title");
      title.textContent = "点击或拖动，添加折点";
      g.append(title);
      g.append(
        el("circle", {
          r: 7,
          fill: "#fff",
          stroke: "#80b7a7",
          "stroke-width": 1.4,
        }),
      );
      g.append(
        el("path", {
          d: "M-3 0 H3 M0 -3 V3",
          stroke: "#428a75",
          "stroke-width": 1.2,
          "pointer-events": "none",
        }),
      );
      handles.append(g);
    }
    points.slice(1, -1).forEach((p, index) => {
      const h = el("circle", {
        cx: p.x,
        cy: p.y,
        r: 6,
        class: "handle",
        "data-handle": "waypoint",
        "data-index": index,
      });
      const title = el("title");
      title.textContent = `折点 ${index + 1} · 拖动调整，双击删除`;
      h.append(title);
      handles.append(h);
    });
    for (const [index, type] of [
      [0, "source-anchor"],
      [points.length - 1, "target-anchor"],
    ]) {
      const p = points[index],
        h = el("rect", {
          x: p.x - 6,
          y: p.y - 6,
          width: 12,
          height: 12,
          rx: 3,
          class: "handle endpoint-handle",
          "data-handle": type,
        });
      const title = el("title");
      title.textContent =
        type === "source-anchor"
          ? "起点 · 拖动到节点边框任意位置"
          : "终点 · 拖动到节点边框任意位置";
      h.append(title);
      handles.append(h);
    }
  }
  if (e && e.label) {
    const box = labelBounds(e);
    handles.append(
      el("rect", {
        x: box.x,
        y: box.y,
        width: box.w,
        height: box.h,
        rx: 3,
        class: "selection-outline label-outline",
      }),
    );
    const handle = el("rect", {
      x: box.x + box.w - 5,
      y: box.y + box.h - 5,
      width: 10,
      height: 10,
      rx: 2,
      class: "handle label-resize-handle",
      "data-handle": "label-resize",
    });
    const title = el("title");
    title.textContent = "调整文字框宽高 · 缩窄自动换行";
    handle.append(title);
    handles.append(handle);
  }
  if (connectFrom) {
    const n = graph.nodes.find((n) => n.id === connectFrom);
    if (n)
      handles.append(
        el("rect", {
          x: n.x - 5,
          y: n.y - 5,
          width: n.w + 10,
          height: n.h + 10,
          class: "selection-outline",
        }),
      );
  }
  $("counts").textContent =
    `${graph.nodes.length} 个节点 / ${graph.edges.length} 条连线`;
  $("undo").disabled = !history.length;
  $("redo").disabled = !future.length;
  updateView();
  drawSnapGuides();
  inspector();
}
function inspector() {
  const n = graph.nodes.find((n) => n.id === selected),
    e = graph.edges.find((e) => e.id === selected),
    v = n || e;
  $("empty-inspector").hidden = !!v;
  $("properties").hidden = !v;
  if (!v) return;
  $("prop-label").value = v.label;
  $("node-props").hidden = !n;
  $("edge-props").hidden = !e;
  if (n) {
    $("prop-body").value = n.body;
    $("prop-kind").value = n.kind;
    $("prop-fill").value = n.fill.length === 7 ? n.fill : "#edf7f4";
    $("prop-stroke").value = n.stroke.length === 7 ? n.stroke : "#497e72";
    $("prop-w").value = n.w;
    $("prop-h").value = n.h;
  } else {
    $("prop-dashed").value = String(!!e.dashed);
    $("prop-arrow").value = String(!!e.arrow);
    const labelBox = labelBounds(e);
    const fill = labelFill(e);
    $("label-fill-mode").value = fill.opacity === 0 ? "transparent" : "color";
    $("label-fill-color").value = fill.fill;
    $("label-fill-opacity").value = Math.round(fill.opacity * 100);
    for (const key of ["x", "y", "w", "h"])
      $("label-" + key).value = +labelBox[key].toFixed(1);
    $("label-size-hint").textContent =
      `${labelBox.lines.length} 行 · 缩窄自动换行，高度不足时自动撑开`;
    const points = route(e).points;
    for (const [end, index] of [
      ["source", 0],
      ["target", points.length - 1],
    ]) {
      const n = graph.nodes.find((n) => n.id === e[end]);
      $(end + "-x").value = +((100 * (points[index].x - n.x)) / n.w).toFixed(1);
      $(end + "-y").value = +((100 * (points[index].y - n.y)) / n.h).toFixed(1);
    }
    $("waypoint-count").textContent =
      `${Math.max(0, points.length - 2)} 个折点`;
    $("waypoint-list").replaceChildren(
      ...points.slice(1, -1).map((p, index) => {
        const row = document.createElement("div");
        row.className = "waypoint-row";
        const label = document.createElement("span");
        label.textContent = index + 1;
        row.append(label);
        for (const axis of ["x", "y"]) {
          const input = document.createElement("input");
          input.type = "number";
          input.step = "1";
          input.value = Math.round(p[axis]);
          input.setAttribute(
            "aria-label",
            `折点 ${index + 1} ${axis.toUpperCase()}`,
          );
          input.onchange = () => {
            const value = Number(input.value);
            if (!Number.isFinite(value) || input.value === "") {
              inspector();
              return;
            }
            commit();
            editableWaypoints(e)[index][axis] = value;
            changed();
          };
          row.append(input);
        }
        const del = document.createElement("button");
        del.type = "button";
        del.textContent = "×";
        del.title = `删除折点 ${index + 1}`;
        del.setAttribute("aria-label", del.title);
        del.onclick = () => {
          commit();
          editableWaypoints(e).splice(index, 1);
          changed();
        };
        row.append(del);
        return row;
      }),
    );
  }
}
function showWarnings() {
  const ws = graph.warnings || [];
  $("diagnostic-title").textContent = ws.length
    ? `${ws.length} 条转换提示（请检查）`
    : "转换说明 · 无语法警告";
  $("warnings").replaceChildren(
    ...ws.map((w) => {
      const d = document.createElement("div");
      d.className = "warning";
      d.textContent = `L${w.line} · ${w.text}`;
      return d;
    }),
  );
  $("diagnostics").open = ws.length > 0;
}
function convert() {
  if (dirty && !confirm("重新生成将覆盖当前图形的手动修改，继续吗？")) return;
  commit();
  graph = PumlParser.parse($("source").value);
  selected = null;
  connectFrom = null;
  dirty = false;
  showWarnings();
  changed("已生成可编辑图形");
  dirty = false;
  fit();
  toast(
    graph.nodes.length
      ? "已生成独立节点和连线"
      : "没有识别到节点，请检查语法提示",
  );
}
function setTool(value) {
  tool = value;
  connectFrom = null;
  $("select-tool").classList.toggle("active", value === "select");
  $("pan-tool").classList.toggle("active", value === "pan");
  $("connect").classList.toggle("active", value === "connect");
  $("canvas-container").classList.toggle("connect-mode", value === "connect");
  $("canvas-container").classList.toggle("pan-mode", value === "pan");
  $("canvas-note").textContent =
    value === "connect"
      ? "依次点击起点和终点节点（Esc 取消）"
      : "拖动节点 · 选中连线调整端点与折点 · 点击 ＋ 添加折点";
  render();
}
$("canvas").addEventListener("pointerdown", (event) => {
  if (event.button !== 0 && event.button !== 1) return;
  event.preventDefault();
  $("canvas-container").focus();
  const p = point(event),
    node = event.target.closest("[data-node]"),
    edge = event.target.closest("[data-edge]"),
    label = event.target.closest("[data-label]"),
    handle = event.target.closest("[data-handle]");
  if (space || tool === "pan" || event.button === 1) {
    gesture = {
      type: "pan",
      clientX: event.clientX,
      clientY: event.clientY,
      x: view.x,
      y: view.y,
    };
  } else if (handle) {
    let type = handle.dataset.handle,
      index = Number(handle.dataset.index),
      committed = false;
    if (type === "insert") {
      commit();
      committed = true;
      const points = route(item()).points;
      insertWaypoint(item(), index, {
        x: (points[index].x + points[index + 1].x) / 2,
        y: (points[index].y + points[index + 1].y) / 2,
      });
      type = "waypoint";
      changed();
    }
    gesture = {
      type,
      index,
      committed,
      start: p,
      original: clone(item()),
      labelBox: item()?.source ? labelBounds(item()) : null,
      moved: false,
    };
  } else if (label) {
    selected = label.dataset.label;
    gesture = {
      type: "label-move",
      start: p,
      labelBox: labelBounds(item()),
      moved: false,
    };
    render(false);
  } else if (node) {
    const id = node.dataset.node;
    if (tool === "connect") {
      if (!connectFrom) {
        connectFrom = id;
        toast("现在点击终点节点");
        render();
      } else {
        commit();
        graph.edges.push({
          id: uid("e"),
          source: connectFrom,
          target: id,
          label: "",
          dashed: false,
          arrow: true,
          startArrow: false,
          bend: null,
        });
        setTool("select");
        changed();
      }
      return;
    }
    selected = id;
    const n = item();
    gesture = { type: "node", start: p, x: n.x, y: n.y, moved: false };
    render(false);
  } else {
    selected = edge ? edge.dataset.edge : null;
    render(false);
  }
  if (gesture && gesture.type === "pan")
    $("canvas").setPointerCapture(event.pointerId);
});
$("canvas").addEventListener("pointermove", (event) => {
  if (!gesture) return;
  const p = point(event),
    g = gesture;
  if (g.type === "pan") {
    view.x = g.x + event.clientX - g.clientX;
    view.y = g.y + event.clientY - g.clientY;
    updateView();
    return;
  }
  if (!g.moved && Math.hypot(p.x - g.start.x, p.y - g.start.y) < 2) return;
  if (!g.moved && !g.committed) commit();
  if (!g.moved) $("canvas").setPointerCapture(event.pointerId);
  g.moved = true;
  const v = item();
  if (!v) return;
  snapGuides = [];
  const snapping = snapEnabled && !event.altKey;
  if (g.type === "node") {
    const raw = { x: g.x + p.x - g.start.x, y: g.y + p.y - g.start.y };
    const result = snapping
      ? PumlSnap.node(
          raw,
          v,
          graph.nodes.filter((n) => n.id !== v.id),
          view.scale,
        )
      : { position: raw, guides: [] };
    v.x = result.guides.some((g) => g.axis === "x")
      ? result.position.x
      : Math.round(result.position.x);
    v.y = result.guides.some((g) => g.axis === "y")
      ? result.position.y
      : Math.round(result.position.y);
    snapGuides = result.guides.map((g) => ({
      ...g,
      to: { x: v.x, y: v.y, w: v.w, h: v.h },
    }));
  }
  if (g.type === "label-move") {
    positionLabel(v, {
      ...g.labelBox,
      x: Math.round(g.labelBox.x + p.x - g.start.x),
      y: Math.round(g.labelBox.y + p.y - g.start.y),
    });
  }
  if (g.type === "label-resize") {
    resizeLabel(
      v,
      Math.max(32, Math.round(g.labelBox.w + p.x - g.start.x)),
      Math.min(10000, Math.max(28, Math.round(g.labelBox.h + p.y - g.start.y))),
      g.labelBox,
    );
  }
  if (g.type === "resize") {
    v.w = Math.max(30, Math.round(g.original.w + p.x - g.start.x));
    v.h = Math.max(30, Math.round(g.original.h + p.y - g.start.y));
  }
  if (g.type === "waypoint") {
    const middle = editableWaypoints(v),
      points = route(v).points;
    const references = [points[g.index], points[g.index + 2]].map((ref, i) => {
      const atSource = i === 0 && g.index === 0,
        atTarget = i === 1 && g.index === middle.length - 1;
      // An automatic endpoint follows its node center when a segment becomes axial.
      if (atSource && !v.sourceAnchor)
        return center(graph.nodes.find((n) => n.id === v.source));
      if (atTarget && !v.targetAnchor)
        return center(graph.nodes.find((n) => n.id === v.target));
      return ref;
    });
    const result = snapping
      ? PumlSnap.point(p, references, view.scale)
      : { position: p, guides: [] };
    middle[g.index] = {
      x: result.guides.some((g) => g.axis === "x")
        ? result.position.x
        : Math.round(result.position.x),
      y: result.guides.some((g) => g.axis === "y")
        ? result.position.y
        : Math.round(result.position.y),
    };
    snapGuides = result.guides;
  }
  if (g.type === "source-anchor" || g.type === "target-anchor") {
    editableWaypoints(v);
    const end = g.type === "source-anchor" ? "source" : "target";
    const n = graph.nodes.find((n) => n.id === v[end]);
    v[end + "Anchor"] = projectAnchor(n, p);
  }
  render();
});
function finishGesture() {
  snapGuides = [];
  drawSnapGuides();
  if (gesture && gesture.type !== "pan" && gesture.moved) changed();
  gesture = null;
}
$("canvas").addEventListener("pointerup", finishGesture);
$("canvas").addEventListener("pointercancel", finishGesture);
$("canvas").addEventListener("dblclick", (event) => {
  const handle = event.target.closest("[data-handle]");
  if (handle) {
    if (handle.dataset.handle === "waypoint") {
      commit();
      editableWaypoints(item()).splice(Number(handle.dataset.index), 1);
      changed();
    }
    return;
  }
  const target = event.target.closest("[data-node],[data-edge]");
  if (!target) return;
  selected = target.dataset.node || target.dataset.edge;
  render();
  $("edit-text").value = item().label;
  $("edit-dialog").showModal();
  $("edit-text").focus();
});
$("edit-dialog").addEventListener("close", () => {
  if ($("edit-dialog").returnValue === "ok" && item()) {
    commit();
    item().label = $("edit-text").value;
    changed();
  }
});
function zoom(factor, cx, cy) {
  const r = $("canvas-container").getBoundingClientRect();
  cx ??= r.width / 2;
  cy ??= r.height / 2;
  const s = Math.min(3, Math.max(0.08, view.scale * factor));
  view.x = cx - ((cx - view.x) * s) / view.scale;
  view.y = cy - ((cy - view.y) * s) / view.scale;
  view.scale = s;
  updateView();
}
$("canvas-container").addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const r = $("canvas-container").getBoundingClientRect();
    zoom(e.deltaY < 0 ? 1.1 : 1 / 1.1, e.clientX - r.left, e.clientY - r.top);
  },
  { passive: false },
);
$("zoom-in").onclick = () => zoom(1.2);
$("zoom-out").onclick = () => zoom(1 / 1.2);
$("fit").onclick = fit;
$("select-tool").onclick = () => setTool("select");
$("pan-tool").onclick = () => setTool("pan");
$("connect").onclick = () => setTool(tool === "connect" ? "select" : "connect");
$("undo").onclick = () => restore(history, future);
$("redo").onclick = () => restore(future, history);
function uid(prefix) {
  let id;
  do {
    id = prefix + Math.random().toString(36).slice(2, 11);
  } while (
    graph.nodes.some((n) => n.id === id) ||
    graph.edges.some((e) => e.id === id)
  );
  return id;
}
$("add-node").onclick = () => {
  commit();
  const r = $("canvas-container").getBoundingClientRect();
  const n = {
    id: uid("n"),
    alias: "",
    label: "新节点",
    body: "",
    kind: "rectangle",
    x: Math.round((r.width / 2 - view.x) / view.scale - 86),
    y: Math.round((r.height / 2 - view.y) / view.scale - 38),
    w: 172,
    h: 76,
    fill: "#edf7f4",
    stroke: "#497e72",
  };
  graph.nodes.push(n);
  selected = n.id;
  changed();
};
function remove() {
  if (!selected) return;
  commit();
  graph.nodes = graph.nodes.filter((n) => n.id !== selected);
  graph.edges = graph.edges.filter(
    (e) => e.id !== selected && e.source !== selected && e.target !== selected,
  );
  selected = null;
  changed();
}
$("delete").onclick = remove;
$("layout").onclick = () => {
  if (!graph.nodes.length) return;
  if (!confirm("重新自动布局会重置节点位置和连线折点，继续吗？")) return;
  commit();
  PumlParser.layout(graph);
  changed();
  fit();
};
for (const [id, key] of Object.entries({
  "prop-label": "label",
  "prop-body": "body",
  "prop-kind": "kind",
  "prop-fill": "fill",
  "prop-stroke": "stroke",
  "prop-w": "w",
  "prop-h": "h",
  "prop-dashed": "dashed",
  "prop-arrow": "arrow",
}))
  $(id).addEventListener("change", () => {
    const v = item();
    if (!v) return;
    let value = $(id).value;
    if (["w", "h"].includes(key)) {
      value = Number(value);
      if (!Number.isFinite(value) || value < 30 || value > 1200) {
        inspector();
        toast("尺寸应在 30–1200 之间");
        return;
      }
    }
    if (["dashed", "arrow"].includes(key)) value = value === "true";
    commit();
    v[key] = value;
    changed();
  });
$("reset-bend").onclick = () => {
  if (item()) {
    commit();
    item().bend = null;
    item().waypoints = null;
    changed();
  }
};
for (const end of ["source", "target"]) {
  for (const axis of ["x", "y"])
    $(end + "-" + axis).onchange = () => {
      const e = item();
      if (!e || !e.source) return;
      const x = Number($(end + "-x").value),
        y = Number($(end + "-y").value);
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        x > 100 ||
        y < 0 ||
        y > 100
      ) {
        inspector();
        toast("连接位置应为 0–100%");
        return;
      }
      commit();
      editableWaypoints(e);
      const n = graph.nodes.find((n) => n.id === e[end]);
      e[end + "Anchor"] = projectAnchor(n, {
        x: n.x + (x * n.w) / 100,
        y: n.y + (y * n.h) / 100,
      });
      changed();
    };
  $(end + "-reset").onclick = () => {
    const e = item();
    if (!e?.source) return;
    commit();
    delete e[end + "Anchor"];
    changed();
  };
}
$("add-waypoint").onclick = () => {
  const e = item();
  if (!e?.source) return;
  const points = route(e).points;
  let index = 0,
    max = -1;
  for (let i = 0; i < points.length - 1; i++) {
    const d = Math.hypot(
      points[i + 1].x - points[i].x,
      points[i + 1].y - points[i].y,
    );
    if (d > max) {
      max = d;
      index = i;
    }
  }
  commit();
  insertWaypoint(e, index, {
    x: (points[index].x + points[index + 1].x) / 2,
    y: (points[index].y + points[index + 1].y) / 2,
  });
  changed();
};
for (const key of ["x", "y", "w", "h"])
  $("label-" + key).onchange = () => {
    const e = item();
    if (!e?.source) return;
    const input = $("label-" + key),
      value = Number(input.value);
    if (
      !input.value ||
      !Number.isFinite(value) ||
      ((key === "w" || key === "h") &&
        (value < (key === "w" ? 32 : 28) ||
          value > (key === "w" ? 2400 : 10000)))
    ) {
      inspector();
      toast("文字框尺寸超出范围");
      return;
    }
    commit();
    const box = labelBounds(e);
    if (key === "w" || key === "h")
      resizeLabel(
        e,
        key === "w" ? value : box.w,
        key === "h" ? value : box.h,
        box,
      );
    else positionLabel(e, { ...box, [key]: value });
    changed();
  };
for (const id of ["label-fill-mode", "label-fill-color", "label-fill-opacity"])
  $(id).onchange = () => {
    const e = item();
    if (!e?.source) return;
    const style = { ...labelFill(e) };
    if (id === "label-fill-mode")
      style.opacity = $(id).value === "transparent" ? 0 : style.opacity || 1;
    if (id === "label-fill-color") {
      style.fill = $(id).value;
      if (!style.opacity) style.opacity = 1;
    }
    if (id === "label-fill-opacity") {
      const value = Number($(id).value);
      if (
        $(id).value === "" ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 100
      ) {
        inspector();
        toast("填充不透明度应为 0–100%");
        return;
      }
      style.opacity = value / 100;
    }
    commit();
    e.labelStyle = style;
    changed();
  };
$("reset-label").onclick = () => {
  const e = item();
  if (!e?.source) return;
  commit();
  delete e.labelBox;
  changed();
};
$("convert").onclick = convert;
$("examples").onchange = () => {
  if (dirty && !confirm("切换示例将覆盖当前图形，继续吗？")) return;
  $("source").value = samples[$("examples").value];
  dirty = false;
  convert();
};
$("source").addEventListener("input", () => {
  $("status").textContent = "源码已修改 · 点击生成应用到画布";
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(
        "puml-studio-v1",
        JSON.stringify({ ...graph, source: $("source").value }),
      );
    } catch {}
  }, 400);
});
$("import").onclick = () => $("file-input").click();
$("load-project").onclick = () => $("project-input").click();
async function importFile(file, isProject = false) {
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    toast("文件过大，请使用 5 MB 以内的文件");
    return;
  }
  try {
    const text = await file.text();
    if (isProject) {
      const value = PumlParser.validate(JSON.parse(text));
      if (dirty && !confirm("打开项目将替换当前画布，继续吗？")) return;
      commit();
      graph = value;
      $("source").value = graph.source;
      selected = null;
      connectFrom = null;
      showWarnings();
      changed("项目已打开");
      fit();
      toast("项目布局已恢复");
    } else {
      if (dirty && !confirm("导入将替换当前图形，继续吗？")) return;
      $("source").value = text;
      dirty = false;
      convert();
    }
    fileName = file.name.replace(/\.(puml|plantuml|txt|json|pumlstudio)$/i, "");
  } catch (error) {
    toast("无法打开文件：" + error.message);
  }
}
$("file-input").onchange = (e) => {
  importFile(e.target.files[0]);
  e.target.value = "";
};
$("project-input").onchange = (e) => {
  importFile(e.target.files[0], true);
  e.target.value = "";
};
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) importFile(f, /\.(json|pumlstudio)$/i.test(f.name));
});
function download(content, type, name) {
  const url = URL.createObjectURL(
    content instanceof Blob ? content : new Blob([content], { type }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
$("save-project").onclick = () => {
  download(
    JSON.stringify({ ...graph, source: $("source").value }, null, 2),
    "application/json",
    fileName + ".pumlstudio",
  );
  dirty = false;
  toast("项目已保存，包含源码和手动布局");
};
function svgString() {
  const b = bounds(),
    svg = el("svg", {
      xmlns: NS,
      width: b.w,
      height: b.h,
      viewBox: `${b.x} ${b.y} ${b.w} ${b.h}`,
    });
  svg.append($("canvas").querySelector("defs").cloneNode(true));
  svg.append(
    el("rect", { x: b.x, y: b.y, width: b.w, height: b.h, fill: "#ffffff" }),
  );
  const previous = selected;
  selected = null;
  for (const e of graph.edges) {
    const g = edgeElement(e);
    g.querySelectorAll('[stroke="transparent"]').forEach((n) => n.remove());
    svg.append(g);
  }
  for (const n of graph.nodes) svg.append(nodeElement(n));
  for (const e of graph.edges) if (e.label) svg.append(labelElement(e));
  selected = previous;
  return new XMLSerializer().serializeToString(svg);
}
async function exportPNG() {
  const b = bounds(),
    scale = 2;
  if (
    b.w * scale > 16000 ||
    b.h * scale > 16000 ||
    b.w * b.h * scale * scale > 64000000
  ) {
    toast("图片尺寸过大，请导出 SVG 或缩小布局");
    return;
  }
  const url = URL.createObjectURL(
    new Blob([svgString()], { type: "image/svg+xml;charset=utf-8" }),
  );
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(Error("SVG 光栅化失败"));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(b.w * scale);
    canvas.height = Math.ceil(b.h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw Error("浏览器不支持 Canvas");
    ctx.scale(scale, scale);
    ctx.drawImage(image, 0, 0, b.w, b.h);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw Error("PNG 编码失败");
    download(blob, "image/png", fileName + ".png");
    toast("PNG 已导出 · 2× 分辨率");
  } finally {
    URL.revokeObjectURL(url);
  }
}
function drawioString() {
  const doc = document.implementation.createDocument("", "mxfile");
  const mk = (parent, tag, attrs = {}) => {
    const n = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    parent.append(n);
    return n;
  };
  const diagram = mk(doc.documentElement, "diagram", {
    name: "Page-1",
    id: "puml-studio",
  });
  const model = mk(diagram, "mxGraphModel", { grid: 1, gridSize: 10, page: 0 });
  const root = mk(model, "root");
  mk(root, "mxCell", { id: 0 });
  mk(root, "mxCell", { id: 1, parent: 0 });
  const shapeMap = {
    database: "shape=cylinder3;",
    actor: "shape=umlActor;",
    circle: "ellipse;",
    start: "ellipse;",
    end: "ellipse;shape=endState;",
    diamond: "rhombus;",
    usecase: "ellipse;",
    component: "shape=component;",
    round: "rounded=1;",
    state: "rounded=1;",
  };
  for (const n of graph.nodes) {
    const style =
      (shapeMap[n.kind] || "rounded=0;") +
      `whiteSpace=wrap;html=0;fillColor=${n.fill};strokeColor=${n.stroke};fontColor=#29483f;fontSize=13;`;
    if (n.body) {
      const parent = mk(root, "mxCell", {
        id: n.id,
        value: n.label,
        vertex: 1,
        parent: 1,
        style: `swimlane;html=0;startSize=${24 + n.label.split("\n").length * 20};horizontal=1;fillColor=${n.fill};swimlaneFillColor=${n.fill};strokeColor=${n.stroke};fontColor=#29483f;whiteSpace=wrap;`,
      });
      mk(parent, "mxGeometry", {
        x: n.x,
        y: n.y,
        width: n.w,
        height: n.h,
        as: "geometry",
      });
      const child = mk(root, "mxCell", {
        id: n.id + "_body",
        value: n.body,
        vertex: 1,
        parent: n.id,
        style:
          "text;html=0;align=left;verticalAlign=top;spacingLeft=12;spacingTop=8;whiteSpace=wrap;fontSize=12;overflow=hidden;",
      });
      const hh = 24 + n.label.split("\n").length * 20;
      mk(child, "mxGeometry", {
        x: 0,
        y: hh,
        width: n.w,
        height: Math.max(20, n.h - hh),
        as: "geometry",
      });
    } else {
      const c = mk(root, "mxCell", {
        id: n.id,
        value: n.label,
        vertex: 1,
        parent: 1,
        style,
      });
      mk(c, "mxGeometry", {
        x: n.x,
        y: n.y,
        width: n.w,
        height: n.h,
        as: "geometry",
      });
    }
  }
  for (const e of graph.edges) {
    const endpointStyle = [
      ["source", "exit", route(e).points[0]],
      ["target", "entry", route(e).points.at(-1)],
    ]
      .map(([end, prefix, p]) => {
        const n = graph.nodes.find((n) => n.id === e[end]);
        return `${prefix}X=${(p.x - n.x) / n.w};${prefix}Y=${(p.y - n.y) / n.h};${prefix}Dx=0;${prefix}Dy=0;${prefix}Perimeter=0;`;
      })
      .join("");
    const c = mk(root, "mxCell", {
      id: e.id,
      value: "",
      edge: 1,
      parent: 1,
      source: e.source,
      target: e.target,
      style: `${endpointStyle}edgeStyle=none;rounded=0;html=0;strokeColor=#607b76;endArrow=${e.arrow ? "block" : "none"};startArrow=${e.startArrow ? "block" : "none"};dashed=${e.dashed ? 1 : 0};fontSize=11;labelBackgroundColor=none;`,
    });
    const geometry = mk(c, "mxGeometry", { relative: 1, as: "geometry" });
    if (e.label) {
      const box = labelBounds(e),
        midpoint = route(e).handle;
      let labelId = e.id + "_label";
      while ([...root.children].some((c) => c.getAttribute("id") === labelId))
        labelId += "_";
      const cell = mk(root, "mxCell", {
        id: labelId,
        value: box.lines.join("\n"),
        vertex: 1,
        connectable: 0,
        parent: e.id,
        style: `edgeLabel;html=0;align=center;verticalAlign=middle;whiteSpace=wrap;resizable=1;fontSize=11;fontColor=#587269;fillColor=${labelFill(e).opacity === 0 ? "none" : labelFill(e).fill};fillOpacity=${labelFill(e).opacity * 100};spacing=6;`,
      });
      const geo = mk(cell, "mxGeometry", {
        x: 0,
        y: 0,
        width: box.w,
        height: box.h,
        relative: 1,
        as: "geometry",
      });
      mk(geo, "mxPoint", {
        x: box.x - midpoint.x,
        y: box.y - midpoint.y,
        as: "offset",
      });
    }
    const points = route(e).points.slice(1, -1);
    if (points.length) {
      const array = mk(geometry, "Array", { as: "points" });
      points.forEach((p) => mk(array, "mxPoint", { x: p.x, y: p.y }));
    }
  }
  return new XMLSerializer().serializeToString(doc);
}
$("export-menu").onclick = () => {
  $("export-options").hidden = !$("export-options").hidden;
  $("export-menu").setAttribute(
    "aria-expanded",
    String(!$("export-options").hidden),
  );
};
document.addEventListener("click", (e) => {
  if (!e.target.closest(".export-wrap")) {
    $("export-options").hidden = true;
    $("export-menu").setAttribute("aria-expanded", "false");
  }
});
for (const button of document.querySelectorAll("[data-export]"))
  button.onclick = async () => {
    $("export-options").hidden = true;
    $("export-menu").setAttribute("aria-expanded", "false");
    if (!graph.nodes.length) {
      toast("画布为空，请先生成图形");
      return;
    }
    try {
      if (button.dataset.export === "svg") {
        download(svgString(), "image/svg+xml;charset=utf-8", fileName + ".svg");
        toast("SVG 已导出");
      }
      if (button.dataset.export === "png") await exportPNG();
      if (button.dataset.export === "drawio") {
        download(drawioString(), "application/xml", fileName + ".drawio");
        toast("draw.io 已导出 · 独立节点和连线");
      }
    } catch (error) {
      toast("导出失败：" + error.message);
    }
  };
document.addEventListener("keydown", (e) => {
  const editing =
    /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) ||
    $("edit-dialog").open;
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    convert();
    return;
  }
  if (editing) return;
  if (e.code === "Space") {
    space = true;
    e.preventDefault();
  }
  if (e.key === "Escape") {
    setTool("select");
    selected = null;
    render();
  }
  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    remove();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    restore(e.shiftKey ? future : history, e.shiftKey ? history : future);
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    $("save-project").click();
  }
});
document.addEventListener("keyup", (e) => {
  if (e.code === "Space") space = false;
});
window.addEventListener("blur", () => {
  space = false;
  finishGesture();
});
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
try {
  const saved = localStorage.getItem("puml-studio-v1");
  if (saved) {
    graph = PumlParser.validate(JSON.parse(saved));
    $("status").textContent = "已恢复本机草稿";
  }
} catch {}
$("source").value = graph.source;
showWarnings();
render();
requestAnimationFrame(fit);
new ResizeObserver(() => {
  fit();
}).observe($("canvas-container"));
// Exposed for local integration tests and embedding; no dependency on a server.
window.PumlStudio = {
  getGraph: () => clone(graph),
  svgString,
  drawioString,
  fit,
};
