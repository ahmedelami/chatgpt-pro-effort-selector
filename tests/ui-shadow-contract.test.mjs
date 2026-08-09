import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const manifest = JSON.parse(
  await readFile(
    new URL("../manifest.json", import.meta.url),
    "utf8"
  )
);
const packageJson = JSON.parse(
  await readFile(
    new URL("../package.json", import.meta.url),
    "utf8"
  )
);
const contentScript = await readFile(
  new URL(
    "../content/content-script.js",
    import.meta.url
  ),
  "utf8"
);
const serviceWorker = await readFile(
  new URL(
    "../background/service-worker.mjs",
    import.meta.url
  ),
  "utf8"
);
const shadowUi = await readFile(
  new URL(
    "../content/shadow-ui.js",
    import.meta.url
  ),
  "utf8"
);
const lightDomStyles = await readFile(
  new URL(
    "../content/styles.css",
    import.meta.url
  ),
  "utf8"
);

test("loads the shadow UI helper before the content script", () => {
  assert.equal(
    manifest.version,
    packageJson.version
  );
  assert.deepEqual(
    manifest.content_scripts[0].js,
    [
      "core/mode-core.js",
      "content/shadow-ui.js",
      "content/content-script.js"
    ]
  );
  assert.deepEqual(
    manifest.content_scripts[0].css,
    ["content/styles.css"]
  );
});

test("does not request scripting for the removed verifier", () => {
  assert.equal(
    manifest.permissions.includes("scripting"),
    false
  );
  assert.doesNotMatch(
    serviceWorker,
    /chrome\.scripting/
  );
  assert.doesNotMatch(
    contentScript,
    /verifyExtended/
  );
});

