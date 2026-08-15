import { Readability } from "@mozilla/readability";
// Readability is developed against jsdom. linkedom is lighter but builds a
// different tree, and Readability throws outright on real-world pages when
// driven by it, so the heavier dependency is the correct one here.
import { JSDOM } from "jsdom";
import { AxiError } from "axi-sdk-js";
import { buildEpub, type EpubImage } from "./epub.js";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Tags stripped entirely, content included — they never render on e-ink. */
const DROP_TAGS = [
  "script",
  "style",
  "iframe",
  "noscript",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "canvas",
  "video",
  "audio",
  "embed",
  "object",
  "svg",
];

/** Attributes stripped from every retained element. */
const DROP_ATTR_PREFIXES = ["on", "data-"];
const DROP_ATTRS = new Set(["class", "id", "style", "target", "rel", "role"]);

const EXT_BY_MEDIA_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export interface Article {
  title: string;
  body: string;
  images: EpubImage[];
  sourceUrl: string;
  byline?: string;
  /** Approximate length of the extracted text, for reporting. */
  textLength: number;
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  accept: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: accept },
      signal: controller.signal,
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Download and inline every image the article references.
 *
 * Extensions come from the response's Content-Type rather than being assumed —
 * naming a JPEG `.png` produces a manifest whose media-type contradicts the
 * file name, which strict readers reject. Anything that fails to download is
 * dropped rather than left as a broken reference.
 */
async function inlineImages(
  document: Document,
  baseUrl: string,
): Promise<EpubImage[]> {
  const images: EpubImage[] = [];
  const nodes = [...document.querySelectorAll("img")];

  await Promise.all(
    nodes.map(async (img, index) => {
      const raw =
        img.getAttribute("src") ??
        img.getAttribute("data-src") ??
        img.getAttribute("data-original") ??
        "";

      if (!raw || raw.startsWith("data:")) {
        img.remove();
        return;
      }

      let resolved: string;
      try {
        resolved = new URL(raw, baseUrl).toString();
      } catch {
        img.remove();
        return;
      }

      try {
        const response = await fetchWithTimeout(resolved, 15_000, "image/*");
        if (!response.ok) {
          img.remove();
          return;
        }

        const mediaType = (response.headers.get("content-type") ?? "image/png")
          .split(";")[0]!
          .trim()
          .toLowerCase();
        const ext = EXT_BY_MEDIA_TYPE[mediaType];
        if (!ext) {
          img.remove();
          return;
        }

        const data = new Uint8Array(await response.arrayBuffer());
        // Sub-100-byte responses are tracking pixels, not content.
        if (data.byteLength < 100) {
          img.remove();
          return;
        }

        const name = `image-${index}.${ext}`;
        img.setAttribute("src", name);
        img.removeAttribute("srcset");
        img.removeAttribute("sizes");
        images.push({ name, data, mediaType });
      } catch {
        img.remove();
      }
    }),
  );

  return images;
}

/** Strip scripting, styling and layout attributes from the extracted DOM. */
function sanitize(document: Document): void {
  for (const tag of DROP_TAGS) {
    for (const node of [...document.querySelectorAll(tag)]) node.remove();
  }

  for (const el of [...document.querySelectorAll("*")]) {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (
        DROP_ATTRS.has(name) ||
        DROP_ATTR_PREFIXES.some((prefix) => name.startsWith(prefix))
      ) {
        el.removeAttribute(attr.name);
      }
    }
  }
}

