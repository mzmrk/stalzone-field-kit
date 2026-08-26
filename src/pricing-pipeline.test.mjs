import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  fetchNewRows,
  mergeCacheRows,
  updateAuctionHistoryCache,
} from "../scripts/update-auction-history-cache.mjs";
import { mergePricingIndexes } from "../scripts/merge-pricing-indexes.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempDirectories = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("auction history cache updater", () => {
  it("can bootstrap an empty cache archive and stops once fetched history crosses the rolling cutoff", async () => {
    const tempDirectory = await temporaryDirectory();
    const archive = path.join(tempDirectory, "auction-history-cache-eu.tar.gz");
    const capturedAt = new Date("2026-01-10T00:00:00.000Z");
    const fetchedOffsets = [];
    const sourceFetch = createFetch({
      listing: [{ data: "/items/artefact/alpha.json" }],
      histories: {
        alpha: {
          0: page(2, [{ price: 100, time: "2026-01-09T00:00:00.000Z", additional: { qlt: 0 } }]),
          1: page(2, [{ price: 90, time: "2025-01-09T00:00:00.000Z", additional: { qlt: 0 } }]),
          2: page(3, [{ price: 80, time: "2025-01-08T00:00:00.000Z", additional: { qlt: 0 } }]),
        },
      },
      onHistoryRequest: ({ offset }) => fetchedOffsets.push(offset),
    });
    const fetchImpl = async (...args) => {
      if (String(args[0]).includes("/auction/")) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return sourceFetch(...args);
    };
    const logs = [];

    const summary = await updateAuctionHistoryCache({
      cacheArchive: archive,
      capturedAt,
      credentials: fakeCredentials(),
      fetchImpl,
      listingUrl: "https://example.test/listing.json",
      heartbeatMs: 1,
      log: (message) => logs.push(message),
      pageLimit: 1,
      projectRoot,
      region: "eu",
      windowDays: 365,
    });

    expect(summary).toEqual({ artifactCount: 1, fetchedRecords: 2, retainedRecords: 1 });
    expect(fetchedOffsets).toEqual([0, 1]);
    expect(
      logs.some((message) =>
        message.includes("Heartbeat eu: 0/1 artifacts complete, current alpha (1 rows across 1 pages, 0.3% of 365-day window), fetched 1 new/overlap rows."),
      ),
    ).toBe(true);

    const manifest = JSON.parse(await tarOutput(archive, "./manifest.json"));
    expect(manifest.recordCount).toBe(1);
    expect(manifest.artifactCount).toBe(1);
    expect(manifest.generatedAt).toBe(capturedAt.toISOString());

    const rows = (await tarOutput(archive, "./artifacts/alpha.jsonl"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rows).toEqual([{ price: 100, time: "2026-01-09T00:00:00.000Z", "additional.qlt": 0 }]);
  });

  it("fetches one extra page after overlap and deduplicates the merge", async () => {
    const capturedAt = new Date("2026-01-10T00:00:00.000Z");
    const newestExistingSale = Date.parse("2026-01-08T00:00:00.000Z");
    const fetchedOffsets = [];
    const fetchImpl = createFetch({
      histories: {
        alpha: {
          0: page(4, [
            { price: 120, time: "2026-01-09T00:00:00.000Z", additional: { qlt: 0 } },
            { price: 100, time: "2026-01-08T00:00:00.000Z", additional: { qlt: 0 } },
          ]),
          2: page(4, [{ price: 90, time: "2026-01-07T00:00:00.000Z", additional: { qlt: 0 } }]),
        },
      },
      onHistoryRequest: ({ offset }) => fetchedOffsets.push(offset),
    });

    const fetchedRows = await fetchNewRows({
      artifactId: "alpha",
      cutoff: Date.parse("2025-01-10T00:00:00.000Z"),
      credentials: fakeCredentials(),
      fetchImpl,
      newestExistingSale,
      pageLimit: 2,
      region: "eu",
    });
    const mergedRows = mergeCacheRows({
      capturedAt,
      existingRows: [{ price: 100, time: "2026-01-08T00:00:00.000Z", "additional.qlt": 0 }],
      fetchedRows,
      windowDays: 365,
    });

    expect(fetchedOffsets).toEqual([0, 2]);
    expect(mergedRows.map((row) => row.price)).toEqual([120, 100, 90]);
  });

  it("retries a rate-limited history page", async () => {
    let attempts = 0;
    const fetchedRows = await fetchNewRows({
      artifactId: "alpha",
      cutoff: Date.parse("2025-01-10T00:00:00.000Z"),
      credentials: fakeCredentials(),
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) {
          return jsonResponse({ message: "rate limited" }, { status: 429, headers: { "retry-after": "0" } });
        }
        return jsonResponse(page(1, [{ price: 100, time: "2026-01-09T00:00:00.000Z" }]));
      },
      newestExistingSale: Number.NaN,
      pageLimit: 200,
      region: "eu",
    });

    expect(attempts).toBe(2);
    expect(fetchedRows).toHaveLength(1);
  });

  it("prunes artifact files absent from the current listing", async () => {
    const tempDirectory = await temporaryDirectory();
    const archive = path.join(tempDirectory, "auction-history-cache-eu.tar.gz");
    await createCacheArchive(archive, {
      alpha: [{ price: 100, time: "2026-01-08T00:00:00.000Z" }],
      stale: [{ price: 50, time: "2026-01-08T00:00:00.000Z" }],
    });

    await updateAuctionHistoryCache({
      cacheArchive: archive,
      capturedAt: new Date("2026-01-10T00:00:00.000Z"),
      credentials: fakeCredentials(),
      fetchImpl: createFetch({
        listing: [{ data: "/items/artefact/alpha.json" }],
        histories: { alpha: { 0: page(0, []) } },
      }),
      listingUrl: "https://example.test/listing.json",
      log: () => {},
      pageLimit: 200,
      projectRoot,
      region: "eu",
      windowDays: 365,
    });

    const { stdout: listing } = await execFileAsync("tar", ["-tzf", archive]);
    expect(listing).toContain("./artifacts/alpha.jsonl");
    expect(listing).not.toContain("./artifacts/stale.jsonl");
    const manifest = JSON.parse(await tarOutput(archive, "./manifest.json"));
    expect(manifest).toMatchObject({ artifactCount: 1, recordCount: 1 });
  });

  it("keeps the known-good archive when replacement creation fails", async () => {
    const tempDirectory = await temporaryDirectory();
    const archive = path.join(tempDirectory, "auction-history-cache-eu.tar.gz");
    await createCacheArchive(archive, {
      alpha: [{ price: 100, time: "2026-01-08T00:00:00.000Z" }],
    });
    const originalArchive = await readFile(archive);

    await expect(
      updateAuctionHistoryCache({
        cacheArchive: archive,
        capturedAt: new Date("2026-01-10T00:00:00.000Z"),
        credentials: fakeCredentials(),
        execFileImpl: async (command, args) => {
          if (args[0] === "-czf") throw new Error("simulated archive failure");
          return execFileAsync(command, args);
        },
        fetchImpl: createFetch({
          listing: [{ data: "/items/artefact/alpha.json" }],
          histories: { alpha: { 0: page(0, []) } },
        }),
        listingUrl: "https://example.test/listing.json",
        log: () => {},
        pageLimit: 200,
        projectRoot,
        region: "eu",
        windowDays: 365,
      }),
    ).rejects.toThrow("simulated archive failure");

    expect(await readFile(archive)).toEqual(originalArchive);
    await expect(stat(`${archive}.${process.pid}.tmp`)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("pricing index builder", () => {
  it("uses build-equivalent same-rarity sales and adjacent-rarity extrapolation from cache records", async () => {
    const tempDirectory = await temporaryDirectory();
    const cacheDirectory = path.join(tempDirectory, "cache");
    const outputFile = path.join(tempDirectory, "pricing-index.json");
    const secondOutputFile = path.join(tempDirectory, "pricing-index-copy.json");
    await mkdir(path.join(cacheDirectory, "artifacts"), { recursive: true });
    await writeFile(
      path.join(cacheDirectory, "manifest.json"),
      JSON.stringify({
        schemaVersion: 1,
        region: "eu",
        asOf: "2026-01-10T00:00:00.000Z",
        sourceSnapshot: "test-cache",
      }),
    );
    await writeJsonLines(path.join(cacheDirectory, "artifacts", "alpha.jsonl"), [
      { amount: 1, price: 100, time: "2026-01-09T00:00:00.000Z" },
      { amount: 1, price: 200, time: "2026-01-08T00:00:00.000Z", "additional.stats_random": 0 },
      { amount: 1, price: 999, time: "2026-01-07T00:00:00.000Z", "additional.ptn": 1 },
      { amount: 1, price: 777, time: "2026-01-06T00:00:00.000Z", "additional.md_k": 0.5 },
      { amount: 1, price: 300, time: "2026-01-05T00:00:00.000Z", "additional.qlt": 1 },
    ]);
    await writeJsonLines(path.join(cacheDirectory, "artifacts", "beta.jsonl"), [
      { amount: 1, price: 50, time: "2026-01-09T00:00:00.000Z" },
    ]);
    await writeJsonLines(path.join(cacheDirectory, "artifacts", "gamma.jsonl"), [
      { amount: 1, price: 400, time: "2026-01-09T00:00:00.000Z", "additional.qlt": 1 },
      { amount: 1, price: 1_200, time: "2026-01-08T00:00:00.000Z", "additional.qlt": 2 },
    ]);
    await writeJsonLines(path.join(cacheDirectory, "artifacts", "delta.jsonl"), [
      { amount: 1, price: 600, time: "2026-01-09T00:00:00.000Z", "additional.qlt": 2 },
    ]);

    await execFileAsync("node", [
      path.join(projectRoot, "scripts", "generate-pricing-index.mjs"),
      "eu",
      cacheDirectory,
      outputFile,
    ]);
    await execFileAsync("node", [
      path.join(projectRoot, "scripts", "generate-pricing-index.mjs"),
      "eu",
      cacheDirectory,
      secondOutputFile,
    ]);

    const index = JSON.parse(await readFile(outputFile, "utf8"));
    expect(await readFile(secondOutputFile, "utf8")).toBe(await readFile(outputFile, "utf8"));
    expect(index.generatedAt).toBe("2026-01-10T00:00:00.000Z");
    expect(index.provenance).toMatchObject({
      pricingAlgorithmVersion: 2,
      sourceManifest: {
        schemaVersion: 1,
        region: "eu",
        asOf: "2026-01-10T00:00:00.000Z",
      },
    });
    expect(index.provenance.cacheSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(index.provenance.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(index.artifacts.alpha[0]).toMatchObject({
      median: 150,
      samples: 2,
      recent30Median: 150,
      recent90Median: 150,
      recent365Median: 150,
      condition: "build-equivalent",
      weighted: false,
    });
    expect(index.artifacts.alpha[1]).toMatchObject({
      median: 300,
      samples: 1,
      condition: "build-equivalent",
    });
    expect(index.artifacts.beta[1]).toMatchObject({
      median: 100,
      samples: 0,
      condition: "adjacent-extrapolated",
      anchorRarity: 0,
      anchorPrice: 50,
      multiplier: 2,
    });
    expect(index.artifacts.beta[2]).toBeUndefined();
    expect(index.artifacts.delta[1]).toMatchObject({
      median: 200,
      anchorRarity: 2,
      anchorPrice: 600,
      multiplier: 1 / 3,
    });
    expect(index.artifacts.delta[0]).toBeUndefined();
  });
});

describe("regional pricing index merger", () => {
  it("preserves an existing region when only another region refresh succeeds", async () => {
    const tempDirectory = await temporaryDirectory();
    const outputFile = path.join(tempDirectory, "pricing-index.json");
    const ruInput = path.join(tempDirectory, "pricing-index-ru.json");
    await writeFile(outputFile, JSON.stringify(regionalIndex("eu", 100)));
    await writeFile(ruInput, JSON.stringify(regionalIndex("ru", 200)));

    await mergePricingIndexes({ outputFile, inputFiles: [ruInput] });

    const bundle = JSON.parse(await readFile(outputFile, "utf8"));
    expect(bundle).toMatchObject({ schemaVersion: 1, defaultRegion: "eu" });
    expect(Object.keys(bundle.regions)).toEqual(["eu", "ru"]);
    expect(bundle.regions.eu.artifacts.alpha[0].median).toBe(100);
    expect(bundle.regions.ru.artifacts.alpha[0].median).toBe(200);
  });
});

function createFetch({ histories = {}, listing = [], onHistoryRequest = () => {} }) {
  return async (input) => {
    const url = new URL(String(input));
    if (url.hostname === "example.test") return jsonResponse(listing);

    const match = url.pathname.match(/\/auction\/([^/]+)\/history$/);
    if (!match) return jsonResponse({ message: "not found" }, { status: 404 });

    const artifactId = match[1];
    const offset = Number(url.searchParams.get("offset") ?? 0);
    onHistoryRequest({ artifactId, offset });
    const response = histories[artifactId]?.[offset] ?? page(0, []);
    return jsonResponse(response);
  };
}

function page(total, prices) {
  return { total, prices };
}

function jsonResponse(value, init) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function fakeCredentials() {
  return { clientId: "test-client", clientSecret: "test-secret" };
}

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "field-kit-pricing-test-"));
  tempDirectories.push(directory);
  return directory;
}

async function tarOutput(archive, member) {
  const { stdout } = await execFileAsync("tar", ["-xOzf", archive, member]);
  return stdout;
}

async function writeJsonLines(file, rows) {
  await writeFile(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

async function createCacheArchive(archive, recordsByArtifact) {
  const source = await temporaryDirectory();
  await mkdir(path.join(source, "artifacts"), { recursive: true });
  for (const [artifactId, rows] of Object.entries(recordsByArtifact)) {
    await writeJsonLines(path.join(source, "artifacts", `${artifactId}.jsonl`), rows);
  }
  await writeFile(
    path.join(source, "manifest.json"),
    JSON.stringify({ schemaVersion: 1, region: "eu", asOf: "2026-01-08T00:00:00.000Z" }),
  );
  await execFileAsync("tar", ["-czf", archive, "-C", source, "."]);
}

function regionalIndex(region, medianValue) {
  return {
    region,
    snapshot: `${region}-snapshot`,
    method: "test",
    sourceWindow: {
      asOf: "2026-01-10T00:00:00.000Z",
      cutoff: "2025-01-10T00:00:00.000Z",
      days: 365,
    },
    artifacts: {
      alpha: {
        0: {
          median: medianValue,
          samples: 1,
          condition: "build-equivalent",
          confidence: "low",
          weighted: false,
          windowDays: 365,
        },
      },
    },
  };
}
