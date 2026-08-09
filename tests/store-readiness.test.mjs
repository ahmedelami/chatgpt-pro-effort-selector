import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectFile = (relativePath) =>
  new URL(`../${relativePath}`, import.meta.url);

const manifest = JSON.parse(
  await readFile(projectFile("manifest.json"), "utf8"),
);
const privacyPolicy = await readFile(
  projectFile("PRIVACY.md"),
  "utf8",
);
const storeListing = await readFile(
  projectFile("docs/store-listing.md"),
  "utf8",
);
const serviceWorker = await readFile(
  projectFile("background/service-worker.mjs"),
  "utf8",
);
const requestCore = await readFile(
  projectFile("core/request-core.mjs"),
  "utf8",
);
const iconSource = await readFile(
  projectFile("store/assets/icon-source.svg"),
  "utf8",
);
const promoSource = await readFile(
  projectFile("store/assets/small-promo-source.svg"),
  "utf8",
);

async function readPngInfo(relativePath) {
  const data = await readFile(projectFile(relativePath));
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(
    data.subarray(0, signature.length).equals(signature),
    true,
    `${relativePath} must be a PNG`,
  );
  assert.equal(
    data.subarray(12, 16).toString("ascii"),
    "IHDR",
    `${relativePath} must start with an IHDR chunk`,
  );
  return {
    colorType: data[25],
    height: data.readUInt32BE(20),
    width: data.readUInt32BE(16),
  };
}

test("manifest carries store-ready metadata and original icon sizes", async () => {
  assert.ok(manifest.description.length > 0);
  assert.ok(manifest.description.length <= 132);
  assert.equal(storeListing.includes(manifest.description), true);

  for (const size of [16, 32, 48, 128]) {
    const iconPath = manifest.icons[String(size)];
    assert.equal(iconPath, `icons/icon-${size}.png`);
    const info = await readPngInfo(iconPath);
    assert.deepEqual(
      { height: info.height, width: info.width },
      { height: size, width: size },
    );
    assert.ok(
      info.colorType === 4 || info.colorType === 6,
      `${iconPath} must preserve an alpha channel for transparent padding`,
    );
  }
});

test("store artwork uses Chrome Web Store dimensions", async () => {
  const promo = await readPngInfo("store/assets/small-promo-440x280.png");
  assert.deepEqual(
    { height: promo.height, width: promo.width },
    { height: 280, width: 440 },
  );

  const selector = await readPngInfo(
    "store/assets/screenshot-selector-640x400.png",
  );
  assert.deepEqual(
    { height: selector.height, width: selector.width },
    { height: 400, width: 640 },
  );

  assert.equal(
    iconSource.match(/data-effort-bar="true"/g)?.length,
    2,
  );
  assert.equal(
    promoSource.match(/data-effort-bar="true"/g)?.length,
    2,
  );
  for (const source of [iconSource, promoSource]) {
    assert.doesNotMatch(source, /<circle|stroke=/);
  }
});

test("public policy and listing disclose the review-sensitive behavior", () => {
  for (const text of [privacyPolicy, storeListing]) {
    assert.match(text, /unofficial/i);
    assert.match(text, /not affiliated/i);
    assert.match(text, /debugger/);
    assert.match(text, /does not retain|not retained/i);
    assert.match(text, /ChatGPT Pro/);
  }

  assert.match(storeListing, /No, I am not using remote code/);
  assert.match(storeListing, /Private reviewer test instructions/);
  assert.match(privacyPolicy, /(?:up to|no more than) 512/);
  assert.match(privacyPolicy, /replay was authorized and started/);
  assert.doesNotMatch(storeListing, /has no access to unrelated sites/i);
});

test("debugger interception is constrained to the exact ChatGPT origin", () => {
  assert.equal(
    serviceWorker.match(
      /urlPattern: "https:\/\/chatgpt\.com\/backend-api\/f\/conversation\*"/g,
    )?.length,
    2,
  );
  assert.doesNotMatch(serviceWorker, /\*:\/\/\*\/backend-api\/f\/conversation/);
  assert.match(requestCore, /identity\.origin === CHATGPT_ORIGIN/);

  const finalizationSource = serviceWorker.slice(
    serviceWorker.indexOf("async function finalizeFailedSession"),
    serviceWorker.indexOf("async function completeSentSession"),
  );
  assert.match(finalizationSource, /session\.candidateEvent = null/);
  assert.ok(
    finalizationSource.indexOf("session.candidateEvent = null") <
      finalizationSource.indexOf("await persistRequired()"),
    "failure finalization must release the full paused event before cleanup awaits",
  );
});
