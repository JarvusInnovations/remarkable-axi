/**
 * Decode a version-6 `.rm` stroke file straight off the tablet's disk.
 *
 * `device orphans`/`device backup` read `.rm` files by `cat`-ing them over
 * SSH, so there is no cloud hash to hand `rmapi-js`'s own `getRm()` — that
 * method fetches by content hash and parses in one step, with no public
 * "parse these bytes" entry point in between. `rmapi-js` does contain exactly
 * that parser (`parseRmScene` in its `rm6.ts`), but its package `exports` map
 * publishes only the top-level entry, the same wall `src/output.ts` already
 * documents hitting for a type it needed and chose to restate rather than
 * reach around. This module is that restatement for a parser instead of a
 * type: a deliberately partial re-derivation of the wire format (MIT-licensed
 * upstream, `node_modules/rmapi-js/dist/rm6.js`, credited here rather than
 * imported around its boundary), trimmed to exactly the block types
 * `pageGeometry` (`src/strokes.ts`) reads — `sceneLineItem` for strokes,
 * `sceneInfo` for `paperSize`, `rootText` for typed text. Every other block
 * type in a real file (`sceneTree`, `treeNode`, `authorIds`, `pageInfo`, …)
 * is read as an opaque, length-prefixed span and skipped: each block's byte
 * length is self-declared ahead of its body, so a block this module does not
 * decode still leaves the cursor in the right place for the next one.
 *
 * The output shape is exactly what `pageGeometry`'s v6 branch already reads
 * from `rmapi-js`'s own `RmScene` — `{ blocks, paperSize }` — so it needs no
 * adapter and no change to `pageGeometry` itself.
 *
 * Only version 6 is handled. Every current tablet (reMarkable 2, Paper Pro,
 * Paper Pro Move) writes v6; a v3/v5 file (a page never re-touched since a
 * very old firmware) fails with a clear, caught error rather than silently
 * misreading a format this module was never taught.
 */

const HEADER_LENGTH = 43;
const V6_HEADER = "reMarkable .lines file, version=6";

const TAG_BYTE1 = 0x1;
const TAG_BYTE4 = 0x4;
const TAG_BYTE8 = 0x8;
const TAG_LENGTH4 = 0xc;
const TAG_ID = 0xf;

interface CrdtId {
  authorId: number;
  counter: number;
}

/** A cursor over the tagged block stream, tracking block/subblock boundaries. */
class Reader {
  #view: DataView;
  #offset: number;
  #dataEnd: number;
  #bounds: number[] = [];

  constructor(data: Uint8Array, offset: number) {
    this.#view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.#offset = offset;
    this.#dataEnd = data.byteLength;
  }

  get offset(): number {
    return this.#offset;
  }

  get atFileEnd(): boolean {
    return this.#offset >= this.#dataEnd;
  }

