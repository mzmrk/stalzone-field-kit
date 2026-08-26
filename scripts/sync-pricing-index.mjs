import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_PRICING_INDEX_URL =
  "https://raw.githubusercontent.com/mzmrk/stalzone-market-history/main/data/pricing-index.json";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await syncPricingIndex({
    url: process.argv[2] ?? DEFAULT_PRICING_INDEX_URL,
    outputFile: path.join(projectRoot, "src", "generated", "pricing-index.json"),
  });
}

export async function syncPricingIndex({ url, outputFile, fetchImpl = fetch }) {
  const response = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Price-index download failed with HTTP ${response.status}.`);
  const text = await response.text();
  const bundle = JSON.parse(text);
  validatePricingBundle(bundle);

  const temporary = `${outputFile}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(bundle, null, 2)}\n`);
    JSON.parse(await readFile(temporary, "utf8"));
    await rename(temporary, outputFile);
  } finally {
    await rm(temporary, { force: true });
  }
  return bundle;
}

export function validatePricingBundle(bundle) {
  if (bundle?.schemaVersion !== 1 || bundle.defaultRegion !== "eu" || !isRecord(bundle.regions)) {
    throw new Error("Unsupported pricing bundle schema.");
  }
  const allowedRegions = new Set(["eu", "ru", "na", "sea", "nea"]);
  for (const [region, index] of Object.entries(bundle.regions)) {
    if (!allowedRegions.has(region) || index?.region !== region) {
      throw new Error(`Invalid regional pricing index: ${region}.`);
    }
    if (
      !isRecord(index.sourceWindow) ||
      !Number.isFinite(Date.parse(index.sourceWindow.asOf)) ||
      !(index.sourceWindow.days > 0) ||
      !isRecord(index.artifacts)
    ) {
      throw new Error(`Incomplete regional pricing index: ${region}.`);
    }
    for (const rarities of Object.values(index.artifacts)) {
      if (!isRecord(rarities)) throw new Error(`Invalid artifact pricing table in ${region}.`);
      for (const estimate of Object.values(rarities)) {
        if (!isRecord(estimate) || !(estimate.median > 0) || !Number.isFinite(estimate.median)) {
          throw new Error(`Invalid artifact price estimate in ${region}.`);
        }
      }
    }
  }
  return bundle;
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
