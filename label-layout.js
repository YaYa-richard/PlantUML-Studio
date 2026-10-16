/* Shared line breaking for on-canvas and exported edge labels. */
(function (root) {
  "use strict";
  function wrap(text, width, measure) {
    const lines = [];
    for (const paragraph of String(text).replace(/\r\n?/g, "\n").split("\n")) {
      if (!paragraph) {
        lines.push("");
        continue;
      }
      let buffer = "";
      for (const char of Array.from(paragraph)) {
        if (buffer && measure(buffer + char) > width) {
          const space = buffer.lastIndexOf(" ");
          if (space > 0) {
            lines.push(buffer.slice(0, space));
            buffer = buffer.slice(space + 1) + char;
          } else {
            lines.push(buffer);
            buffer = char;
          }
          // A carried word can still exceed the width after breaking at a space.
          while (Array.from(buffer).length > 1 && measure(buffer) > width) {
            const chars = Array.from(buffer);
            let cut = 1;
            while (
              cut < chars.length &&
              measure(chars.slice(0, cut + 1).join("")) <= width
            )
              cut++;
            lines.push(chars.slice(0, cut).join(""));
            buffer = chars.slice(cut).join("");
          }
        } else buffer += char;
      }
      lines.push(buffer);
    }
    return lines;
  }
  function layout(
    text,
    options = {},
    measure = (s) =>
      Array.from(s).reduce(
        (sum, c) => sum + (c.charCodeAt(0) > 255 ? 11 : 6),
        0,
      ),
  ) {
    const natural = Math.max(0, ...String(text).split(/\r?\n/).map(measure));
    const w = Math.max(
      32,
      Math.min(2400, options.w ?? Math.max(40, Math.min(220, natural + 12))),
    );
    const lines = wrap(text, w - 12, measure);
    const h = Math.max(28, options.h || 0, lines.length * 16 + 12);
    return { w, h, lines };
  }
  const api = { wrap, layout };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PumlLabelLayout = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
