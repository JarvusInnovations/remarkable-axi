/**
 * Hand-encoded v6 `.rm` byte fixtures, shared across `test/rm6.test.ts` and
 * `test/commands/device.test.ts`.
 *
 * Both were built against the wire format `src/rm6.ts` decodes, then
 * cross-validated by feeding them to `rmapi-js`'s own `parseRm` (reached only
 * from a throwaway, uncommitted scratch script — never from anything
 * shipped) to confirm they decode to exactly the strokes and `paperSize`
 * intended: `WITH_STROKE_HEX` is a `sceneInfo` block (paperSize 1620x2160)
 * followed by one two-point `sceneLineItem`; `ZERO_STROKE_HEX` is the same
 * file with the stroke block omitted, matching a page that was opened but
 * never drawn on.
 */
export const WITH_STROKE_HEX =
  "72654d61726b61626c65202e6c696e65732066696c652c2076657273696f6e3d3620202020202020202020180000000000020d1c060000001f00002f00005c08000000540600007008000050000000000002051f00012f01053f00004f000054000000006c3a000000031415000000240000000038000000000000f03f44000000005c1c00000000000000000000000000040000800000204100002041000004000080";
export const ZERO_STROKE_HEX =
  "72654d61726b61626c65202e6c696e65732066696c652c2076657273696f6e3d3620202020202020202020180000000000020d1c060000001f00002f00005c080000005406000070080000";

export function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}
