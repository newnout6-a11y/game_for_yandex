import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../public/vendor/three.js';
import { loadRoadsterGeometry } from './helpers/roadster-geometry.mjs';

// These tests inspect the shipped Blender export, not a substitute JS model.
// Analytic design stations identify the exterior skin, excluding its inward
// thickness and the deliberately separate wing-pocket return surfaces.
const { scene } = await loadRoadsterGeometry();
const root = scene.getObjectByName('Roadster');
const W = [[-2.35,.700],[-2.25,.805],[-2.02,.935],[-1.47,1.063],[-.86,.975],[-.20,.958],[.55,.968],[1.47,1.063],[1.95,1.006],[2.35,.937]];
const H = [[-2.35,.571],[-2.17,.666],[-1.94,.768],[-1.47,.866],[-.85,.851],[-.15,.846],[.56,.855],[1.47,.901],[1.95,.858],[2.35,.802]];
const HC = [[-2.35,.566],[-2.13,.675],[-1.72,.774],[-1.20,.846],[-.85,.846],[1.15,.873],[1.60,.849],[2.10,.820],[2.35,.802]];

/** Evaluate the same monotone design profile in game metres. */
function interp(t, entries) {
  if (t <= entries[0][0]) return entries[0][1];
  if (t >= entries.at(-1)[0]) return entries.at(-1)[1];
  const slopes = entries.slice(1).map((b, i) => (b[1] - entries[i][1]) / (b[0] - entries[i][0]));
  const tangent = [slopes[0], ...slopes.slice(1).map((b, i) => slopes[i] * b <= 0 ? 0 : 2 * slopes[i] * b / (slopes[i] + b)), slopes.at(-1)];
  for (let i = 0; i < entries.length - 1; i++) {
    const [a, b] = [entries[i], entries[i + 1]];
    if (t < a[0] || t > b[0]) continue;
    const d = b[0] - a[0], u = (t - a[0]) / d;
    return (2*u**3 - 3*u*u + 1)*a[1] + (u**3 - 2*u*u + u)*d*tangent[i]
      + (-2*u**3 + 3*u*u)*b[1] + (u**3 - u*u)*d*tangent[i + 1];
  }
}

function sideX(z, y) {
  const q = Math.max(0, Math.min(1, (y - .205) / (interp(z, H) - .205)));
  return interp(z, W) - interp(q, [[0,.08],[.08,.061],[.25,.03],[.53,.02],[.79,.004],[.90,0],[1,.031]]);
}

function sideNormal(p) {
  const e = .0001;
  return new T.Vector3(Math.sign(p.x), -(sideX(p.z, p.y + e) - sideX(p.z, p.y - e)) / (2*e),
    -(sideX(p.z + e, p.y) - sideX(p.z - e, p.y)) / (2*e)).normalize();
}

/** Read positions, indexed winding and shading normals in authored coordinates. */
function triangles(name) {
  const mesh = root.getObjectByName(name), geometry = mesh.geometry;
  const matrix = root.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
  const normalMatrix = new T.Matrix3().getNormalMatrix(matrix), result = [];
  for (let i = 0; i < geometry.index.count; i += 3) {
    const indices = [0, 1, 2].map(j => geometry.index.getX(i + j));
    const p = indices.map(k => new T.Vector3().fromBufferAttribute(geometry.attributes.position, k).applyMatrix4(matrix));
    const n = indices.map(k => new T.Vector3().fromBufferAttribute(geometry.attributes.normal, k).applyMatrix3(normalMatrix).normalize());
    const face = new T.Vector3().subVectors(p[1], p[0]).cross(new T.Vector3().subVectors(p[2], p[0])).normalize();
    result.push({ p, n, face });
  }
  return result;
}

const body = triangles('body');
const sideSkin = body.filter(t => t.p.every(p => p.y >= .204999 && p.z >= -2.350001 && p.z <= 2.350001
  && Math.abs(Math.abs(p.x) - sideX(p.z, p.y)) < 2e-6));