  #boundary(): number {
    return this.#bounds.length > 0
      ? this.#bounds[this.#bounds.length - 1]!
      : this.#dataEnd;
  }

  bytesRemaining(): number {
    return this.#boundary() - this.#offset;
  }

  u8(): number {
    const value = this.#view.getUint8(this.#offset);
    this.#offset += 1;
    return value;
  }

  u16(): number {
    const value = this.#view.getUint16(this.#offset, true);
    this.#offset += 2;
    return value;
  }

  u32(): number {
    const value = this.#view.getUint32(this.#offset, true);
    this.#offset += 4;
    return value;
  }

  f32(): number {
    const value = this.#view.getFloat32(this.#offset, true);
    this.#offset += 4;
    return value;
  }

  f64(): number {
    const value = this.#view.getFloat64(this.#offset, true);
    this.#offset += 8;
    return value;
  }

  varuint(): number {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = this.u8();
      result += (byte & 0x7f) * 2 ** shift;
      shift += 7;
    } while (byte & 0x80);
    return result;
  }

  crdtId(): CrdtId {
    return { authorId: this.u8(), counter: this.varuint() };
  }

  bytes(length: number): Uint8Array {
    const start = this.#view.byteOffset + this.#offset;
    const slice = new Uint8Array(this.#view.buffer, start, length);
    this.#offset += length;
    return slice.slice();
  }

  /** Peek the next tag as `[index, type]` without consuming it. */
  peekTag(): [number, number] | undefined {
    if (this.#offset >= this.#boundary()) return undefined;
    const save = this.#offset;
    const raw = this.varuint();
    this.#offset = save;
    return [Math.floor(raw / 16), raw % 16];
  }

  hasTag(index: number, type: number): boolean {
    const tag = this.peekTag();
    return tag !== undefined && tag[0] === index && tag[1] === type;
  }

  #expectTag(index: number, type: number): void {
    const raw = this.varuint();
    if (Math.floor(raw / 16) !== index || raw % 16 !== type) {
      throw new Error(`unexpected v6 tag ${raw} (wanted ${index}/${type})`);
    }
  }

  readInt(index: number): number {
    this.#expectTag(index, TAG_BYTE4);
    return this.u32();
  }

  readFloat(index: number): number {
    this.#expectTag(index, TAG_BYTE4);
    return this.f32();
  }

  readDouble(index: number): number {
    this.#expectTag(index, TAG_BYTE8);
    return this.f64();
  }

  readId(index: number): CrdtId {
    this.#expectTag(index, TAG_ID);
    return this.crdtId();
  }

  readBool(index: number): boolean {
    this.#expectTag(index, TAG_BYTE1);
    return this.u8() !== 0;
  }

  /** Enter a Length4 subblock, run `fn`, then seek to the subblock end. */
  subblock<T>(index: number, fn: () => T): T {
    this.#expectTag(index, TAG_LENGTH4);
    const length = this.u32();
    const subEnd = this.#offset + length;
    this.#bounds.push(subEnd);
    try {
      const value = fn();
      if (this.#offset !== subEnd) {
        throw new Error(`subblock ${index} left ${subEnd - this.#offset} bytes unread`);
      }
      return value;
    } finally {
      this.#bounds.pop();
      this.#offset = subEnd;
    }
  }

  seek(offset: number): void {
    this.#offset = offset;
  }

  /** Run `fn` bounded by `end`; the cursor always lands on `end` after. */
  bounded<T>(end: number, fn: () => T): T {
    this.#bounds.push(end);
    try {
      const value = fn();
      if (this.#offset > end) {
        throw new Error("block body overran its declared length");
      }
      return value;
    } finally {
      this.#bounds.pop();
      this.#offset = end;
    }
  }

  readLww<T>(index: number, readValue: () => T): { timestamp: CrdtId; value: T } {
    return this.subblock(index, () => {
      const timestamp = this.readId(1);
      const value = readValue();
      return { timestamp, value };
    });
  }

  /** A Length4 string-with-format: a string, or an int format code. */
  readStringWithFormat(index: number): string | number {
    return this.subblock(index, () => {
      const length = this.varuint();
      this.u8(); // is-ascii flag
      const text = new TextDecoder().decode(this.bytes(length));
      return this.hasTag(2, TAG_BYTE4) ? this.readInt(2) : text;
    });
  }
}

/** One point of a stroke — the exact shape `strokes.ts`'s `toStroke` reads. */
interface V6Point {
  x: number;
  y: number;
  width: number;
  speed?: number;
  direction?: number;
  pressure?: number;
}

interface V6Line {
  tool: number;
  color: number;
  thicknessScale: number;
  points: V6Point[];
  colorRgba?: number;
}

