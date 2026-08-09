import { zipSync, strToU8 } from "fflate";

export interface EpubImage {
  /** File name inside the archive, e.g. `image-0.jpg`. */
  name: string;
  data: Uint8Array;
  mediaType: string;
}

export interface EpubInput {
  title: string;
  /** Sanitized XHTML body content, without the wrapping html/body tags. */
  body: string;
  images: EpubImage[];
  author?: string;
  sourceUrl?: string;
}

/** Escape a string for use in XML text or a double-quoted attribute. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const STYLESHEET = `p {
  margin-top: 1em;
  margin-bottom: 1em;
}

ul, ol {
  padding: 1em;
}

ul li, ol li {
  margin-left: 1.5em;
  padding-left: 0.5em;
}

figcaption {
  font-size: 0.8rem;
  font-style: italic;
}

img {
  max-width: 100%;
  height: auto;
}
`;

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

function articleXhtml(title: string, body: string, sourceUrl?: string): string {
  const source = sourceUrl
    ? `\n<p class="source"><a href="${escapeXml(sourceUrl)}">${escapeXml(sourceUrl)}</a></p>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
<head>
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
<h1>${escapeXml(title)}</h1>${source}
${body}
</body>
</html>
`;
}

function navXhtml(title: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en" lang="en">
<head>
<title>${escapeXml(title)}</title>
</head>
<body>
<nav epub:type="toc" id="toc">
<h1>Contents</h1>
<ol>
<li><a href="article.xhtml">${escapeXml(title)}</a></li>
</ol>
</nav>
</body>
</html>
`;
}

function contentOpf(input: EpubInput, uuid: string, modified: string): string {
  const manifestImages = input.images
    .map(
      (img) =>
        `    <item id="${escapeXml(img.name)}" href="${escapeXml(img.name)}" media-type="${escapeXml(img.mediaType)}"/>`,
    )
    .join("\n");

  const source = input.sourceUrl
    ? `\n    <dc:source>${escapeXml(input.sourceUrl)}</dc:source>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookID">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookID">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${escapeXml(input.title)}</dc:title>
    <dc:creator>${escapeXml(input.author ?? "Web Article")}</dc:creator>
    <dc:language>en</dc:language>${source}
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>
    <item id="article" href="article.xhtml" media-type="application/xhtml+xml"/>
    <item id="style" href="style.css" media-type="text/css"/>
${manifestImages}
  </manifest>
  <spine>
    <itemref idref="article"/>
  </spine>
</package>
`;
}

/**
 * Package an extracted article as a minimal EPUB 3.
 *
 * `mimetype` must be the first entry and stored uncompressed — readers that
 * sniff the archive header reject the file otherwise, which is why the
 * per-file level is pinned to 0 for that one entry.
 */
export function buildEpub(input: EpubInput): Uint8Array {
  const uuid = crypto.randomUUID();
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const files: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": [strToU8(CONTAINER_XML), { level: 6 }],
    "OEBPS/content.opf": [
      strToU8(contentOpf(input, uuid, modified)),
      { level: 6 },
    ],
    "OEBPS/nav.xhtml": [strToU8(navXhtml(input.title)), { level: 6 }],
    "OEBPS/article.xhtml": [
      strToU8(articleXhtml(input.title, input.body, input.sourceUrl)),
      { level: 6 },
    ],
    "OEBPS/style.css": [strToU8(STYLESHEET), { level: 6 }],
  };

  for (const img of input.images) {
    files[`OEBPS/${img.name}`] = [img.data, { level: 6 }];
  }

  return zipSync(files);
}
