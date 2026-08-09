import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = fileURLToPath(new URL("../", import.meta.url));
const RUNTIME_DIRECTORIES = Object.freeze(["background", "content", "core"]);
const RUNTIME_EXTENSIONS = new Set([".css", ".js", ".mjs"]);
const REQUIRED_ICON_SIZES = Object.freeze(["16", "32", "48", "128"]);
const ARCHIVE_PREFIX = "chatgpt-pro-effort-selector";
const MAX_DESCRIPTION_LENGTH = 132;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const DOS_TIME = 0;
const DOS_DATE = (20 << 9) | (1 << 5) | 1; // 2000-01-01 00:00:00

function compareArchivePaths(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function assertSafeArchivePath(archivePath, label) {
  if (typeof archivePath !== "string" || archivePath.length === 0) {
    throw new Error(`${label} must be a non-empty path.`);
  }

  if (
    archivePath.includes("\\") ||
    archivePath.includes("\0") ||
    path.posix.isAbsolute(archivePath) ||
    path.posix.normalize(archivePath) !== archivePath ||
    archivePath.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`${label} is not a safe relative archive path: ${archivePath}`);
  }
}

async function readRequiredFile(rootDirectory, archivePath, label) {
  assertSafeArchivePath(archivePath, label);
  const filePath = path.join(rootDirectory, ...archivePath.split("/"));

  let stats;
  try {
    stats = await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${label} does not exist: ${archivePath}`);
    }
    throw error;
  }

  if (!stats.isFile()) {
    throw new Error(`${label} must be a regular file: ${archivePath}`);
  }

  return readFile(filePath);
}

async function walkRuntimeDirectory(rootDirectory, directoryName) {
  const absoluteDirectory = path.join(rootDirectory, directoryName);
  let stats;
  try {
    stats = await lstat(absoluteDirectory);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`Required runtime directory does not exist: ${directoryName}`);
    }
    throw error;
  }

  if (!stats.isDirectory()) {
    throw new Error(`Required runtime directory is not a directory: ${directoryName}`);
  }

  const files = [];

  async function visit(relativeDirectory) {
    const directoryPath = path.join(
      rootDirectory,
      ...relativeDirectory.split("/"),
    );
    const entries = await readdir(directoryPath, { withFileTypes: true });
    entries.sort((left, right) => compareArchivePaths(left.name, right.name));

    for (const entry of entries) {
      const archivePath = `${relativeDirectory}/${entry.name}`;
      assertSafeArchivePath(archivePath, "Runtime entry");

      if (entry.isDirectory()) {
        await visit(archivePath);
        continue;
      }

      if (!entry.isFile()) {
        throw new Error(`Runtime entries must be regular files: ${archivePath}`);
      }

      if (!RUNTIME_EXTENSIONS.has(path.posix.extname(archivePath))) {
        throw new Error(`Unsupported file in runtime directory: ${archivePath}`);
      }

      files.push({
        name: archivePath,
        data: await readFile(path.join(rootDirectory, ...archivePath.split("/"))),
      });
    }
  }

  await visit(directoryName);
  if (files.length === 0) {
    throw new Error(`Required runtime directory is empty: ${directoryName}`);
  }
  return files;
}

function collectManifestRuntimeReferences(manifest) {
  const references = [];
  if (manifest.background?.service_worker) {
    references.push(manifest.background.service_worker);
  }

  for (const [index, contentScript] of (manifest.content_scripts ?? []).entries()) {
    for (const [kind, values] of [
      ["js", contentScript.js ?? []],
      ["css", contentScript.css ?? []],
    ]) {
      for (const [fileIndex, value] of values.entries()) {
        if (typeof value !== "string") {
          throw new Error(
            `manifest.json content_scripts[${index}].${kind}[${fileIndex}] must be a path.`,
          );
        }
        references.push(value);
      }
    }
  }

  return references;
}

function validateManifest(manifest) {
  if (manifest.manifest_version !== 3) {
    throw new Error("manifest.json must declare Manifest V3.");
  }

  if (
    typeof manifest.version !== "string" ||
    !/^(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*)){0,3}$/.test(manifest.version)
  ) {
    throw new Error("manifest.json has an invalid Chrome extension version.");
  }

  if (
    typeof manifest.description !== "string" ||
    manifest.description.length === 0 ||
    manifest.description.length > MAX_DESCRIPTION_LENGTH
  ) {
    throw new Error(
      `manifest.json description must contain 1-${MAX_DESCRIPTION_LENGTH} characters.`,
    );
  }

  if (!manifest.icons || typeof manifest.icons !== "object" || Array.isArray(manifest.icons)) {
    throw new Error("manifest.json must declare extension icons.");
  }

  for (const size of REQUIRED_ICON_SIZES) {
    if (typeof manifest.icons[size] !== "string") {
      throw new Error(`manifest.json must declare a ${size}x${size} icon.`);
    }
  }
}

function readPngDimensions(data, label) {
  if (
    data.length < 24 ||
    !data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
    data.subarray(12, 16).toString("ascii") !== "IHDR"
  ) {
    throw new Error(`${label} must be a valid PNG with an IHDR header.`);
  }

  return {
    height: data.readUInt32BE(20),
    width: data.readUInt32BE(16),
  };
}

function createCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

const CRC32_TABLE = createCrc32Table();

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function assertZip32Value(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} exceeds the deterministic ZIP32 limit.`);
  }
}