function readItemEnvelope<T>(
  reader: Reader,
  readValue: (itemType: number) => T | undefined,
): { item: { value: T | undefined } } {
  reader.readId(1); // parentId
  reader.readId(2); // itemId
  reader.readId(3); // leftId
  reader.readId(4); // rightId
  reader.readInt(5); // deletedLength
  let value: T | undefined;
  if (reader.hasTag(6, TAG_LENGTH4)) {
    value = reader.subblock(6, () => {
      const itemType = reader.u8();
      return readValue(itemType);
    });
  }
  return { item: { value } };
}

function readLineValue(reader: Reader, version: number): V6Line {
  const tool = reader.readInt(1);
  const color = reader.readInt(2);
  const thicknessScale = reader.readDouble(3);
  reader.readFloat(4); // startingLength — unused downstream
  const points = reader.subblock(5, () => {
    const pointSize = version === 1 ? 24 : 14;
    const total = reader.bytesRemaining();
    const count = Math.floor(total / pointSize);
    const list: V6Point[] = new Array(count);
    for (let index = 0; index < count; index++) {
      const x = reader.f32();
      const y = reader.f32();
      if (version === 1) {
        list[index] = {
          x,
          y,
          speed: reader.f32() * 4,
          direction: (reader.f32() * 255) / (2 * Math.PI),
          width: reader.f32() * 4,
          pressure: reader.f32() * 255,
        };
      } else {
        const speed = reader.u16();
        const width = reader.u16();
        const direction = reader.u8();
        const pressure = reader.u8();
        list[index] = { x, y, speed, width, direction, pressure };
      }
    }
    return list;
  });

  const line: V6Line = { tool, color, thicknessScale, points };
  if (reader.hasTag(6, TAG_ID)) reader.readId(6); // timestampId — unused
  if (reader.hasTag(7, TAG_ID)) reader.readId(7); // moveId — unused
  if (reader.hasTag(8, TAG_BYTE4)) line.colorRgba = reader.readInt(8);
  return line;
}

interface V6TextItem {
  value: string | number;
}

function readText(reader: Reader): { items: V6TextItem[] } {
  const items: V6TextItem[] = [];
  reader.subblock(2, () => {
    reader.subblock(1, () => {
      reader.subblock(1, () => {
        const count = reader.varuint();
        for (let index = 0; index < count; index++) {
          items.push(
            reader.subblock(0, () => {
              reader.readId(2); // itemId
              reader.readId(3); // leftId
              reader.readId(4); // rightId
              reader.readInt(5); // deletedLength
              const value = reader.hasTag(6, TAG_LENGTH4)
                ? reader.readStringWithFormat(6)
                : "";
              return { value };
            }),
          );
        }
      });
    });
    // The character-style subblock (tag 2) is skipped entirely: pageGeometry
    // never reads per-character styling, only the joined text.
    reader.subblock(2, () => {
      reader.subblock(1, () => {
        const count = reader.varuint();
        for (let index = 0; index < count; index++) {
          reader.crdtId(); // charId
          reader.readId(1); // timestamp
          reader.subblock(2, () => {
            reader.u8(); // constant 17
            reader.u8(); // style
          });
        }
      });
    });
  });
  reader.subblock(3, () => {
    reader.f64();
    reader.f64();
  }); // posX, posY — unused
  reader.readFloat(4); // width — unused
  return { items };
}

/** One decoded block, in the shape `pageGeometry` (`src/strokes.ts`) reads. */
type V6Block =
  | { type: "sceneLineItem"; item: { value: V6Line | undefined } }
  | { type: "sceneInfo"; paperSize?: [number, number] }
  | { type: "rootText"; text: { items: V6TextItem[] } }
  | { type: "unknown" };