const degrees = radians => radians * 180 / Math.PI;

test('exported fenders have outward winding, not folded or inverted outer strips', () => {
  assert.ok(sideSkin.length > 6000, 'Inspect the actual broad side surfaces, not a handful of probes');
  for (const triangle of sideSkin) {
    assert.ok(triangle.face.dot(sideNormal(triangle.p[0])) > 0,
      `Inverted exterior triangle at ${triangle.p.map(p => p.toArray()).join('; ')}`);
    for (const axle of [-1.47, 1.47]) {
      const center = triangle.p.reduce((sum, p) => sum.add(p), new T.Vector3()).multiplyScalar(1/3);
      if (Math.abs(center.z - axle) > .425) continue;
      // A polygonal chord is up to 0.24 mm inside the nominal circular arc.
      assert.ok(Math.hypot(center.z - axle, center.y - .390) > .4245,
        `The outer side skin intrudes into the existing open wheel arch at ${center.toArray()}`);
    }
  }
});

test('side-sheet and fender joins share real edges and continuous skin normals', () => {
  const close = (a, b) => a.distanceTo(b) < 2e-6;
  let checked = 0;
  for (const sign of [-1, 1]) for (const z of [-1.94, -1, 1, 1.94]) for (let j = 0; j < 12; j++) {
    const ends = [j, j + 1].map(k => {
      const y = .205 + (interp(z, H) - .205)*k/12;
      return new T.Vector3(sign*sideX(z, y), y, z);
    });
    // The existing Boolean intentionally removes the upper rear seam where
    // the stowed wing goes. Its returns must not be forced into side normals.
    if (z > 1.8 && ends[1].y > .71) continue;
    const matches = [];
    for (const triangle of sideSkin) for (let k = 0; k < 3; k++) {
      const a = triangle.p[k], b = triangle.p[(k + 1)%3];
      if (close(a, ends[0]) && close(b, ends[1])) matches.push(1);
      if (close(a, ends[1]) && close(b, ends[0])) matches.push(-1);
    }
    assert.equal(matches.length, 2, `Both actual sheets must share seam edge ${sign},${z},${j}`);
    assert.equal(matches[0] + matches[1], 0, 'Joined outward surfaces traverse their shared edge in opposite directions');
    checked++;
  }
  assert.ok(checked >= 88);
  for (const triangle of sideSkin) for (let i = 0; i < 3; i++) {
    const p = triangle.p[i];
    if (p.z > 1.8 && p.y > .71) continue;
    assert.ok(degrees(triangle.n[i].angleTo(sideNormal(p))) < .2, 'Analytic side normals remain continuous across sheet boundaries');
  }
});

test('the exact authored arch samples and deliberately angular body stations survive refinement', () => {
  const vertices = sideSkin.flatMap(t => t.p), arcEnd = Math.asin((.205 - .390)/.425);
  for (const sign of [-1, 1]) for (const axle of [-1.47, 1.47]) for (let i = 0; i <= 60; i++) {
    const angle = arcEnd + (Math.PI - 2*arcEnd)*i/60;
    const z = axle - .425*Math.cos(angle), y = .390 + .425*Math.sin(angle);
    const expected = new T.Vector3(sign*sideX(z, y), y, z);
    assert.ok(vertices.some(p => p.distanceTo(expected) < 2e-6), `Unchanged arch sample ${sign},${axle},${i}`);
  }
  for (const triangle of sideSkin) for (const p of triangle.p) {
    assert.ok(Math.abs(p.x) <= interp(p.z, W) + 2e-6, 'No global subdivision or inflated shoulder envelope');
  }
});

