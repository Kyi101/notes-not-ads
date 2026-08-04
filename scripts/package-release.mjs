import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const manifest = JSON.parse(
  await readFile(path.join(projectRoot, "manifest.json"), "utf8")
);
const version = manifest.version;
const outputDir = path.join(projectRoot, "dist");
const outputPath = path.join(outputDir, `attention-redirector-${version}.zip`);
const ZIP_DOS_TIME = 0;
const ZIP_DOS_DATE = (1 << 5) | 1; // 1980-01-01
const ZIP_METHOD_STORE = 0;
const ZIP_METHOD_DEFLATE = 8;
const requiredReleasePaths = [
  "manifest.json",
  "popup.html",
  "popup.css",
  "popup.js",
  "options.html",
  "options.css",
  "options.js",
  "welcome.html",
  "welcome.css",
  "welcome.js",
  "src/background.js",
  "src/content.css",
  "src/content.js",
  "src/cosmetic-filters.js",
  "src/youtube-prune-loader.js",
  "src/youtube-prune-main.js",
  "rules/rules_1.json",
  "rules/easylist_dnr.json"
];
const optionalReleaseDirs = ["fonts", "icons", "_locales"];
const CRC_TABLE = Array.from({ length: 256 }, (_value, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

const releasePaths = [
  ...requiredReleasePaths,
  ...(await collectOptionalReleasePaths(optionalReleaseDirs))
].sort();
const archive = await createZipArchive(releasePaths);

await mkdir(outputDir, { recursive: true });
await rm(outputPath, { force: true });
await writeFile(outputPath, archive);

console.log(`Wrote ${outputPath}`);
console.log(`Included ${releasePaths.length} runtime files.`);
console.log("Run `git status --short` before packaging a public release.");

async function collectOptionalReleasePaths(dirs) {
  const filePaths = [];

  for (const dir of dirs) {
    try {
      const dirStat = await stat(path.join(projectRoot, dir));
      if (!dirStat.isDirectory()) {
        continue;
      }
    } catch (_error) {
      continue;
    }

    filePaths.push(...(await listFiles(dir)));
  }

  return filePaths;
}

async function listFiles(relativeDir) {
  const absoluteDir = path.join(projectRoot, relativeDir);
  const entries = await readdir(absoluteDir, { withFileTypes: true });
  const filePaths = [];

  for (const entry of entries) {
    const relativePath = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      filePaths.push(...(await listFiles(relativePath)));
      continue;
    }
    if (entry.isFile()) {
      filePaths.push(relativePath);
    }
  }

  return filePaths;
}

async function createZipArchive(filePaths) {
  const chunks = [];
  const centralDirectory = [];
  let offset = 0;

  for (const filePath of filePaths) {
    const absolutePath = path.join(projectRoot, filePath);
    const fileData = await readFile(absolutePath);
    const nameData = Buffer.from(filePath.replaceAll(path.sep, "/"));
    const checksum = crc32(fileData);

    // Deflate only when it actually helps: on already-compressed assets such as
    // the woff2 fonts and png icons it inflates the entry.
    const deflated = deflateRawSync(fileData, { level: 9 });
    const useDeflate = deflated.length < fileData.length;
    const payload = useDeflate ? deflated : fileData;
    const method = useDeflate ? ZIP_METHOD_DEFLATE : ZIP_METHOD_STORE;

    const localHeader = createLocalFileHeader(
      nameData,
      checksum,
      method,
      payload.length,
      fileData.length
    );
    const centralHeader = createCentralDirectoryHeader(
      nameData,
      checksum,
      method,
      payload.length,
      fileData.length,
      offset
    );

    chunks.push(localHeader, nameData, payload);
    centralDirectory.push(centralHeader, nameData);
    offset += localHeader.length + nameData.length + payload.length;
  }

  const centralOffset = offset;
  const centralChunks = centralDirectory.flat();
  const centralSize = centralChunks.reduce((total, chunk) => total + chunk.length, 0);
  const endRecord = createEndOfCentralDirectory(
    filePaths.length,
    centralSize,
    centralOffset
  );

  return Buffer.concat([...chunks, ...centralChunks, endRecord]);
}

function createLocalFileHeader(nameData, checksum, method, compressedSize, uncompressedSize) {
  const buffer = Buffer.alloc(30);
  buffer.writeUInt32LE(0x04034b50, 0);
  buffer.writeUInt16LE(20, 4);
  buffer.writeUInt16LE(0, 6);
  buffer.writeUInt16LE(method, 8);
  buffer.writeUInt16LE(ZIP_DOS_TIME, 10);
  buffer.writeUInt16LE(ZIP_DOS_DATE, 12);
  buffer.writeUInt32LE(checksum, 14);
  buffer.writeUInt32LE(compressedSize, 18);
  buffer.writeUInt32LE(uncompressedSize, 22);
  buffer.writeUInt16LE(nameData.length, 26);
  buffer.writeUInt16LE(0, 28);
  return buffer;
}

function createCentralDirectoryHeader(
  nameData,
  checksum,
  method,
  compressedSize,
  uncompressedSize,
  localOffset
) {
  const buffer = Buffer.alloc(46);
  buffer.writeUInt32LE(0x02014b50, 0);
  buffer.writeUInt16LE(20, 4);
  buffer.writeUInt16LE(20, 6);
  buffer.writeUInt16LE(0, 8);
  buffer.writeUInt16LE(method, 10);
  buffer.writeUInt16LE(ZIP_DOS_TIME, 12);
  buffer.writeUInt16LE(ZIP_DOS_DATE, 14);
  buffer.writeUInt32LE(checksum, 16);
  buffer.writeUInt32LE(compressedSize, 20);
  buffer.writeUInt32LE(uncompressedSize, 24);
  buffer.writeUInt16LE(nameData.length, 28);
  buffer.writeUInt16LE(0, 30);
  buffer.writeUInt16LE(0, 32);
  buffer.writeUInt16LE(0, 34);
  buffer.writeUInt16LE(0, 36);
  buffer.writeUInt32LE(0, 38);
  buffer.writeUInt32LE(localOffset, 42);
  return buffer;
}

function createEndOfCentralDirectory(fileCount, centralSize, centralOffset) {
  const buffer = Buffer.alloc(22);
  buffer.writeUInt32LE(0x06054b50, 0);
  buffer.writeUInt16LE(0, 4);
  buffer.writeUInt16LE(0, 6);
  buffer.writeUInt16LE(fileCount, 8);
  buffer.writeUInt16LE(fileCount, 10);
  buffer.writeUInt32LE(centralSize, 12);
  buffer.writeUInt32LE(centralOffset, 16);
  buffer.writeUInt16LE(0, 20);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}
