/**
 * `Uint8Array.prototype.toHex` / `Uint8Array.fromHex` for runtimes without them.
 *
 * rmapi-js uses both when computing content hashes, so every *write* path
 * depends on them — `digest()` for SHA-256 output and `fromHex` when combining
 * child hashes. Reads parse hashes as text and never touch either, which is why
 * listing works on older Node and uploading fails.
 *
 * They are very new: absent in Node 22, 24.13 and 24.15, present in 26 and in
 * bun. Without this shim an upload throws deep inside the hashing code, gets
 * retried with backoff, and only fails after minutes — so this is imported
 * before anything else rather than left to the runtime.
 *
 * Behavior follows the Uint8Array-to/from-hex proposal: lowercase output, and
 * an input that is not an even-length run of hex digits is rejected.
 */

interface HexCapableUint8Array {
  toHex?: () => string;
  toBase64?: () => string;
}

interface HexCapableUint8ArrayConstructor {
  fromHex?: (input: string) => Uint8Array;
  fromBase64?: (input: string) => Uint8Array;
}

const proto = Uint8Array.prototype as unknown as HexCapableUint8Array;
const ctor = Uint8Array as unknown as HexCapableUint8ArrayConstructor;

if (typeof proto.toHex !== "function") {
  // Precomputed byte→hex pairs: this runs once per uploaded chunk, and the
  // table is meaningfully faster than padStart per byte.
  const HEX_BY_BYTE: string[] = [];
  for (let i = 0; i < 256; i++) {
    HEX_BY_BYTE.push(i.toString(16).padStart(2, "0"));
  }

  Object.defineProperty(Uint8Array.prototype, "toHex", {
    value: function toHex(this: Uint8Array): string {
      let out = "";
      for (let i = 0; i < this.length; i++) {
        out += HEX_BY_BYTE[this[i]!];
      }
      return out;
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

if (typeof ctor.fromHex !== "function") {
  Object.defineProperty(Uint8Array, "fromHex", {
    value: function fromHex(input: string): Uint8Array {
      if (typeof input !== "string") {
        throw new TypeError("fromHex expects a string");
      }
      if (input.length % 2 !== 0) {
        throw new SyntaxError("fromHex expects an even number of characters");
      }

      const out = new Uint8Array(input.length / 2);
      for (let i = 0; i < out.length; i++) {
        const byte = Number.parseInt(input.slice(i * 2, i * 2 + 2), 16);
        // parseInt is lenient about trailing garbage, so validate the pair.
        if (!/^[0-9a-fA-F]{2}$/.test(input.slice(i * 2, i * 2 + 2))) {
          throw new SyntaxError("fromHex expects only hex digits");
        }
        out[i] = byte;
      }
      return out;
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

if (typeof proto.toBase64 !== "function") {
  Object.defineProperty(Uint8Array.prototype, "toBase64", {
    value: function toBase64(this: Uint8Array): string {
      // Node's Buffer is the fastest correct encoder available here, and this
      // shim only ever runs on Node.
      return Buffer.from(this.buffer, this.byteOffset, this.byteLength).toString(
        "base64",
      );
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

if (typeof ctor.fromBase64 !== "function") {
  Object.defineProperty(Uint8Array, "fromBase64", {
    value: function fromBase64(input: string): Uint8Array {
      if (typeof input !== "string") {
        throw new TypeError("fromBase64 expects a string");
      }
      // Buffer.from is lenient about invalid base64, so reject anything that
      // does not round-trip rather than silently producing wrong bytes.
      const buf = Buffer.from(input, "base64");
      if (buf.toString("base64").replace(/=+$/, "") !== input.replace(/=+$/, "")) {
        throw new SyntaxError("fromBase64 expects valid base64");
      }
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    },
    writable: true,
    configurable: true,
    enumerable: false,
  });
}
