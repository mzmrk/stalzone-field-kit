import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const region = process.argv[2] ?? "eu";
const requestedSnapshot = process.argv[3];
const requestedOutput = process.argv[4];
const rarityNames = ["Ordinary", "Uncommon", "Special", "Rare", "Exclusive", "Legendary"];
const windowDays = 365;
const recentWindowDays = 90;
const recencyBoostThreshold = 10;
const tolerance = 1e-6;

const outputFile = requestedOutput
  ? path.resolve(projectRoot, requestedOutput)
  : path.join(projectRoot, "src", "generated", "pricing-index.json");

const snapshotDirectory = await resolveSnapshotDirectory(region, requestedSnapshot);
const manifest = await readOptionalJson(path.join(snapshotDirectory, "manifest.json"));
const recordsByArtifact = await readHistoryRecords(snapshotDirectory);
const allSales = [...recordsByArtifact.values()].flat();
const asOf = determineAsOf(manifest, allSales);
const cutoff = asOf - windowDays * 24 * 60 * 60 * 1000;

const realEstimates = {};
const globalAdjacentRatios = [];

for (const [artifactId, sales] of recordsByArtifact) {
  realEstimates[artifactId] = {};
  for (let rarityIndex = 0; rarityIndex <= 5; rarityIndex += 1) {
    const eligibleSales = sales.filter(
      (sale) =>
        sale.rarityIndex === rarityIndex &&
        sale.soldAt >= cutoff &&
        isBuildEquivalent(sale),
    );
    const estimate = estimateFromEligibleSales(eligibleSales, asOf);
    if (estimate) realEstimates[artifactId][rarityIndex] = estimate;
  }
}

for (let rarityIndex = 0; rarityIndex < 5; rarityIndex += 1) {
  const ratios = Object.values(realEstimates)
    .map((artifact) => {
      const lower = artifact[rarityIndex]?.median;
      const higher = artifact[rarityIndex + 1]?.median;
      return lower > 0 && higher > 0 ? higher / lower : null;
    })
    .filter((ratio) => ratio !== null)
    .sort((left, right) => left - right);
  globalAdjacentRatios[rarityIndex] = {
    from: rarityIndex,
    fromName: rarityNames[rarityIndex],
    to: rarityIndex + 1,
    toName: rarityNames[rarityIndex + 1],
    medianMultiplier: median(ratios),
    samples: ratios.length,
  };
}

const artifacts = {};
for (const artifactId of [...recordsByArtifact.keys()].sort()) {
  artifacts[artifactId] = {};
  for (let rarityIndex = 0; rarityIndex <= 5; rarityIndex += 1) {
    artifacts[artifactId][rarityIndex] =
      realEstimates[artifactId]?.[rarityIndex] ??
      estimateFromAdjacentRarity(realEstimates[artifactId] ?? {}, rarityIndex);
  }
  for (const rarityIndex of Object.keys(artifacts[artifactId])) {
    if (!artifacts[artifactId][rarityIndex]) delete artifacts[artifactId][rarityIndex];
  }
}

const output = {
  region,
  snapshot: path.basename(snapshotDirectory),
  generatedAt: new Date().toISOString(),
  sourceWindow: {
    asOf: new Date(asOf).toISOString(),
    cutoff: new Date(cutoff).toISOString(),
    days: windowDays,
  },
  method:
    "recency-weighted median of build-equivalent completed sales; adjacent-step extrapolation for missing rarity tiers",
  rules: {
    buildEquivalent:
      "+0, no bonus properties, full maximum charge; researched and unstudied sales are both eligible; current charge loss is allowed",
    recencyWeights: [
      { maxAgeDays: 14, weight: 5 },
      { maxAgeDays: 30, weight: 3 },
      { maxAgeDays: 90, weight: 2 },
      { maxAgeDays: 365, weight: 1 },
    ],
    recencyBoostThreshold,
    confidence: {
      high: ">= 20 eligible samples",
      medium: "5-19 eligible samples",
      low: "1-4 eligible samples",
      estimated: "adjacent-rarity extrapolation",
    },
  },
  adjacentRarityMultipliers: globalAdjacentRatios,
  artifacts,
};

await writeFile(outputFile, `${JSON.stringify(output, null, 2)}\n`);
console.log(
  `Generated ${path.relative(projectRoot, outputFile)} from ${recordsByArtifact.size} artifact histories.`,
);

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

