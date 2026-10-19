import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

/** Accepted pre-PR5 stylesheet, retained only as a historical QA fixture. */
export const HEADER_BASELINE = Object.freeze({
  commit: '28955fa9c838efe8537c88334ca23e09f7cf65aa',
  sha256: '5f3d19a39a416b4252072efb20f48601dc53ce0daca0f87adabfec7fc9f31597',
});

/**
 * Load the pinned pre-header stylesheet even when no environment override is set.
 * Missing or different bytes fail before the browser starts; an override may move
 * this same fixture, not silently replace the reference with the current CSS.
 * @param {string|URL} [file] - Optional location of the exact accepted CSS bytes.
 * @returns {Promise<string>} Verified UTF-8 stylesheet for the before capture.
 */
export async function loadHeaderBaseline(file = new URL('../tests/fixtures/garage-header-baseline.css', import.meta.url)) {
  const bytes = await readFile(file);
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash, HEADER_BASELINE.sha256, 'Header QA requires the pinned pre-PR5 baseline CSS; refusing an unverified reference');
  return bytes.toString('utf8');
}

/**
 * Verify the historical PR5 CSS-only change using two real measured frames.
 * Header/control rectangles and title typography must match exactly; only the
 * approved vertical title lift (20 desktop / 8 short-screen CSS px) may differ.
 * This contract is deliberately not imposed on later authorized layout changes.
 * @param {object} before - Native element rectangles/font before the stylesheet switch.
 * @param {object} after - Same scene, viewport and DOM with the changed stylesheet.
 * @param {number} viewportHeight - Viewport height in CSS pixels, not device pixels.
 * @returns {void} Throws on missing baseline evidence or any forbidden difference.
 */
export function assertHeaderParity(before, after, viewportHeight) {
  assert.ok(before && after, 'Both baseline and updated header measurements are required');
  assert.ok(Number.isFinite(viewportHeight) && viewportHeight > 0, 'A valid viewport height is required');
  for (const key of ['header', 'brand', 'account', 'controls']) {
    assert.ok(before[key] && after[key], 'Missing header measurement: ' + key);
    assert.deepEqual(after[key], before[key], 'Unchanged header layout: ' + key);
  }
  assert.ok(before.title && after.title, 'Both title rectangles are required');
  assert.equal(after.title.y, before.title.y - (viewportHeight <= 500 ? 8 : 20), 'Only the approved title lift is allowed');
  for (const key of ['x', 'width', 'height']) assert.equal(after.title[key], before.title[key], 'Unchanged title geometry: ' + key);
  assert.ok(typeof before.titleFont === 'string' && before.titleFont.length > 0, 'A measured title font is required');
  assert.equal(after.titleFont, before.titleFont, 'Unchanged title typography');
}
