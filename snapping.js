/* Screen-space snapping. No dependency on the DOM. */
(function (root) {
  "use strict";
  function nearest(value, candidates, threshold) {
    let result = null;
    for (const candidate of candidates) {
      const distance = Math.abs(candidate.value - value);
      if (distance <= threshold && (!result || distance < result.distance))
        result = { ...candidate, distance };
    }
    return result;
  }
  function point(position, references, scale = 1) {
    const tolerance = 8 / Math.max(0.08, scale),
      guides = [];
    const out = { x: position.x, y: position.y };
    for (const axis of ["x", "y"]) {
      const match = nearest(
        position[axis],
        references.map((ref) => ({ value: ref[axis], ref })),
        tolerance,
      );
      if (match) {
        out[axis] = match.value;
        guides.push({ axis, value: match.value, from: match.ref, to: out });
      }
    }
    return { position: out, guides };
  }
  function node(position, size, others, scale = 1) {
    const tolerance = 8 / Math.max(0.08, scale),
      guides = [],
      out = { ...position };
    for (const axis of ["x", "y"]) {
      const dimension = axis === "x" ? "w" : "h",
        offsets = [0, size[dimension] / 2, size[dimension]];
      const candidates = [];
      for (const other of others)
        for (const targetOffset of [0, other[dimension] / 2, other[dimension]])
          for (const offset of offsets)
            candidates.push({
              value: other[axis] + targetOffset - offset,
              ref: other,
              offset,
              target: other[axis] + targetOffset,
            });
      const match = nearest(position[axis], candidates, tolerance);
      if (match) {
        out[axis] = match.value;
        guides.push({ axis, value: match.target, from: match.ref, to: out });
      }
    }
    return { position: out, guides };
  }
  const api = { point, node };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PumlSnap = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
