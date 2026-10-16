const { test } = require("node:test");
const assert = require("node:assert/strict");
const snap = require("../snapping.js");
test("waypoint snaps to adjacent vertical and horizontal axes independently", () => {
  const r = snap.point(
    { x: 104, y: 196 },
    [
      { x: 100, y: 150 },
      { x: 220, y: 200 },
    ],
    1,
  );
  assert.deepEqual(r.position, { x: 100, y: 200 });
  assert.equal(r.guides.length, 2);
});
test("outside threshold stays free", () => {
  assert.deepEqual(
    snap.point({ x: 110, y: 210 }, [{ x: 100, y: 200 }]).position,
    { x: 110, y: 210 },
  );
});
test("tolerance is eight screen pixels at different zoom levels", () => {
  assert.equal(
    snap.point({ x: 103, y: 50 }, [{ x: 100, y: 100 }], 2).position.x,
    100,
  );
  assert.equal(
    snap.point({ x: 105, y: 50 }, [{ x: 100, y: 100 }], 2).position.x,
    105,
  );
  assert.equal(
    snap.point({ x: 114, y: 50 }, [{ x: 100, y: 100 }], 0.5).position.x,
    100,
  );
});
test("chooses nearest candidate and preserves fractional coordinates", () => {
  assert.equal(
    snap.point({ x: 104, y: 50 }, [
      { x: 100, y: 200 },
      { x: 105.5, y: 200 },
    ]).position.x,
    105.5,
  );
});
test("node center, left and right edges can align with other nodes", () => {
  const n = { x: 200, y: 300, w: 160, h: 80 };
  assert.equal(
    snap.node({ x: 204, y: 50 }, { w: 100, h: 60 }, [n]).position.x,
    200,
  );
  assert.equal(
    snap.node({ x: 233, y: 50 }, { w: 100, h: 60 }, [n]).position.x,
    230,
  );
  assert.equal(
    snap.node({ x: 263, y: 50 }, { w: 100, h: 60 }, [n]).position.x,
    260,
  );
});
test("no references produces no guide or position change", () => {
  const p = { x: -20, y: 10 };
  assert.deepEqual(snap.point(p, []), { position: p, guides: [] });
  assert.deepEqual(snap.node(p, { w: 100, h: 50 }, []).position, p);
});
