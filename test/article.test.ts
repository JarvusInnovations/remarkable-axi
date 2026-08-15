import { describe, expect, test } from "vitest";
import { pickImageCandidate } from "../src/article.js";
import { widestPanelWidth } from "../src/devices.js";

const RM2_PANEL = 1404;

describe("pickImageCandidate", () => {
  test("takes the smallest rendition that still covers the panel", () => {
    const chosen = pickImageCandidate(
      [
        { url: "small.jpg", width: 480, density: 1 },
        { url: "medium.jpg", width: 1600, density: 1 },
        { url: "huge.jpg", width: 3200, density: 1 },
      ],
      RM2_PANEL,
    );

    // 1600 covers 1404; 3200 is bytes the device would discard.
    expect(chosen?.url).toBe("medium.jpg");
  });

  test("takes the largest offered when nothing reaches the panel", () => {
    // The realistic case on sites that never publish a panel-sized rendition:
    // the best available still beats the small default.
    const chosen = pickImageCandidate(
      [
        { url: "thumb.jpg", width: 250, density: 1 },
        { url: "double.jpg", width: 500, density: 2 },
      ],
      RM2_PANEL,
    );

    expect(chosen?.url).toBe("double.jpg");
  });

  test("an exact panel-width rendition is preferred over a larger one", () => {
    const chosen = pickImageCandidate(
      [
        { url: "exact.jpg", width: RM2_PANEL, density: 1 },
        { url: "bigger.jpg", width: RM2_PANEL + 1, density: 1 },
      ],
      RM2_PANEL,
    );

    expect(chosen?.url).toBe("exact.jpg");
  });

  test("falls back to the highest density when no width is knowable", () => {
    // Density descriptors with no declared intrinsic width — common on sites
    // that leave sizing to CSS. More pixels is right for a panel denser than
    // a CSS pixel.
    const chosen = pickImageCandidate(
      [
        { url: "1x.jpg", width: null, density: 1 },
        { url: "2x.jpg", width: null, density: 2 },
      ],
      RM2_PANEL,
    );

    expect(chosen?.url).toBe("2x.jpg");
  });

  test("a known width wins over an unknown one, even at higher density", () => {
    const chosen = pickImageCandidate(
      [
        { url: "unknown-3x.jpg", width: null, density: 3 },
        { url: "known.jpg", width: 2000, density: 1 },
      ],
      RM2_PANEL,
    );

    expect(chosen?.url).toBe("known.jpg");
  });

  test("no candidates yields nothing rather than throwing", () => {
    expect(pickImageCandidate([], RM2_PANEL)).toBeNull();
  });
});

describe("panel target", () => {
  test("the fallback covers every known model", () => {
    // An upper bound over hardware that exists, not a guess about which one
    // the user owns — so an image chosen against it is never short of
    // resolution for any reMarkable.
    expect(widestPanelWidth()).toBeGreaterThanOrEqual(1620);
  });
});
