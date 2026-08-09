(() => {
  "use strict";

  const TRIGGER_SHADOW_STYLES = String.raw`
    :host {
      --pe-font-family: var(
        --pe-native-font-family,
        ui-sans-serif,
        system-ui,
        sans-serif
      );
      --pe-foreground: var(
        --pe-native-foreground,
        CanvasText
      );
      direction: var(
        --pe-native-direction,
        ltr
      );
      color-scheme: var(
        --pe-native-color-scheme,
        normal
      );
    }

    :host::before,
    :host::after {
      content: none !important;
      display: none !important;
    }

    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

    .pe-trigger {
      all: initial;
      box-sizing: border-box;
      appearance: none;
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      min-width: 0;
      max-width: 100%;
      height: 36px;
      padding: 6px 10px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--pe-foreground);
      font-family: var(--pe-font-family);
      font-size: 16px;
      font-weight: 400;
      line-height: 20px;
      cursor: pointer;
      direction: var(
        --pe-native-direction,
        ltr
      );
      color-scheme: var(
        --pe-native-color-scheme,
        normal
      );
      white-space: nowrap;
      transition:
        background-color 120ms ease,
        color 120ms ease;
    }

    .pe-trigger:hover {
      background: color-mix(
        in srgb,
        var(--pe-foreground) 10%,
        transparent
      );
    }

    .pe-trigger:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 2px;
    }

    .pe-trigger-label {
      display: block;
      flex: 0 0 auto;
      min-width: 0;
      overflow: visible;
      text-overflow: clip;
      white-space: nowrap;
    }

    .pe-trigger-chevron {
      position: static;
      display: block;
      flex: 0 0 auto;
      width: 10px;
      height: 10px;
      margin-inline-start: 7px;
      overflow: visible;
      color: currentColor;
      opacity: 0.68;
      pointer-events: none;
    }

    .pe-live-region {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip: rect(0 0 0 0);
      clip-path: inset(50%);
      white-space: nowrap;
      border: 0;
    }

    @media (max-width: 480px) {
      .pe-trigger {
        padding-inline: 7px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .pe-trigger {
        transition: none;
      }
    }
  `;

  const POPOVER_SHADOW_STYLES = String.raw`
    :host {
      --pe-font-family: var(
        --pe-native-font-family,
        ui-sans-serif,
        system-ui,
        sans-serif
      );
      --pe-foreground: var(
        --pe-native-foreground,
        CanvasText
      );
      --pe-surface: var(
        --pe-native-surface,
        Canvas
      );
      --pe-hover: color-mix(
        in srgb,
        var(--pe-foreground) 7%,
        transparent
      );
      direction: var(
        --pe-native-direction,
        ltr
      );
      color-scheme: var(
        --pe-native-color-scheme,
        normal
      );
    }

    :host::before,
    :host::after {
      content: none !important;
      display: none !important;
    }

    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

    .pe-popover {
      all: initial;
      box-sizing: border-box;
      position: fixed;
      z-index: 1;
      display: block;
      width: min(152px, calc(100vw - 24px));
      max-height: calc(100dvh - 24px);
      padding: 6px;
      overflow-x: hidden;
      overflow-y: auto;
      overscroll-behavior: contain;
      border: 0;
      border-radius: 16px;
      background: var(--pe-surface);
      color: var(--pe-foreground);
      box-shadow:
        0 8px 12px rgb(0 0 0 / 8%),
        0 0 0 1px
          color-mix(
            in srgb,
            var(--pe-foreground) 8%,
            transparent
          );
      font-family: var(--pe-font-family);
      font-size: 14px;
      font-weight: 400;
      line-height: 20px;
      direction: var(
        --pe-native-direction,
        ltr
      );
      color-scheme: var(
        --pe-native-color-scheme,
        normal
      );
      pointer-events: auto;
      isolation: isolate;
    }

    .pe-options {
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    .pe-option {
      all: initial;
      box-sizing: border-box;
      appearance: none;
      display: grid;
      grid-template-columns:
        minmax(0, 1fr)
        16px;
      grid-template-rows: 1fr;
      column-gap: 8px;
      align-items: center;
      min-width: 0;
      width: 100%;
      height: 36px;
      padding: 6px 10px;
      border: 0;
      border-radius: 10px;
      background: transparent;
      color: var(--pe-foreground);
      font-family: var(--pe-font-family);
      font-size: 14px;
      font-weight: 400;
      line-height: 20px;
      text-align: start;
      cursor: pointer;
    }

    .pe-option:hover:not(
        [aria-disabled="true"]
      ) {
      background: var(--pe-hover);
    }

    .pe-option:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 2px;
    }

    .pe-option[aria-disabled="true"] {
      cursor: not-allowed;
      opacity: 0.55;
    }

    .pe-option-title {
      display: block;
      grid-column: 1;
      grid-row: 1;
      min-width: 0;
      overflow: hidden;
      font-size: 14px;
      font-weight: 400;
      line-height: 20px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .pe-option-check {
      display: flex;
      grid-column: 2;
      grid-row: 1;
      align-items: center;
      align-self: center;
      justify-content: flex-end;
      width: 16px;
      height: 20px;
      opacity: 0;
      font-size: 14px;
      font-weight: 400;
      line-height: 20px;
    }

    .pe-option[aria-checked="true"]
      .pe-option-check {
      opacity: 1;
    }

    @media (max-width: 480px) {
      .pe-popover {
        width: min(
          152px,
          calc(100vw - 16px)
        );
      }
    }
  `;

  const TRIGGER_HOST_STYLES = Object.freeze([
    ["all", "initial"],
    ["display", "inline-flex"],
    ["flex", "0 0 auto"],
    ["align-items", "center"],
    ["align-self", "center"],
    ["min-width", "0"],
    ["max-width", "100%"],
    ["width", "auto"],
    ["height", "auto"],
    ["margin", "0"],
    ["margin-inline-start", "2px"],
    ["padding", "0"],
    ["border", "0"],
    ["background", "transparent"],
    ["overflow", "visible"],
    ["position", "relative"],
    ["vertical-align", "middle"],
    ["line-height", "1"],
    ["box-sizing", "border-box"],
    ["isolation", "isolate"]
  ]);

  const POPOVER_HOST_STYLES = Object.freeze([
    ["all", "initial"],
    ["position", "fixed"],
    ["inset", "0 auto auto 0"],
    ["z-index", "2147483600"],
    ["display", "block"],
    ["width", "0"],
    ["height", "0"],
    ["margin", "0"],
    ["padding", "0"],
    ["border", "0"],
    ["background", "transparent"],
    ["overflow", "visible"],
    ["pointer-events", "none"],
    ["box-sizing", "border-box"],
    ["isolation", "isolate"]
  ]);

  function applyImportantStyles(
    element,
    declarations
  ) {
    if (!element?.style) {
      return;
    }

    for (const [property, value] of declarations) {
      element.style.setProperty(
        property,
        value,
        "important"
      );
    }
  }

  function adoptShadowStyles(
    shadowRoot,
    cssText
  ) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
    shadowRoot.adoptedStyleSheets = [sheet];
  }

  function eventOccursWithin(
    event,
    surfaces
  ) {
    const candidates = Array.from(
      surfaces ?? []
    ).filter(Boolean);
    const path =
      typeof event?.composedPath ===
      "function"
        ? event.composedPath()
        : null;

    if (Array.isArray(path)) {
      return candidates.some((candidate) =>
        path.includes(candidate)
      );
    }

    const target = event?.target;

    return candidates.some((candidate) =>
      candidate === target ||
      (
        target &&
        typeof candidate?.contains ===
          "function" &&
        candidate.contains(target)
      )
    );
  }

  function getDeepActiveElement(rootNode) {
    let activeElement =
      rootNode?.activeElement ?? null;
    const visited = new Set();

    while (
      activeElement &&
      !visited.has(activeElement)
    ) {
      visited.add(activeElement);

      const nestedActiveElement =
        activeElement.shadowRoot
          ?.activeElement ?? null;

      if (!nestedActiveElement) {
        break;
      }

      activeElement = nestedActiveElement;
    }

    return activeElement;
  }

  globalThis.ProEffortShadowUi =
    Object.freeze({
      TRIGGER_SHADOW_STYLES,
      POPOVER_SHADOW_STYLES,
      TRIGGER_HOST_STYLES,
      POPOVER_HOST_STYLES,
      applyImportantStyles,
      adoptShadowStyles,
      eventOccursWithin,
      getDeepActiveElement
    });
})();