/** Fetch a URL and extract its readable article content. */
export async function extractArticle(
  url: string,
  titleOverride?: string,
): Promise<Article> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new AxiError(`not a valid URL: ${url}`, "USAGE", [
      "Run `remarkable-axi put <url> <dest>` with a full http(s) URL",
    ]);
  }
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new AxiError(
      `unsupported URL scheme: ${parsedUrl.protocol}`,
      "USAGE",
      ["Only http:// and https:// URLs can be fetched"],
    );
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(url, 30_000, "text/html,*/*");
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "AbortError"
        ? "timed out after 30s"
        : error instanceof Error
          ? error.message
          : String(error);
    throw new AxiError(`could not fetch ${url}: ${reason}`, "FETCH_FAILED", [
      "Check the URL is reachable, or pass a different one",
    ]);
  }

  if (!response.ok) {
    throw new AxiError(
      `could not fetch ${url}: HTTP ${response.status}`,
      "FETCH_FAILED",
      response.status === 403 || response.status === 401
        ? [
            "The site blocked the request — many publishers reject non-browser traffic",
            "Save the page as a PDF and use `remarkable-axi put <file> <dest>` instead",
          ]
        : ["Check the URL is correct and publicly reachable"],
    );
  }

  const html = await response.text();
  const finalUrl = response.url || url;

  // Passing `url` lets jsdom resolve relative links and image sources for us.
  const dom = new JSDOM(html, { url: finalUrl });

  // Readability throws on some real-world markup rather than returning null,
  // so a crash here has to surface as a structured error like any other
  // extraction failure — an agent must never receive a raw stack trace.
  let parsed: ReturnType<Readability["parse"]>;
  try {
    parsed = new Readability(dom.window.document, {
      charThreshold: 250,
    }).parse();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AxiError(
      `could not extract an article from ${finalUrl}: ${message}`,
      "NO_CONTENT",
      [
        "The page's markup defeated the article extractor",
        "Save it as a PDF and use `remarkable-axi put <file> <dest>` instead",
      ],
    );
  }

  if (!parsed || !parsed.content) {
    throw new AxiError(
      `no readable article found at ${finalUrl}`,
      "NO_CONTENT",
      [
        "The page may be a listing, paywalled, or rendered entirely client-side",
        "Save it as a PDF and use `remarkable-axi put <file> <dest>` instead",
      ],
    );
  }

  const contentDom = new JSDOM(
    `<!doctype html><html><body>${parsed.content}</body></html>`,
    { url: finalUrl },
  );
  const contentDoc = contentDom.window.document;
  sanitize(contentDoc);
  const images = await inlineImages(contentDoc, finalUrl);

  // EPUB 3 content documents are XHTML, so they must be well-formed XML.
  // `innerHTML` emits HTML void elements unclosed (`<img src="…">`), which is
  // a fatal parse error for a strict reader — XMLSerializer self-closes them.
  const serializer = new contentDom.window.XMLSerializer();
  const body = [...contentDoc.body.childNodes]
    .map((node) => serializer.serializeToString(node))
    .join("");

  const title =
    titleOverride?.trim() ||
    parsed.title?.trim() ||
    parsedUrl.hostname;

  return {
    title,
    body,
    images,
    sourceUrl: finalUrl,
    byline: parsed.byline?.trim() || undefined,
    textLength: parsed.textContent?.trim().length ?? 0,
  };
}

/** Turn a title into a safe reMarkable document name. */
export function documentName(title: string): string {
  const cleaned = [...title]
    // Control characters become spaces rather than vanishing — a newline in a
    // title separates words, so dropping it would weld them together.
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f ? " " : ch;
    })
    .join("")
    .replace(/[/\\]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const name = cleaned.length > 0 ? cleaned : "Untitled";
  return name.length > 100 ? `${name.slice(0, 99).trimEnd()}…` : name;
}

/** Fetch a URL and package it as an EPUB buffer. */
export async function articleToEpub(
  url: string,
  titleOverride?: string,
): Promise<{ name: string; buffer: Uint8Array; article: Article }> {
  const article = await extractArticle(url, titleOverride);
  const buffer = buildEpub({
    title: article.title,
    body: article.body,
    images: article.images,
    author: article.byline ?? "Web Article",
    sourceUrl: article.sourceUrl,
  });
  return { name: documentName(article.title), buffer, article };
}