async function readHistoryRecords(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const records = new Map();

  for (const entry of entries) {
    if (entry.name === "manifest.json") continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      records.set(entry.name, await readArtifactPages(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      const artifactId = entry.name.slice(0, -5);
      records.set(artifactId, await readArtifactPages(entryPath));
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
  const sales = [];

  for (const file of files.sort(byPageOffset)) {
    const page = JSON.parse(await readFile(file, "utf8"));
    if (typeof page.total !== "number" || !Array.isArray(page.prices)) {
      throw new Error(`${path.relative(projectRoot, file)} does not contain an auction-history response.`);
    }
    for (const raw of page.prices) {
      const sale = normalizeSale(raw);
      if (sale) sales.push(sale);
    }
  }

  return sales;
}

function normalizeSale(raw) {
  const additional = raw.additional && typeof raw.additional === "object" ? raw.additional : {};
  const price = Number(raw.price ?? raw.buyoutPrice ?? raw.buyout_price);
  const soldAt = Date.parse(raw.time ?? raw.closedAt ?? raw.endTime ?? raw.end_time ?? raw.date ?? "");
  const rarityIndex = additional.qlt ?? 0;

  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(soldAt)) return null;
  if (!Number.isInteger(rarityIndex) || rarityIndex < 0 || rarityIndex > 5) return null;
  if ((raw.amount ?? 1) !== 1) return null;

  return { additional, price, rarityIndex, soldAt };
}

function isBuildEquivalent(sale) {
  const additional = sale.additional;
  const level = additional.ptn ?? 0;
  const bonusProperties = Array.isArray(additional.bonus_properties)
    ? additional.bonus_properties.length
    : 0;
  return level === 0 && bonusProperties === 0 && Number(additional.md_k ?? 0) <= tolerance;
}

function estimateFromEligibleSales(sales, asOfMs) {
  if (sales.length === 0) return null;

  const recent90Samples = sales.filter((sale) => daysOld(sale, asOfMs) <= recentWindowDays).length;
  const weighted = recent90Samples >= recencyBoostThreshold;
  const medianPrice = weightedMedian(
    sales.map((sale) => ({
      price: sale.price,
      weight: weighted ? recencyWeight(daysOld(sale, asOfMs)) : 1,
    })),
  );

  return {
    median: medianPrice,
    samples: sales.length,
    recent90Samples,
    condition: "build-equivalent",
    confidence: confidenceForSamples(sales.length),
    weighted,
    windowDays,
  };
}

function estimateFromAdjacentRarity(artifactEstimates, targetRarity) {
  const anchors = Object.entries(artifactEstimates)
    .map(([rarityIndex, estimate]) => ({
      rarityIndex: Number(rarityIndex),
      estimate,
      distance: Math.abs(Number(rarityIndex) - targetRarity),
    }))
    .filter((anchor) => anchor.estimate?.median > 0)
    .sort((left, right) => left.distance - right.distance);

  const anchor = anchors[0];
  if (!anchor) return null;

  const multiplier = chainedMultiplier(anchor.rarityIndex, targetRarity);
  if (!(multiplier > 0)) return null;

  return {
    median: anchor.estimate.median * multiplier,
    samples: 0,
    recent90Samples: 0,
    condition: "adjacent-extrapolated",
    confidence: "estimated",
    weighted: false,
    windowDays,
    anchorRarity: anchor.rarityIndex,
    anchorRarityName: rarityNames[anchor.rarityIndex],
    anchorPrice: anchor.estimate.median,
    multiplier,
  };
}

function chainedMultiplier(fromRarity, toRarity) {
  let multiplier = 1;
  if (toRarity > fromRarity) {
    for (let rarityIndex = fromRarity; rarityIndex < toRarity; rarityIndex += 1) {
      const step = globalAdjacentRatios[rarityIndex]?.medianMultiplier;
      if (!(step > 0)) return null;
      multiplier *= step;
    }
  } else {
    for (let rarityIndex = toRarity; rarityIndex < fromRarity; rarityIndex += 1) {
      const step = globalAdjacentRatios[rarityIndex]?.medianMultiplier;
      if (!(step > 0)) return null;
      multiplier /= step;
    }
  }
  return multiplier;
}

function confidenceForSamples(samples) {
  if (samples >= 20) return "high";
  if (samples >= 5) return "medium";
  return "low";
}

function recencyWeight(ageDays) {
  if (ageDays <= 14) return 5;
  if (ageDays <= 30) return 3;
  if (ageDays <= 90) return 2;
  return 1;
}

function daysOld(sale, asOfMs) {
  return (asOfMs - sale.soldAt) / (24 * 60 * 60 * 1000);
}

function determineAsOf(snapshotManifest, sales) {
  const manifestDate = Date.parse(
    snapshotManifest?.extendsHistoryCapturedAt ?? snapshotManifest?.capturedAt ?? "",
  );
  if (Number.isFinite(manifestDate)) return manifestDate;
  const latestSale = Math.max(...sales.map((sale) => sale.soldAt));
  if (Number.isFinite(latestSale)) return latestSale;
  return Date.now();
}

function median(values) {
  if (values.length === 0) return null;
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? (values[middle - 1] + values[middle]) / 2
    : values[middle];
}

function weightedMedian(values) {
  const sorted = values
    .filter((value) => value.price > 0 && value.weight > 0)
    .sort((left, right) => left.price - right.price);
  const totalWeight = sorted.reduce((total, value) => total + value.weight, 0);
  let accumulatedWeight = 0;

  for (const value of sorted) {
    accumulatedWeight += value.weight;
    if (accumulatedWeight >= totalWeight / 2) return value.price;
  }
  return null;
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
