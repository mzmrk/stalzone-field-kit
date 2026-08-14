import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const region = process.argv[2] ?? "eu";
const credentialsPath = process.argv[3];
const pageLimit = 200;
const windowDays = 365;
const capturedAt = new Date();
const cutoff = capturedAt.getTime() - windowDays * 24 * 60 * 60 * 1000;
const cacheArchive = path.join(
  projectRoot,
  "data",
  "pricing",
  "cache",
  region,
  `auction-history-cache-${region}.tar.gz`,
);
const listingUrl = "https://raw.githubusercontent.com/EXBO-Studio/stalzone-database/main/global/listing.json";

const credentials = await readCredentials(credentialsPath);
const workDirectory = await mkdtemp(path.join(tmpdir(), "field-kit-cache-update-"));
const extractedCache = path.join(workDirectory, "cache");

try {
  await mkdir(extractedCache, { recursive: true });
  if (await exists(cacheArchive)) {
    await execFileAsync("tar", ["-xzf", cacheArchive, "-C", extractedCache]);
  }

  const artifactsDirectory = path.join(extractedCache, "artifacts");
  await mkdir(artifactsDirectory, { recursive: true });

  const artifactIds = await loadArtifactIds();
  const summary = {
    schemaVersion: 1,
    region,
    source: "https://eapi.stalzone.com/{region}/auction/{item}/history",
    capturedAt: capturedAt.toISOString(),
    cutoff: new Date(cutoff).toISOString(),
    windowDays,
    pageLimit,
    artifactCount: artifactIds.length,
    artifacts: {},
  };

  let totalFetched = 0;
  let totalRetained = 0;

  for (const [artifactIndex, artifactId] of artifactIds.entries()) {
    const file = path.join(artifactsDirectory, `${artifactId}.jsonl`);
    const existingRows = await readCacheRows(file);
    const newestExistingSale = Math.max(
      Number.NEGATIVE_INFINITY,
      ...existingRows.map((row) => parseSoldAt(row)),
    );
    const fetchedRows = await fetchNewRows(artifactId, newestExistingSale);
    const mergedRows = dedupeRows([...existingRows, ...fetchedRows])
      .filter((row) => {
        const soldAt = parseSoldAt(row);
        return Number.isFinite(soldAt) && soldAt >= cutoff && soldAt <= capturedAt.getTime();
      })
      .sort(compareRows);

    await writeFile(
      file,
      mergedRows.map((row) => JSON.stringify(row)).join("\n") + (mergedRows.length ? "\n" : ""),
    );

    totalFetched += fetchedRows.length;
    totalRetained += mergedRows.length;
    summary.artifacts[artifactId] = {
      existingRecords: existingRows.length,
      fetchedRecords: fetchedRows.length,
      retainedRecords: mergedRows.length,
      newestSaleAt: formatTimestamp(mergedRows.at(0)),
      oldestSaleAt: formatTimestamp(mergedRows.at(-1)),
    };

    if ((artifactIndex + 1) % 10 === 0 || artifactIndex + 1 === artifactIds.length) {
      console.log(
        `Updated ${artifactIndex + 1}/${artifactIds.length} artifacts, fetched ${totalFetched} new/overlap rows.`,
      );
    }
  }

  const manifest = {
    schemaVersion: 1,
    region,
    source: "stalzone-auction-history-cache",
    sourceSnapshot: capturedAt.toISOString(),
    generatedAt: new Date().toISOString(),
    asOf: capturedAt.toISOString(),
    cutoff: new Date(cutoff).toISOString(),
    windowDays,
    artifactCount: artifactIds.length,
    recordCount: totalRetained,
    lastUpdate: summary,
    format:
      "tar.gz containing manifest.json and artifacts/<artifactId>.jsonl; sale rows keep top-level API fields and flatten additional.* fields",
  };

  await writeFile(path.join(extractedCache, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await mkdir(path.dirname(cacheArchive), { recursive: true });
  await rm(cacheArchive, { force: true });
  await execFileAsync("tar", ["-czf", cacheArchive, "-C", extractedCache, "."]);

  console.log(
    `Updated ${path.relative(projectRoot, cacheArchive)}: fetched ${totalFetched}, retained ${totalRetained}.`,
  );
} finally {
  await rm(workDirectory, { recursive: true, force: true });
}

async function readCredentials(file) {
  const fileCredentials = file ? JSON.parse(await readFile(path.resolve(projectRoot, file), "utf8")) : {};
  const clientId = process.env.STALZONE_CLIENT_ID ?? fileCredentials.clientId;
  const clientSecret = process.env.STALZONE_CLIENT_SECRET ?? fileCredentials.clientSecret;
  if (!clientId || !clientSecret) {
    throw new Error("Missing STALZONE_CLIENT_ID/STALZONE_CLIENT_SECRET or a credentials JSON path.");
  }
  return { clientId, clientSecret };
}

async function loadArtifactIds() {
  const response = await fetch(listingUrl);
  if (!response.ok) throw new Error(`Artifact listing failed (${response.status}).`);
  const listing = await response.json();
  return [
    ...new Set(
      listing
        .map((entry) => entry?.data)
        .filter((itemPath) => typeof itemPath === "string" && itemPath.startsWith("/items/artefact/"))
        .map((itemPath) => path.posix.basename(itemPath, ".json")),
    ),
  ].sort();
}

async function fetchNewRows(artifactId, newestExistingSale) {
  const rows = [];
  let offset = 0;
  let exhausted = false;
  let overlappedExistingCache = false;

  while (!exhausted && !overlappedExistingCache) {
    const url = new URL(
      `https://eapi.stalzone.com/${region.toUpperCase()}/auction/${artifactId}/history`,
    );
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("limit", String(pageLimit));
    url.searchParams.set("additional", "true");

    const response = await request(url, `${artifactId} offset ${offset}`);
    const parsed = await response.json();
    if (!Number.isInteger(parsed.total) || !Array.isArray(parsed.prices)) {
      throw new Error(`${artifactId} offset ${offset} returned an invalid history response.`);
    }

    const pageRows = parsed.prices.map(flattenRecord).filter(Boolean);
    rows.push(...pageRows);

    const timestamps = pageRows.map(parseSoldAt).filter(Number.isFinite);
    overlappedExistingCache =
      Number.isFinite(newestExistingSale) &&
      timestamps.some((timestamp) => timestamp <= newestExistingSale);
    exhausted = parsed.prices.length === 0 || offset + parsed.prices.length >= parsed.total;
    offset += parsed.prices.length;
  }

  return rows;
}

async function request(url, label) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        "Client-Id": credentials.clientId,
        "Client-Secret": credentials.clientSecret,
      },
    });
    if (response.ok) return response;
    const body = await response.text();
    if (response.status !== 429 && response.status < 500) {
      throw new Error(`${label} failed (${response.status}): ${body.slice(0, 200)}`);
    }
    const retryAfter = Number(response.headers.get("retry-after"));
    await delay(Number.isFinite(retryAfter) ? retryAfter * 1_000 : Math.min(30_000, 1_000 * 2 ** attempt));
  }
  throw new Error(`${label} failed after retries.`);
}

async function readCacheRows(file) {
  try {
    return (await readFile(file, "utf8"))
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
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

  return row;
}

function dedupeRows(rows) {
  const seen = new Set();
  const deduped = [];
  for (const row of rows.sort(compareRows)) {
    const key = stableStringify(row);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function compareRows(left, right) {
  return parseSoldAt(right) - parseSoldAt(left) || Number(left.price ?? 0) - Number(right.price ?? 0);
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

function parseSoldAt(row) {
  return Date.parse(row.time ?? row.closedAt ?? row.endTime ?? row.end_time ?? row.date ?? "");
}

function formatTimestamp(row) {
  if (!row) return null;
  const timestamp = parseSoldAt(row);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
