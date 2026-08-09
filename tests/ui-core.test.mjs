import test from "node:test";
import assert from "node:assert/strict";

await import("../content/shadow-ui.js");

const {
  TRIGGER_HOST_STYLES,
  POPOVER_HOST_STYLES,
  applyImportantStyles,
  adoptShadowStyles,
  eventOccursWithin,
  getDeepActiveElement
} = globalThis.ProEffortShadowUi;

test("keeps critical light-DOM host geometry explicit", () => {
  const triggerStyles = Object.fromEntries(
    TRIGGER_HOST_STYLES
  );
  const popoverStyles = Object.fromEntries(
    POPOVER_HOST_STYLES
  );

  assert.deepEqual(
    {
      all: triggerStyles.all,
      display: triggerStyles.display,
      flex: triggerStyles.flex
    },
    {
      all: "initial",
      display: "inline-flex",
      flex: "0 0 auto"
    }
  );
  assert.deepEqual(
    {
      all: popoverStyles.all,
      position: popoverStyles.position,
      zIndex: popoverStyles["z-index"],
      pointerEvents:
        popoverStyles["pointer-events"],
      width: popoverStyles.width,
      height: popoverStyles.height
    },
    {
      all: "initial",
      position: "fixed",
      zIndex: "2147483600",
      pointerEvents: "none",
      width: "0",
      height: "0"
    }
  );
});

test("applies every host reset as an inline important declaration", () => {
  const calls = [];
  const element = {
    style: {
      setProperty(...args) {
        calls.push(args);
      }
    }
  };

  applyImportantStyles(element, [
    ["all", "initial"],
    ["display", "inline-flex"]
  ]);

  assert.deepEqual(calls, [
    ["all", "initial", "important"],
    [
      "display",
      "inline-flex",
      "important"
    ]
  ]);
});

test("adopts a synchronously populated constructable stylesheet", () => {
  const originalCSSStyleSheet =
    globalThis.CSSStyleSheet;
  const replacements = [];

  class TestStyleSheet {
    replaceSync(cssText) {
      replacements.push(cssText);
    }
  }

  globalThis.CSSStyleSheet =
    TestStyleSheet;

  try {
    const shadowRoot = {
      adoptedStyleSheets: []
    };

    adoptShadowStyles(
      shadowRoot,
      ".control { height: 36px; }"
    );

    assert.deepEqual(replacements, [
      ".control { height: 36px; }"
    ]);
    assert.equal(
      shadowRoot.adoptedStyleSheets.length,
      1
    );
    assert.ok(
      shadowRoot.adoptedStyleSheets[0]
        instanceof TestStyleSheet
    );
  } finally {
    if (
      originalCSSStyleSheet === undefined
    ) {
      delete globalThis.CSSStyleSheet;
    } else {
      globalThis.CSSStyleSheet =
        originalCSSStyleSheet;
    }
  }
});

test("recognizes a retargeted trigger event from its composed path", () => {
  const triggerHost = {};
  const trigger = {};
  const event = {
    target: triggerHost,
    composedPath() {
      return [trigger, triggerHost];
    }
  };

  assert.equal(
    eventOccursWithin(event, [
      triggerHost,
      trigger
    ]),
    true
  );
});

test("recognizes a retargeted popover event from its composed path", () => {
  const popoverHost = {};
  const option = {};
  const event = {
    target: popoverHost,
    composedPath() {
      return [option, popoverHost];
    }
  };

  assert.equal(
    eventOccursWithin(event, [
      popoverHost,
      option
    ]),
    true
  );
});

test("rejects an outside event", () => {
  const outside = {};

  assert.equal(
    eventOccursWithin(
      {
        target: outside,
        composedPath() {
          return [outside];
        }
      },
      [{}, {}]
    ),
    false
  );
});

test("falls back to light-DOM containment when composedPath is unavailable", () => {
  const target = {};
  const surface = {
    contains(candidate) {
      return candidate === target;
    }
  };

  assert.equal(
    eventOccursWithin(
      { target },
      [surface]
    ),
    true
  );
});

test("resolves the deepest active element through open shadow roots", () => {
  const extendedOption = {};
  const popoverHost = {
    shadowRoot: {
      activeElement: extendedOption
    }
  };
  const documentLike = {
    activeElement: popoverHost
  };

  assert.equal(
    getDeepActiveElement(documentLike),
    extendedOption
  );
});

test("returns a focused host when its shadow root has no active descendant", () => {
  const triggerHost = {
    shadowRoot: {
      activeElement: null
    }
  };

  assert.equal(
    getDeepActiveElement({
      activeElement: triggerHost
    }),
    triggerHost
  );
});

test("terminates safely if malformed active-element links form a cycle", () => {
  const first = {};
  const second = {};
  first.shadowRoot = {
    activeElement: second
  };
  second.shadowRoot = {
    activeElement: first
  };

  assert.equal(
    getDeepActiveElement({
      activeElement: first
    }),
    first
  );
});