function pane(name, u, t) {
  const bow = 1 - t*t;
  let width, y, z;
  if (name === 'windshield') {
    width = .790*(1-u) + .664*u;
    y = (.856 + .005*bow)*(1-u) + (1.193 + .030*bow)*u + .014*Math.sin(Math.PI*u);
    z = -1.200*(1-u) + (-.300 - .055*bow)*u - .014*Math.sin(Math.PI*u);
  } else if (name === 'roof') {
    width = .664*(1-u) + .675*u;
    y = 1.193 + .030*bow + .014*Math.sin(Math.PI*u);
    z = (-.300 - .055*bow)*(1-u) + (.800 + .035*bow)*u;
  } else {
    width = .675*(1-u) + .802*u;
    y = (1.193 + .030*bow)*(1-u) + (.877 + .003*bow)*u + .015*Math.sin(Math.PI*u);
    z = (.800 + .035*bow)*(1-u) + 1.450*u;
  }
  return new T.Vector3(t*width, y, z);
}

test('canopy sheet normals follow the glazing, never its narrow thickness walls', () => {
  const glass = triangles('glass'), key = p => p.toArray().map(v => Math.round(v*1e6)).join(',');
  for (const name of ['windshield', 'roof', 'rear_glass']) {
    const reference = new Map(), e = 1e-5;
    for (let i = 0; i <= 24; i++) for (let j = 0; j <= 40; j++) {
      const u = i/24, t = -1 + 2*j/40;
      const du = pane(name, Math.min(1, u+e), t).sub(pane(name, Math.max(0, u-e), t));
      const dt = pane(name, u, Math.min(1, t+e)).sub(pane(name, u, Math.max(-1, t-e)));
      reference.set(key(pane(name, u, t)), du.cross(dt).normalize());
    }
    let checked = 0, maximum = 0;
    for (const triangle of glass) {
      if (!triangle.p.every(p => reference.has(key(p)))) continue;
      if (triangle.face.dot(reference.get(key(triangle.p[0]))) < 0) continue;
      triangle.n.forEach((normal, i) => { maximum = Math.max(maximum, degrees(normal.angleTo(reference.get(key(triangle.p[i]))))); });
      checked++;
    }
    assert.ok(checked > 1000, `${name}: inspect actual exterior triangles, including sheet edges`);
    assert.ok(maximum < .6, `${name}: worst exported normal deviation ${maximum} degrees`);
  }
});

function hoodAt(x, z) {
  const inner = .662 + (.552-.662)*(z+2.35)/1.15, outer = interp(z,W)-.031, hc = interp(z,HC), h = interp(z,H);
  if (Math.abs(x) <= inner) return hc + .009*(1-(x/inner)**2);
  const q = (Math.abs(x)-inner)/(outer-inner);
  return hc*(1-q) + h*q + .010*Math.sin(Math.PI*q);
}

test('hood and optical-cover edge normals are isolated from manufactured thickness', () => {
  for (const [name, lifts, maximumAllowed, minimumCount] of [['body', [0], 1.6, 2390], ['detail_optical', [.007,.014], 5, 1600]]) {
    let checked = 0, maximum = 0;
    for (const triangle of name === 'body' ? body : triangles(name)) {
      if (!lifts.some(lift => triangle.p.every(p => p.z >= -2.350001 && p.z <= -1.199999 && Math.abs(p.y-hoodAt(p.x,p.z)-lift) < 1e-6))) continue;
      if (triangle.face.y < .2) continue;
      // The central formed hood is intentionally separated by a sharp crease
      // from the very narrow crowned nose/fender bands, not rounded together.
      if (name === 'body' && !triangle.p.every(p => Math.abs(p.x) <= .662 + (.552-.662)*(p.z+2.35)/1.15 + 1e-6)) continue;
      for (const normal of triangle.n) maximum = Math.max(maximum, degrees(normal.angleTo(triangle.face)));
      checked++;
    }
    assert.ok(checked >= minimumCount, `${name}: actual broad exterior skin coverage`);
    assert.ok(maximum < maximumAllowed, `${name}: thickness must not bend edge highlights, observed ${maximum} degrees`);
  }
});
