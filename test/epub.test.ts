import { describe, expect, test } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { XMLValidator } from "fast-xml-parser";
import { buildEpub, escapeXml } from "../src/epub.js";
import { documentName } from "../src/article.js";

const MINIMAL = {
  title: "Test Article",
  body: "<p>Hello world.</p>",
  images: [],
};

describe("escapeXml", () => {
  test("escapes the five XML metacharacters", () => {
    expect(escapeXml(`<a href="x">&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;",
    );
  });
});

describe("buildEpub", () => {
  test("mimetype is the first entry and stored uncompressed", () => {
    // A reader that sniffs the archive header rejects the file otherwise.
    const raw = Buffer.from(buildEpub(MINIMAL));
    expect(raw.subarray(30, 38).toString("ascii")).toBe("mimetype");
    expect(raw.readUInt16LE(8)).toBe(0); // 0 = STORED
  });

  test("mimetype content is exact", () => {
    const files = unzipSync(buildEpub(MINIMAL));
    expect(strFromU8(files["mimetype"]!)).toBe("application/epub+zip");
  });

  test("contains the required EPUB 3 structure", () => {
    const names = Object.keys(unzipSync(buildEpub(MINIMAL)));
    expect(names).toEqual(
      expect.arrayContaining([
        "mimetype",
        "META-INF/container.xml",
        "OEBPS/content.opf",
        "OEBPS/nav.xhtml",
        "OEBPS/article.xhtml",
        "OEBPS/style.css",
      ]),
    );
  });

  test("every generated XML document is well-formed", () => {
    const files = unzipSync(buildEpub(MINIMAL));
    for (const name of [
      "META-INF/container.xml",
      "OEBPS/content.opf",
      "OEBPS/nav.xhtml",
      "OEBPS/article.xhtml",
    ]) {
      expect(XMLValidator.validate(strFromU8(files[name]!))).toBe(true);
    }
  });

  test("a title containing XML metacharacters stays well-formed", () => {
    // An unescaped title would produce an unparseable content.opf.
    const files = unzipSync(
      buildEpub({ ...MINIMAL, title: `Bells & Whistles <"quoted">` }),
    );
    for (const name of ["OEBPS/content.opf", "OEBPS/nav.xhtml", "OEBPS/article.xhtml"]) {
      expect(XMLValidator.validate(strFromU8(files[name]!))).toBe(true);
    }
    expect(strFromU8(files["OEBPS/content.opf"]!)).toContain(
      "Bells &amp; Whistles",
    );
  });

  test("images are written and manifested consistently", () => {
    const epub = buildEpub({
      ...MINIMAL,
      body: '<p><img src="image-0.jpg"/></p>',
      images: [
        {
          name: "image-0.jpg",
          data: new Uint8Array([1, 2, 3, 4]),
          mediaType: "image/jpeg",
        },
      ],
    });
    const files = unzipSync(epub);
    expect(files["OEBPS/image-0.jpg"]).toEqual(new Uint8Array([1, 2, 3, 4]));

    const opf = strFromU8(files["OEBPS/content.opf"]!);
    expect(opf).toContain('href="image-0.jpg"');
    expect(opf).toContain('media-type="image/jpeg"');
    expect(XMLValidator.validate(opf)).toBe(true);
  });

  test("the source URL is recorded when supplied", () => {
    const files = unzipSync(
      buildEpub({ ...MINIMAL, sourceUrl: "https://example.com/a?b=1&c=2" }),
    );
    const opf = strFromU8(files["OEBPS/content.opf"]!);
    expect(opf).toContain("https://example.com/a?b=1&amp;c=2");
    expect(XMLValidator.validate(opf)).toBe(true);
  });
});

describe("documentName", () => {
  test("preserves spaces and hyphens", () => {
    expect(documentName("A Well-Titled Post")).toBe("A Well-Titled Post");
  });

  test("converts control characters to spaces", () => {
    expect(documentName("Clean\u0007Title")).toBe("Clean Title");
    expect(documentName("Tab\tSeparated")).toBe("Tab Separated");
    expect(documentName("Line\nBreak")).toBe("Line Break");
  });

  test("replaces path separators", () => {
    expect(documentName("a/b\\c")).toBe("a-b-c");
  });

  test("collapses whitespace runs", () => {
    expect(documentName("too    many\n\nspaces")).toBe("too many spaces");
  });

  test("falls back when nothing survives", () => {
    expect(documentName("   ")).toBe("Untitled");
  });

  test("truncates very long titles", () => {
    const name = documentName("x".repeat(200));
    expect(name.length).toBeLessThanOrEqual(100);
  });
});
