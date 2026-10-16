/* PUML Studio — a deliberately bounded PlantUML structural parser. */
(function (root) {
  "use strict";
  function parse(source) {
    const nodes = [],
      edges = [],
      warnings = [],
      aliases = new Map();
    let direction = "TB",
      current = null,
      groupDepth = 0,
      activityLast = null,
      serial = 0;
    const warn = (line, text) => warnings.push({ line, text });
    const clean = (s) =>
      String(s).trim().replace(/^"|"$/g, "").replace(/\\n/g, "\n");
    function ensure(alias, label, kind = "rectangle", color) {
      alias = clean(alias);
      if (aliases.has(alias)) {
        const n = aliases.get(alias);
        if (label !== undefined) {
          n.label = clean(label);
          n.kind = kind;
          if (color) n.fill = color;
        }
        return n;
      }
      const n = {
        id: "n" + ++serial,
        alias,
        label: clean(label ?? alias),
        kind,
        x: 0,
        y: 0,
        w: 172,
        h: 76,
        fill: color || "#edf7f4",
        stroke: "#497e72",
        body: "",
      };
      if (["circle", "start", "end"].includes(kind)) {
        n.w = 42;
        n.h = 42;
      }
      if (kind === "actor") n.h = 112;
      if (kind === "diamond") {
        n.w = 156;
        n.h = 100;
      }
      nodes.push(n);
      aliases.set(alias, n);
      return n;
    }
    const lines = source.split(/\r?\n/);
    let blockComment = false,
      ignoredBlock = false;
    lines.forEach((raw, index) => {
      const line = index + 1;
      let t = raw.trim();
      if (blockComment) {
        if (t.includes("'/")) blockComment = false;
        return;
      }
      if (t.startsWith("/'")) {
        if (!t.slice(2).includes("'/")) blockComment = true;
        return;
      }
      if (!t || t.startsWith("'") || /^@(startuml|enduml)\b/i.test(t)) return;
      if (ignoredBlock) {
        if (t === "}" || /^end\s+(note|legend|title|header|footer)$/i.test(t))
          ignoredBlock = false;
        return;
      }
      if (current) {
        if (t === "}") {
          current = null;
          return;
        }
        current.body += (current.body ? "\n" : "") + t;
        return;
      }
      if (/^(left to right|top to bottom) direction$/i.test(t)) {
        direction = /^left/i.test(t) ? "LR" : "TB";
        return;
      }
      if (
        /^(skinparam|title|caption|legend|header|footer|hide|show|scale|!|note\b)/i.test(
          t,
        )
      ) {
        warn(line, "未转换样式、注释或预处理指令：" + t);
        if (
          t.endsWith("{") ||
          /^(legend|header|footer)$/.test(t) ||
          (/^note\b/.test(t) && !t.includes(":") && !/".*"/.test(t))
        )
          ignoredBlock = true;
        return;
      }
      if (
        /^(package|frame|folder|cloud|node|rectangle|component)\b.*\{\s*$/.test(
          t,
        ) &&
        !/^(class|interface|enum)\b/.test(t)
      ) {
        groupDepth++;
        warn(line, "容器将展开为平级节点：" + t);
        return;
      }
      if (t === "}" && groupDepth) {
        groupDepth--;
        return;
      }
      if (/^(start|stop|end)$/i.test(t)) {
        const n = ensure(
          "__activity_" + serial,
          t === "start" ? "" : "",
          t === "start" ? "start" : "end",
        );
        if (activityLast)
          edges.push({
            id: "e" + ++serial,
            source: activityLast.id,
            target: n.id,
            label: "",
            dashed: false,
            arrow: true,
            startArrow: false,
            bend: null,
          });
        activityLast = t === "start" ? n : null;
        return;
      }
      if (/^:.*;\s*$/.test(t)) {
        const n = ensure(
          "__activity_" + serial,
          t.slice(1).replace(/;\s*$/, ""),
          "round",
        );
        if (activityLast)
          edges.push({
            id: "e" + ++serial,
            source: activityLast.id,
            target: n.id,
            label: "",
            dashed: false,
            arrow: true,
            startArrow: false,
            bend: null,
          });
        activityLast = n;
        return;
      }
      // Quoted names, bracket components and bare aliases on both ends of an arrow.
      const endpoint = '("[^"\\n]+"|\\[[^\\]\\n]+\\]|[\\p{L}\\p{N}_.$]+)';
      const relation = new RegExp(
        "^" +
          endpoint +
          "\\s*(<?[|ox*]?[.=-]+(?:\\[[^\\]]*\\])?(?:(?:left|right|up|down|l|r|u|d)[.=-]*)?[>|ox*]?)\\s*" +
          endpoint +
          "(?:\\s*:\\s*(.*))?$",
        "u",
      );
      const rel = t.match(relation);
      if (rel) {
        const ref = (value) =>
          ensure(value.startsWith("[") ? value.slice(1, -1) : value);
        let a = ref(rel[1]),
          b = ref(rel[3]),
          arrow = rel[2];
        let endArrow = /[>|ox*]$/.test(arrow),
          startArrow = /^[<|ox*]/.test(arrow);
        if (startArrow && !endArrow) {
          [a, b] = [b, a];
          endArrow = true;
          startArrow = false;
        }
        edges.push({
          id: "e" + ++serial,
          source: a.id,
          target: b.id,
          label: clean(rel[4] || ""),
          dashed: arrow.includes("."),
          arrow: endArrow,
          startArrow,
          bend: null,
        });
        if (/[|ox*]|\[|left|right|up|down/.test(arrow))
          warn(
            line,
            "关系已保留；菱形端点、方向提示和内联样式简化为普通连线。",
          );
        return;
      }
      const decl = t.match(
        /^(rectangle|component|database|actor|usecase|class|interface|enum|entity|participant|queue|artifact|circle|object|state)\s+(?:"([^"]+)"(?:\s+as\s+([\p{L}\p{N}_.$]+))?|([\p{L}\p{N}_.$]+)(?:\s+as\s+"([^"]+)")?)(?:\s+(#[\da-fA-F]{3,8}))?\s*(\{)?\s*$/u,
      );
      if (decl) {
        const kind = decl[1],
          alias = decl[3] || decl[4] || decl[2],
          label = decl[2] || decl[5] || decl[4];
        const n = ensure(alias, label, kind, decl[6]);
        if (kind === "participant")
          warn(line, "时序参与者将转换为普通节点，不保留时间轴与生命线。");
        if (decl[7]) {
          current = n;
          n.h = 110;
        }
        return;
      }
      const bracket = t.match(/^\[([^\]]+)\](?:\s+as\s+([\p{L}\p{N}_.$]+))?$/u);
      if (bracket) {
        ensure(bracket[2] || bracket[1], bracket[1], "component");
        return;
      }
      const member = t.match(/^([\p{L}\p{N}_.$]+)\s*:\s*(.+)$/u);
      if (member && aliases.has(member[1])) {
        const n = aliases.get(member[1]);
        n.body += (n.body ? "\n" : "") + member[2];
        return;
      }
      warn(line, "未支持的语法：" + t);
    });
    if (current || groupDepth || blockComment || ignoredBlock)
      warn(lines.length, "存在未关闭的语法块，请检查源文件。");
    nodes.forEach((n) => {
      const longest = Math.max(
        ...(n.label + "\n" + n.body)
          .split("\n")
          .map((x) =>
            Array.from(x).reduce(
              (a, c) => a + (c.charCodeAt(0) > 255 ? 14 : 8),
              0,
            ),
          ),
        0,
      );
      if (!["circle", "start", "end"].includes(n.kind)) {
        n.w = Math.max(n.w, Math.min(440, longest + 40));
        n.h = Math.max(
          n.h,
          42 +
            n.label.split("\n").length * 20 +
            (n.body ? n.body.split("\n").length * 19 + 20 : 0),
        );
      }
    });
    const graph = { version: 1, source, direction, nodes, edges, warnings };
    layout(graph);
    return graph;
  }
  function layout(graph) {
    // Condense cycles before assigning ranks, so feedback edges do not inflate the layout.
    const adj = new Map(graph.nodes.map((n) => [n.id, []]));
    graph.edges.forEach((e) => {
      if (adj.has(e.source) && adj.has(e.target))
        adj.get(e.source).push(e.target);
    });
    let count = 0;
    const indices = new Map(),
      low = new Map(),
      stack = [],
      active = new Set(),
      components = [];
    function visit(v) {
      indices.set(v, count);
      low.set(v, count++);
      stack.push(v);
      active.add(v);
      for (const w of adj.get(v)) {
        if (!indices.has(w)) {
          visit(w);
          low.set(v, Math.min(low.get(v), low.get(w)));
        } else if (active.has(w))
          low.set(v, Math.min(low.get(v), indices.get(w)));
      }
      if (low.get(v) === indices.get(v)) {
        const c = [];
        let w;
        do {
          w = stack.pop();
          active.delete(w);
          c.push(w);
        } while (w !== v);
        components.push(c);
      }
    }
    for (const n of graph.nodes) if (!indices.has(n.id)) visit(n.id);
    const component = new Map();
    components.forEach((c, i) => c.forEach((v) => component.set(v, i)));
    const ranks = components.map(() => 0),
      outgoing = components.map(() => new Set()),
      indegrees = components.map(() => 0);
    graph.edges.forEach((e) => {
      const a = component.get(e.source),
        b = component.get(e.target);
      if (
        a !== undefined &&
        b !== undefined &&
        a !== b &&
        !outgoing[a].has(b)
      ) {
        outgoing[a].add(b);
        indegrees[b]++;
      }
    });
    const queue = indegrees
      .map((d, i) => (d === 0 ? i : null))
      .filter((i) => i !== null);
    for (let k = 0; k < queue.length; k++) {
      const a = queue[k];
      for (const b of outgoing[a]) {
        ranks[b] = Math.max(ranks[b], ranks[a] + 1);
        if (--indegrees[b] === 0) queue.push(b);
      }
    }
    const layers = new Map();
    graph.nodes.forEach((n) => {
      const r = ranks[component.get(n.id)];
      if (!layers.has(r)) layers.set(r, []);
      layers.get(r).push(n);
    });
    let primary = 80;
    for (const [, ns] of [...layers].sort((a, b) => a[0] - b[0])) {
      let secondary = 80;
      for (const n of ns) {
        n.x = graph.direction === "LR" ? primary : secondary;
        n.y = graph.direction === "LR" ? secondary : primary;
        secondary += (graph.direction === "LR" ? n.h : n.w) + 64;
      }
      primary +=
        Math.max(...ns.map((n) => (graph.direction === "LR" ? n.w : n.h))) +
        105;
    }
    graph.edges.forEach((e) => {
      e.bend = null;
      e.waypoints = null;
    });
    return graph;
  }
  function validate(value) {
    if (
      !value ||
      value.version !== 1 ||
      !Array.isArray(value.nodes) ||
      !Array.isArray(value.edges) ||
      value.nodes.length > 2000 ||
      value.edges.length > 5000
    )
      throw Error("无效或过大的项目文件");
    const ids = new Set();
    for (const n of value.nodes) {
      if (
        typeof n.id !== "string" ||
        ids.has(n.id) ||
        typeof n.label !== "string" ||
        ![n.x, n.y, n.w, n.h].every(Number.isFinite) ||
        n.w < 20 ||
        n.h < 20
      )
        throw Error("节点数据无效");
      ids.add(n.id);
      n.body = String(n.body || "");
      n.kind = String(n.kind || "rectangle");
      n.fill = /^#[\da-f]{3,8}$/i.test(n.fill) ? n.fill : "#edf7f4";
      n.stroke = /^#[\da-f]{3,8}$/i.test(n.stroke) ? n.stroke : "#497e72";
    }
    const edgeIds = new Set();
    for (const e of value.edges) {
      if (
        typeof e.id !== "string" ||
        ids.has(e.id) ||
        edgeIds.has(e.id) ||
        !ids.has(e.source) ||
        !ids.has(e.target) ||
        typeof e.label !== "string" ||
        (e.bend !== null &&
          e.bend !== undefined &&
          (!Number.isFinite(e.bend.x) || !Number.isFinite(e.bend.y)))
      )
        throw Error("连线数据无效");
      const validPoint = (p) =>
        p && Number.isFinite(p.x) && Number.isFinite(p.y);
      if (
        e.waypoints != null &&
        (!Array.isArray(e.waypoints) ||
          e.waypoints.length > 500 ||
          !e.waypoints.every(validPoint))
      )
        throw Error("折点数据无效");
      for (const key of ["sourceAnchor", "targetAnchor"]) {
        const a = e[key];
        if (
          a != null &&
          (!validPoint(a) || a.x < 0 || a.x > 1 || a.y < 0 || a.y > 1)
        )
          throw Error("连接位置数据无效");
      }
      if (e.labelStyle != null) {
        const s = e.labelStyle;
        if (
          !/^#[\da-f]{6}$/i.test(s.fill) ||
          !Number.isFinite(s.opacity) ||
          s.opacity < 0 ||
          s.opacity > 1
        )
          throw Error("文字框填充数据无效");
      }
      if (e.labelBox != null) {
        const b = e.labelBox;
        if (
          ![b.dx, b.dy, b.w, b.h].every(Number.isFinite) ||
          b.w < 32 ||
          b.w > 2400 ||
          b.h < 28 ||
          b.h > 10000
        )
          throw Error("文字框数据无效");
      }
      edgeIds.add(e.id);
    }
    return {
      version: 1,
      source: String(value.source || ""),
      direction: value.direction === "LR" ? "LR" : "TB",
      nodes: value.nodes,
      edges: value.edges,
      warnings: [],
    };
  }
  const api = { parse, layout, validate };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PumlParser = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