/** Read one block's body — bounds are already set to the block's own end. */
function readBlockBody(reader: Reader, blockType: number, version: number): V6Block {
  switch (blockType) {
    case 0x05: // sceneLineItem
      return {
        type: "sceneLineItem",
        ...readItemEnvelope(reader, (itemType) =>
          itemType === 0x03 ? readLineValue(reader, version) : undefined,
        ),
      };
    case 0x07: { // rootText
      reader.readId(1); // blockId
      return { type: "rootText", text: readText(reader) };
    }
    case 0x0d: { // sceneInfo — only field pageGeometry reads is paperSize
      reader.readLww(1, () => reader.readId(2)); // currentLayer
      if (reader.hasTag(2, TAG_LENGTH4)) reader.readLww(2, () => reader.readBool(2));
      if (reader.hasTag(3, TAG_LENGTH4)) reader.readLww(3, () => reader.readBool(2));
      const info: V6Block = { type: "sceneInfo" };
      if (reader.hasTag(5, TAG_LENGTH4)) {
        info.paperSize = reader.subblock(5, () => [reader.u32(), reader.u32()] as [number, number]);
      }
      return info;
    }
    default:
      // Any other block type (sceneTree, treeNode, authorIds, pageInfo, …) is
      // deliberately not decoded here — `parseV6Blocks` below catches this
      // throw and keeps the block's raw bytes, using its self-declared length
      // to stay correctly positioned for the next one.
      throw new Error(`v6 block type 0x${blockType.toString(16)} not decoded`);
  }
}

/** Parse the raw block list of a version-6 `.rm` file. */
function parseV6Blocks(data: Uint8Array): V6Block[] {
  const header = new TextDecoder().decode(data.subarray(0, HEADER_LENGTH));
  if (!header.startsWith(V6_HEADER)) {
    throw new Error(`not a version 6 .lines file: ${JSON.stringify(header)}`);
  }

  const reader = new Reader(data, HEADER_LENGTH);
  const blocks: V6Block[] = [];

  while (!reader.atFileEnd) {
    if (reader.bytesRemaining() < 8) break;
    const length = reader.u32();
    reader.u8(); // reserved
    reader.u8(); // minVersion
    const currentVersion = reader.u8();
    const blockType = reader.u8();
    const blockStart = reader.offset;

    if (length > reader.bytesRemaining()) {
      // The block overruns the file; nothing more to read reliably.
      break;
    }

    const blockEnd = blockStart + length;
    let block: V6Block;
    try {
      block = reader.bounded(blockEnd, () => readBlockBody(reader, blockType, currentVersion));
    } catch {
      // Couldn't (or chose not to) decode this block — keep the stream
      // positioned correctly and move on; nothing pageGeometry reads was in
      // an undecoded block type.
      block = { type: "unknown" };
    }
    reader.seek(blockEnd);
    blocks.push(block);
  }

  return blocks;
}

/** A decoded page, shaped exactly as `pageGeometry`'s v6 branch expects. */
export interface DeviceRmPage {
  blocks: V6Block[];
  paperSize: [number, number] | null;
}

/**
 * Parse raw `.rm` bytes fetched off the tablet's disk into the same shape
 * `pageGeometry` already reads from a cloud-fetched `RmScene` — one parser,
 * both directions.
 *
 * Only v6 is supported (see this module's doc comment); a v3/v5 header
 * throws a clear error rather than misreading the file.
 */
export function parseDeviceRm(data: Uint8Array): DeviceRmPage {
  if (data.length < HEADER_LENGTH) {
    throw new Error("data is too short to be a reMarkable .lines file");
  }
  const header = new TextDecoder().decode(data.subarray(0, HEADER_LENGTH));
  if (!header.startsWith("reMarkable .lines file, version=6")) {
    const versionMatch = /version=(\d+)/.exec(header);
    throw new Error(
      versionMatch
        ? `unsupported .lines version '${versionMatch[1]}' — only v6 is decoded`
        : `unrecognized .lines header: ${JSON.stringify(header)}`,
    );
  }

  const blocks = parseV6Blocks(data);
  const sceneInfo = blocks.find(
    (b): b is Extract<V6Block, { type: "sceneInfo" }> => b.type === "sceneInfo" && !!b.paperSize,
  );
  return { blocks, paperSize: sceneInfo?.paperSize ?? null };
}
