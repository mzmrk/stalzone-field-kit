import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const region = process.argv[2] ?? "eu";
const rawRoot = path.join(projectRoot, "data", "pricing", "raw", region);
const requestedSnapshot = process.argv[3];
const snapshots = (await readdir(rawRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const snapshot = requestedSnapshot ?? snapshots.at(-1);

if (!snapshot || !snapshots.includes(snapshot)) {
  throw new Error(`Pricing snapshot not found for region ${region}.`);
}

const snapshotDirectory = path.join(rawRoot, snapshot);
const files = (await readdir(snapshotDirectory))
  .filter((file) => file.endsWith(".json"))
  .sort();
const artifacts = {};

for (const file of files) {
  const artifactId = file.slice(0, -5);
  const history = JSON.parse(await readFile(path.join(snapshotDirectory, file), "utf8"));
  if (typeof history.total !== "number" || !Array.isArray(history.prices)) {
    throw new Error(`${file} does not contain an auction-history response.`);
  }

  const tiers = {};
  for (let rarityIndex = 0; rarityIndex <= 5; rarityIndex += 1) {
    const prices = history.prices
      .filter((sale) => sale.additional?.qlt === rarityIndex)
      .map((sale) => sale.price)
      .filter((price) => Number.isFinite(price) && price >= 0)
      .sort((left, right) => left - right);
    if (prices.length === 0) continue;
    const middle = Math.floor(prices.length / 2);
    const median = prices.length % 2 === 0
      ? (prices[middle - 1] + prices[middle]) / 2
      : prices[middle];
    tiers[rarityIndex] = { median, samples: prices.length };
  }
  artifacts[artifactId] = tiers;
}

const output = {
  region,
  snapshot,
  method: "median completed sale price grouped by additional.qlt",
  artifacts,
};
const outputFile = path.join(projectRoot, "src", "generated", "pricing-index.json");
await writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Generated ${path.relative(projectRoot, outputFile)} from ${files.length} raw responses.`);
