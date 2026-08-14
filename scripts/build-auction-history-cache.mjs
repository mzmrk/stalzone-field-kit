import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const region = process.argv[2] ?? "eu";
const requestedSource = process.argv[3];
const requestedOutput = process.argv[4];
const windowDays = 365;

const sourceDirectory = await resolveSnapshotDirectory(region, requestedSource);
const outputFile = requestedOutput
  ? path.resolve(projectRoot, requestedOutput)
  : path.join(projectRoot, "data", "pricing", "cache", region, `auction-history-cache-${region}.tar.gz`);

const manifest = await readOptionalJson(path.join(sourceDirectory, "manifest.json"));
const rawRecordsByArtifact = await readRawHistoryRecords(sourceDirectory);
const allRecords = [...rawRecordsByArtifact.values()].flat();
const asOf = determineAsOf(manifest, allRecords);
const cutoff = asOf - windowDays * 24 * 60 * 60 * 1000;
const tempDirectory = await mkdtemp(path.join(tmpdir(), "field-kit-auction-cache-"));
const cacheRoot = path.join(tempDirectory, `auction-history-cache-${region}`);

let retainedRecords = 0;

try {
  await mkdir(path.join(cacheRoot, "artifacts"), { recursive: true });

  for (const [artifactId, records] of [...rawRecordsByArtifact].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const rows = records
      .map((record) => flattenRecord(record))
      .filter((record) => record && record.soldAt >= cutoff && record.soldAt <= asOf)
      .sort(compareRows);
    const deduped = dedupeRows(rows);
    retainedRecords += deduped.length;
    const lines = deduped.map((record) => JSON.stringify(stripInternalFields(record))).join("\n");
    await writeFile(
      path.join(cacheRoot, "artifacts", `${artifactId}.jsonl`),
      lines ? `${lines}\n` : "",
    );
  }

  const outputManifest = {
    schemaVersion: 1,
    region,
    source: "stalzone-auction-history-cache",
    sourceSnapshot: manifest?.capturedAt ?? path.basename(sourceDirectory),
    sourceManifest: manifest ?? null,
    generatedAt: new Date().toISOString(),
    asOf: new Date(asOf).toISOString(),
    cutoff: new Date(cutoff).toISOString(),
    windowDays,
    artifactCount: rawRecordsByArtifact.size,
    recordCount: retainedRecords,
    format:
      "tar.gz containing manifest.json and artifacts/<artifactId>.jsonl; sale rows keep top-level API fields and flatten additional.* fields",
  };

  await writeFile(path.join(cacheRoot, "manifest.json"), `${JSON.stringify(outputManifest, null, 2)}\n`);
  await mkdir(path.dirname(outputFile), { recursive: true });
  await rm(outputFile, { force: true });
  await execFileAsync("tar", ["-czf", outputFile, "-C", cacheRoot, "."]);

  console.log(
    `Built ${path.relative(projectRoot, outputFile)} with ${rawRecordsByArtifact.size} artifacts and ${retainedRecords} records.`,
  );
} finally {
  await rm(tempDirectory, { recursive: true, force: true });
}

async function resolveSnapshotDirectory(regionName, requested) {
  if (requested) {
    const explicit = path.resolve(projectRoot, requested);
    if (await exists(explicit)) return explicit;
  }

  const rawRoot = path.join(projectRoot, "data", "pricing", "raw", regionName);
  const snapshots = (await readdir(rawRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const snapshot = requested ?? snapshots.at(-1);

  if (!snapshot || !snapshots.includes(snapshot)) {
    throw new Error(`Pricing snapshot not found for region ${regionName}.`);
  }

  return path.join(rawRoot, snapshot);
}

async function readRawHistoryRecords(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const records = new Map();

  for (const entry of entries) {
    if (entry.name === "manifest.json") continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      records.set(entry.name, await readArtifactPages(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      records.set(entry.name.slice(0, -5), await readArtifactPages(entryPath));
    }
  }

  return records;
}

async function readArtifactPages(entryPath) {
  const entryStat = await stat(entryPath);
  const files = entryStat.isDirectory()
    ? (await readdir(entryPath))
        .filter((file) => file.endsWith(".json"))
        .map((file) => path.join(entryPath, file))
    : [entryPath];
  const records = [];

  for (const file of files.sort(byPageOffset)) {
    const page = JSON.parse(await readFile(file, "utf8"));
    if (typeof page.total !== "number" || !Array.isArray(page.prices)) {
      throw new Error(`${path.relative(projectRoot, file)} does not contain an auction-history response.`);
    }
    records.push(...page.prices);
  }

  return records;
}

function flattenRecord(raw) {
  const soldAt = parseSoldAt(raw);
  if (!Number.isFinite(soldAt)) return null;

  const row = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "additional") continue;
    row[key] = value;
  }

  const additional = raw.additional && typeof raw.additional === "object" ? raw.additional : {};
  for (const [key, value] of Object.entries(additional)) {
    row[`additional.${key}`] = value;
  }

  row.soldAt = soldAt;
  return row;
}

function stripInternalFields(record) {
  const { soldAt, ...publicRecord } = record;
  return publicRecord;
}

function parseSoldAt(raw) {
  return Date.parse(raw.time ?? raw.closedAt ?? raw.endTime ?? raw.end_time ?? raw.date ?? "");
}

function compareRows(left, right) {
  return right.soldAt - left.soldAt || Number(left.price ?? 0) - Number(right.price ?? 0);
}

function dedupeRows(rows) {
  const seen = new Set();
  const deduped = [];
  for (const row of rows) {
    const key = stableStringify(stripInternalFields(row));
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function determineAsOf(snapshotManifest, rawRecords) {
  const manifestDate = Date.parse(
    snapshotManifest?.asOf ??
      snapshotManifest?.capturedAt ??
      snapshotManifest?.extendsHistoryCapturedAt ??
      "",
  );
  if (Number.isFinite(manifestDate)) return manifestDate;
  const latestSale = Math.max(...rawRecords.map(parseSoldAt));
  if (Number.isFinite(latestSale)) return latestSale;
  return Date.now();
}

async function readOptionalJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function byPageOffset(left, right) {
  return Number.parseInt(path.basename(left), 10) - Number.parseInt(path.basename(right), 10);
}