export function createDeterministicZip(entries) {
  const localRecords = [];
  const centralRecords = [];
  let localOffset = 0;

  for (const entry of entries) {
    assertSafeArchivePath(entry.name, "Archive entry");
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data);
    const checksum = crc32(data);
    assertZip32Value(data.length, `Archive entry ${entry.name}`);
    assertZip32Value(localOffset, "Archive offset");

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(UTF8_FLAG, 6);
    localHeader.writeUInt16LE(STORE_METHOD, 8);
    localHeader.writeUInt16LE(DOS_TIME, 10);
    localHeader.writeUInt16LE(DOS_DATE, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localRecords.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(STORE_METHOD, 10);
    centralHeader.writeUInt16LE(DOS_TIME, 12);
    centralHeader.writeUInt16LE(DOS_DATE, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralRecords.push(centralHeader, name);

    localOffset += localHeader.length + name.length + data.length;
  }

  if (entries.length > 0xffff) {
    throw new Error("Archive contains too many entries for deterministic ZIP32 output.");
  }

  const centralDirectory = Buffer.concat(centralRecords);
  assertZip32Value(centralDirectory.length, "Central directory");
  assertZip32Value(localOffset, "Central directory offset");

  const endRecord = Buffer.alloc(22);
  endRecord.writeUInt32LE(0x06054b50, 0);
  endRecord.writeUInt16LE(0, 4);
  endRecord.writeUInt16LE(0, 6);
  endRecord.writeUInt16LE(entries.length, 8);
  endRecord.writeUInt16LE(entries.length, 10);
  endRecord.writeUInt32LE(centralDirectory.length, 12);
  endRecord.writeUInt32LE(localOffset, 16);
  endRecord.writeUInt16LE(0, 20);

  return Buffer.concat([...localRecords, centralDirectory, endRecord]);
}

export async function collectPackageEntries(rootDirectory) {
  const manifestData = await readRequiredFile(
    rootDirectory,
    "manifest.json",
    "Required manifest",
  );

  let manifest;
  try {
    manifest = JSON.parse(manifestData.toString("utf8"));
  } catch (error) {
    throw new Error(`manifest.json is not valid JSON: ${error.message}`);
  }
  validateManifest(manifest);

  const entries = [
    { name: "manifest.json", data: manifestData },
    {
      name: "LICENSE",
      data: await readRequiredFile(rootDirectory, "LICENSE", "Required license"),
    },
  ];

  for (const directoryName of RUNTIME_DIRECTORIES) {
    entries.push(...(await walkRuntimeDirectory(rootDirectory, directoryName)));
  }

  const declaredIconSizes = new Map();
  for (const [size, iconPath] of Object.entries(manifest.icons)) {
    assertSafeArchivePath(iconPath, `manifest.json icon ${size}`);
    if (!iconPath.startsWith("icons/") || path.posix.extname(iconPath) !== ".png") {
      throw new Error(`manifest.json icon ${size} must be a PNG inside icons/: ${iconPath}`);
    }
    if (!/^\d+$/.test(size) || Number(size) <= 0) {
      throw new Error(`manifest.json icon key must be a positive integer: ${size}`);
    }

    const expectedSizes = declaredIconSizes.get(iconPath) ?? [];
    expectedSizes.push(Number(size));
    declaredIconSizes.set(iconPath, expectedSizes);
  }

  for (const iconPath of [...declaredIconSizes.keys()].sort(compareArchivePaths)) {
    const data = await readRequiredFile(rootDirectory, iconPath, "Required icon file");
    const dimensions = readPngDimensions(data, `Icon ${iconPath}`);
    for (const expectedSize of declaredIconSizes.get(iconPath)) {
      if (
        dimensions.width !== expectedSize ||
        dimensions.height !== expectedSize
      ) {
        throw new Error(
          `Icon ${iconPath} must be ${expectedSize}x${expectedSize}; ` +
            `received ${dimensions.width}x${dimensions.height}.`,
        );
      }
    }

    entries.push({
      name: iconPath,
      data,
    });
  }

  entries.sort((left, right) => compareArchivePaths(left.name, right.name));
  const entryNames = new Set();
  for (const entry of entries) {
    if (entryNames.has(entry.name)) {
      throw new Error(`Duplicate archive entry: ${entry.name}`);
    }
    entryNames.add(entry.name);
  }

  for (const runtimeReference of collectManifestRuntimeReferences(manifest)) {
    assertSafeArchivePath(runtimeReference, "Manifest runtime reference");
    if (!entryNames.has(runtimeReference)) {
      throw new Error(`Manifest runtime file is not packaged: ${runtimeReference}`);
    }
  }

  return { entries, manifest };
}

export async function packageStore({
  rootDirectory = PROJECT_ROOT,
  outputDirectory = path.join(rootDirectory, "dist"),
} = {}) {
  const { entries, manifest } = await collectPackageEntries(rootDirectory);
  const archive = createDeterministicZip(entries);
  const outputPath = path.join(
    outputDirectory,
    `${ARCHIVE_PREFIX}-${manifest.version}.zip`,
  );

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, archive);

  return {
    archive,
    entries: entries.map((entry) => entry.name),
    outputPath,
    sha256: createHash("sha256").update(archive).digest("hex"),
    version: manifest.version,
  };
}

async function main() {
  const result = await packageStore();
  process.stdout.write(
    `Created ${result.outputPath}\n` +
      `Version: ${result.version}\n` +
      `Files: ${result.entries.length}\n` +
      `SHA-256: ${result.sha256}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`Packaging failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
