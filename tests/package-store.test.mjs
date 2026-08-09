import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mkdtemp, mkdir, rm, unlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { packageStore } from "../scripts/package-store.mjs";

const temporaryDirectories = [];
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function pngBytesForSize(size) {
  const bytes = Buffer.from(PNG_BYTES);
  bytes.writeUInt32BE(size, 16);
  bytes.writeUInt32BE(size, 20);
  return bytes;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function writeFixtureFile(rootDirectory, relativePath, contents) {
  const filePath = path.join(rootDirectory, ...relativePath.split("/"));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function createFixture() {
  const rootDirectory = await mkdtemp(
    path.join(os.tmpdir(), "chatgpt-effort-store-package-"),
  );
  temporaryDirectories.push(rootDirectory);

  const manifest = {
    manifest_version: 3,
    name: "Fixture Extension",
    version: "1.2.3",
    description: "Fixture extension for deterministic package tests.",
    icons: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
      128: "icons/icon-128.png",
    },
    background: {
      service_worker: "background/service-worker.mjs",
      type: "module",
    },
    content_scripts: [
      {
        matches: ["https://chatgpt.com/*"],
        js: ["content/content-script.js"],
        css: ["content/styles.css"],
      },
    ],
  };

  const files = new Map([
    ["manifest.json", `${JSON.stringify(manifest, null, 2)}\n`],
    ["LICENSE", "MIT\n"],
    ["background/service-worker.mjs", "import '../core/helper.mjs';\n"],
    ["content/content-script.js", "globalThis.fixture = true;\n"],
    ["content/styles.css", ":root { color: black; }\n"],
    ["core/helper.mjs", "export const fixture = true;\n"],
    ["icons/icon-16.png", pngBytesForSize(16)],
    ["icons/icon-32.png", pngBytesForSize(32)],
    ["icons/icon-48.png", pngBytesForSize(48)],
    ["icons/icon-128.png", pngBytesForSize(128)],
    ["icons/not-declared.png", PNG_BYTES],
    ["README.md", "do not publish\n"],
    ["package.json", "{}\n"],
    ["docs/private-notes.md", "do not publish\n"],
    ["tests/package.test.mjs", "do not publish\n"],
    ["node_modules/example/index.js", "do not publish\n"],
    ["signing-key.pem", "do not publish\n"],
  ]);

  await Promise.all(
    [...files].map(([relativePath, contents]) =>
      writeFixtureFile(rootDirectory, relativePath, contents),
    ),
  );

  return { manifest, rootDirectory };
}

function readStoredZipEntries(archive) {
  const endOffset = archive.length - 22;
  assert.equal(archive.readUInt32LE(endOffset), 0x06054b50);
  assert.equal(archive.readUInt16LE(endOffset + 20), 0);

  const entryCount = archive.readUInt16LE(endOffset + 10);
  let centralOffset = archive.readUInt32LE(endOffset + 16);
  const entries = new Map();

  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(archive.readUInt32LE(centralOffset), 0x02014b50);
    assert.equal(archive.readUInt16LE(centralOffset + 10), 0);
    const nameLength = archive.readUInt16LE(centralOffset + 28);
    const extraLength = archive.readUInt16LE(centralOffset + 30);
    const commentLength = archive.readUInt16LE(centralOffset + 32);
    const localOffset = archive.readUInt32LE(centralOffset + 42);
    const name = archive.subarray(
      centralOffset + 46,
      centralOffset + 46 + nameLength,
    ).toString("utf8");

    assert.equal(archive.readUInt32LE(localOffset), 0x04034b50);
    assert.equal(archive.readUInt16LE(localOffset + 8), 0);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const size = archive.readUInt32LE(localOffset + 22);
    const localName = archive.subarray(
      localOffset + 30,
      localOffset + 30 + localNameLength,
    ).toString("utf8");
    assert.equal(localName, name);

    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    entries.set(name, archive.subarray(dataOffset, dataOffset + size));
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

test("builds a deterministic versioned store ZIP from the strict allowlist", async () => {
  const { manifest, rootDirectory } = await createFixture();
  const firstOutput = path.join(rootDirectory, "first-output");
  const secondOutput = path.join(rootDirectory, "second-output");

  const first = await packageStore({ rootDirectory, outputDirectory: firstOutput });
  await utimes(
    path.join(rootDirectory, "content/content-script.js"),
    new Date("2040-01-01T00:00:00Z"),
    new Date("2040-01-01T00:00:00Z"),
  );
  const second = await packageStore({ rootDirectory, outputDirectory: secondOutput });

  assert.equal(path.basename(first.outputPath), "chatgpt-pro-effort-selector-1.2.3.zip");
  assert.deepEqual(first.archive, second.archive);
  assert.equal(first.sha256, second.sha256);

  const archiveEntries = readStoredZipEntries(first.archive);
  assert.deepEqual([...archiveEntries.keys()], [
    "LICENSE",
    "background/service-worker.mjs",
    "content/content-script.js",
    "content/styles.css",
    "core/helper.mjs",
    "icons/icon-128.png",
    "icons/icon-16.png",
    "icons/icon-32.png",
    "icons/icon-48.png",
    "manifest.json",
  ]);
  assert.deepEqual(
    JSON.parse(archiveEntries.get("manifest.json").toString("utf8")),
    manifest,
  );

  for (const excludedPath of [
    "README.md",
    "package.json",
    "docs/private-notes.md",
    "tests/package.test.mjs",
    "node_modules/example/index.js",
    "signing-key.pem",
    "icons/not-declared.png",
  ]) {
    assert.equal(archiveEntries.has(excludedPath), false, excludedPath);
  }
});

test("fails when a required icon size is not declared", async () => {
  const { manifest, rootDirectory } = await createFixture();
  delete manifest.icons[48];
  await writeFixtureFile(
    rootDirectory,
    "manifest.json",
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  await assert.rejects(
    packageStore({ rootDirectory }),
    /manifest\.json must declare a 48x48 icon/,
  );
});

test("fails when a declared required icon file is missing", async () => {
  const { rootDirectory } = await createFixture();
  await unlink(path.join(rootDirectory, "icons/icon-128.png"));

  await assert.rejects(
    packageStore({ rootDirectory }),
    /Required icon file does not exist: icons\/icon-128\.png/,
  );
});

test("fails when a declared icon has the wrong dimensions", async () => {
  const { rootDirectory } = await createFixture();
  await writeFixtureFile(
    rootDirectory,
    "icons/icon-128.png",
    pngBytesForSize(64),
  );

  await assert.rejects(
    packageStore({ rootDirectory }),
    /icon-128\.png must be 128x128; received 64x64/,
  );
});

test("fails when the manifest description exceeds the store limit", async () => {
  const { manifest, rootDirectory } = await createFixture();
  manifest.description = "x".repeat(133);
  await writeFixtureFile(
    rootDirectory,
    "manifest.json",
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  await assert.rejects(
    packageStore({ rootDirectory }),
    /description must contain 1-132 characters/,
  );
});

test("fails instead of silently omitting a manifest runtime file", async () => {
  const { manifest, rootDirectory } = await createFixture();
  manifest.content_scripts[0].js.push("content/missing.js");
  await writeFixtureFile(
    rootDirectory,
    "manifest.json",
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  await assert.rejects(
    packageStore({ rootDirectory }),
    /Manifest runtime file is not packaged: content\/missing\.js/,
  );
});
