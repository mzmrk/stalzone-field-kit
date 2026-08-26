import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { syncPricingIndex, validatePricingBundle } from "../scripts/sync-pricing-index.mjs";

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("canonical pricing synchronization", () => {
  it("validates and atomically replaces the bundled index", async () => {
    const directory = await temporaryDirectory();
    const outputFile = path.join(directory, "pricing-index.json");
    await writeFile(outputFile, "known-good");
    const bundle = validBundle();

    await syncPricingIndex({
      url: "https://example.test/pricing-index.json",
      outputFile,
      fetchImpl: async () => new Response(JSON.stringify(bundle)),
    });

    expect(JSON.parse(await readFile(outputFile, "utf8"))).toEqual(bundle);
  });

  it("rejects malformed upstream data without replacing the known-good index", async () => {
    const directory = await temporaryDirectory();
    const outputFile = path.join(directory, "pricing-index.json");
    await writeFile(outputFile, "known-good");

    await expect(syncPricingIndex({
      url: "https://example.test/pricing-index.json",
      outputFile,
      fetchImpl: async () => new Response(JSON.stringify({ schemaVersion: 2 })),
    })).rejects.toThrow("Unsupported pricing bundle schema");
    expect(await readFile(outputFile, "utf8")).toBe("known-good");
  });

  it("rejects an invalid regional estimate", () => {
    const bundle = validBundle();
    bundle.regions.eu.artifacts.alpha[0].median = 0;
    expect(() => validatePricingBundle(bundle)).toThrow("Invalid artifact price estimate");
  });
});

function validBundle() {
  return {
    schemaVersion: 1,
    defaultRegion: "eu",
    regions: {
      eu: {
        region: "eu",
        sourceWindow: { asOf: "2026-08-01T00:00:00.000Z", days: 365 },
        artifacts: { alpha: { 0: { median: 100 } } },
      },
    },
  };
}

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "field-kit-pricing-sync-"));
  temporaryDirectories.push(directory);
  return directory;
}