test("creates distinct open trigger and popover shadow roots", () => {
  assert.match(
    contentScript,
    /applyImportantStyles\(\s*root,\s*TRIGGER_HOST_STYLES/
  );
  assert.match(
    contentScript,
    /applyImportantStyles\(\s*popoverHost,\s*POPOVER_HOST_STYLES/
  );
  assert.match(
    contentScript,
    /root\.attachShadow\(\{\s*mode: "open"\s*\}\)/
  );
  assert.match(
    contentScript,
    /popoverHost\.attachShadow\(\{\s*mode: "open"\s*\}\)/
  );
  assert.equal(
    (
      contentScript.match(
        /attachShadow\(\{/g
      ) ?? []
    ).length,
    2
  );
  assert.match(
    contentScript,
    /rootShadow\.append\(\s*trigger,/
  );
  assert.match(
    contentScript,
    /popoverShadow\.append\(popover\)/
  );
  assert.match(
    contentScript,
    /document\.body\.append\(popoverHost\)/
  );
});

test("installs synchronous scoped styles without HTML injection", () => {
  assert.match(
    contentScript,
    /adoptShadowStyles\(\s*rootShadow,\s*TRIGGER_SHADOW_STYLES/
  );
  assert.match(
    contentScript,
    /adoptShadowStyles\(\s*popoverShadow,\s*POPOVER_SHADOW_STYLES/
  );
  assert.match(
    shadowUi,
    /new CSSStyleSheet\(\)/
  );
  assert.match(shadowUi, /replaceSync\(cssText\)/);
  assert.doesNotMatch(
    contentScript,
    /innerHTML|outerHTML|insertAdjacentHTML/
  );
});

test("keeps selector visuals out of the light-DOM stylesheet", () => {
  assert.doesNotMatch(
    lightDomStyles,
    /\.pe-(?:trigger|popover|option)\b/
  );
  assert.match(lightDomStyles, /\.pe-toast\b/);
  assert.match(
    lightDomStyles,
    /data-pro-effort-selector-root/
  );
  assert.match(
    lightDomStyles,
    /data-pro-effort-selector-popover-host/
  );
  assert.equal(
    (
      shadowUi.match(/:host::before,/g) ?? []
    ).length,
    2
  );
  assert.equal(
    (
      shadowUi.match(
        /content: none !important;\s*display: none !important;/g
      ) ?? []
    ).length,
    2
  );
  assert.match(
    lightDomStyles,
    /data-pro-effort-selector-root[\s\S]*data-pro-effort-selector-popover-host[\s\S]*content: none !important;\s*display: none !important;/
  );
});

test("does not expose component styling hooks to ChatGPT", () => {
  assert.doesNotMatch(
    `${contentScript}\n${shadowUi}`,
    /exportparts|::part|::slotted/
  );
  assert.doesNotMatch(
    shadowUi,
    /--(?:font-sans|text-primary|main-surface-primary|surface-primary)/
  );
});

test("uses explicit stable geometry for the broken visual surfaces", () => {
  assert.match(
    shadowUi,
    /\.pe-trigger \{\s*all: initial;\s*box-sizing: border-box;[\s\S]*?display: inline-flex;[\s\S]*?align-items: center;[\s\S]*?height: 36px;[\s\S]*?border-radius: 999px;/
  );
  assert.match(
    shadowUi,
    /\.pe-trigger-chevron \{[\s\S]*?position: static;[\s\S]*?width: 10px;[\s\S]*?height: 10px;/
  );
  assert.match(
    contentScript,
    /createElementNS\([\s\S]*?"svg"[\s\S]*?"path"/
  );
  assert.match(
    contentScript,
    /const compactPreferenceLabel =\s*`\$\{preferenceLabel\.slice\(0, 3\)\}\.\.`;[\s\S]*?triggerLabel\.textContent =\s*compactPreferenceLabel;/
  );
  assert.match(
    contentScript,
    /`Pro effort: \$\{preferenceLabel\}`/
  );
  assert.match(
    contentScript,
    /createRadioOption\(\s*STANDARD,\s*"Standard"\s*\)[\s\S]*?createRadioOption\(\s*EXTENDED,\s*"Extended"\s*\)/
  );
  assert.doesNotMatch(
    contentScript,
    /trigger\.textContent\s*=/
  );
  assert.match(
    shadowUi,
    /\.pe-option \{\s*all: initial;\s*box-sizing: border-box;[^}]*display: grid;[^}]*width: 100%;[^}]*height: 36px;[^}]*padding: 6px 10px;[^}]*border-radius: 10px;/
  );
  assert.match(
    shadowUi,
    /\.pe-option:hover:not\([^}]*\) \{\s*background: var\(--pe-hover\);\s*\}/
  );
  assert.match(
    shadowUi,
    /\.pe-trigger \{[^}]*background: transparent;/
  );
  assert.match(
    shadowUi,
    /\.pe-trigger:hover \{[^}]*background: color-mix\([^}]*var\(--pe-foreground\) 10%,[^}]*transparent/
  );
  assert.doesNotMatch(
    shadowUi,
    /--pe-control-background/
  );
  assert.doesNotMatch(
    shadowUi,
    /\.pe-trigger:focus-visible \{[^}]*background:/
  );
  assert.doesNotMatch(
    shadowUi,
    /\.pe-option\[aria-checked="true"\]\s*\{[^}]*background:/
  );
  assert.match(
    shadowUi,
    /\.pe-trigger-label \{[^}]*flex: 0 0 auto;[^}]*overflow: visible;/
  );
  assert.doesNotMatch(
    shadowUi,
    /\.pe-trigger-label \{[^}]*(?:overflow:\s*hidden|text-overflow:\s*ellipsis)/
  );
  assert.match(
    shadowUi,
    /\.pe-option \{[^}]*background: transparent;/
  );
  assert.doesNotMatch(
    shadowUi,
    /\.pe-option:focus(?:-visible)? \{[^}]*background:/
  );
  assert.match(
    shadowUi,
    /\.pe-popover \{\s*all: initial;\s*box-sizing: border-box;/
  );
  assert.doesNotMatch(
    shadowUi,
    /\.pe-trigger::after|\.pe-option::before/
  );
});

test("handles composed events and deep focus across both roots", () => {
  assert.match(
    contentScript,
    /eventOccursWithin\(event, \[/
  );
  assert.equal(
    (
      contentScript.match(
        /getDeepActiveElement\(document\)/g
      ) ?? []
    ).length,
    3
  );
  assert.doesNotMatch(
    contentScript,
    /document\.activeElement/
  );
});

test("omits an invalid cross-shadow aria-controls ID reference", () => {
  assert.doesNotMatch(
    contentScript,
    /aria-controls/
  );
  assert.match(
    contentScript,
    /"aria-haspopup",\s*"dialog"/
  );
  assert.match(
    contentScript,
    /"aria-expanded",\s*"false"/
  );
});

test("removes and deduplicates the body-level popover host", () => {
  assert.match(
    contentScript,
    /popoverHost\?\.remove\(\);\s*popoverHost = null;\s*popoverShadow = null;\s*popover = null;/
  );
  assert.match(
    contentScript,
    /querySelectorAll\(\s*`\[\$\{POPOVER_HOST_ATTRIBUTE\}\]`\s*\)/
  );
  assert.match(
    contentScript,
    /candidate !== popoverHost[\s\S]*?candidate\.remove\(\)/
  );
});
