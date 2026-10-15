import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export const WIKI_ARTIFACTS_URL =
  "https://stalzone.wiki/api/builds-calculator/items/?lang=en&category=artefact";
export const EXBO_LISTING_URL =
  "https://raw.githubusercontent.com/EXBO-Studio/stalzone-database/main/global/listing.json";

const OUTPUT_URL = new URL(
  "../src/generated/artifact-additional-properties.json",
  import.meta.url,
);
const STAT_PREFIX = "stalker.artefact_properties.factor.";
const RUBIK_ID = "9n7z";
const WIKI_ONLY_IDS = new Set(["azq5t9so"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function artifactIdFromListingPath(path) {
  return path.split("/").at(-1)?.replace(/\.json$/, "") ?? "";
}

function normalizedProperty(stat, artifactId) {
  assert(stat && typeof stat === "object", `${artifactId}: invalid additional property`);
  assert(
    stat.type === "artifactAdditionalPropertyRange",
    `${artifactId}: unexpected additional property type ${String(stat.type)}`,
  );
  assert(
    typeof stat.key === "string" && stat.key.startsWith(STAT_PREFIX),
    `${artifactId}: invalid property key ${String(stat.key)}`,
  );
  assert(typeof stat.name?.lines?.en === "string", `${artifactId}/${stat.key}: missing English name`);
  assert(Number.isFinite(stat.value?.min), `${artifactId}/${stat.key}: invalid minimum`);
  assert(Number.isFinite(stat.value?.max), `${artifactId}/${stat.key}: invalid maximum`);
  assert(typeof stat.is_positive === "boolean", `${artifactId}/${stat.key}: invalid direction`);
  assert(typeof stat.is_percentage === "boolean", `${artifactId}/${stat.key}: invalid unit`);

  return {
    key: stat.key,
    name: stat.name.lines.en,
    min: stat.value.min,
    max: stat.value.max,
    positive: stat.is_positive,
    percentage: stat.is_percentage,
  };
}

export function buildManifest(wikiItems, listing) {
  assert(Array.isArray(wikiItems), "Wiki response must be an array");
  assert(Array.isArray(listing), "EXBO listing must be an array");

  const exboIds = listing
    .filter((entry) => typeof entry?.data === "string" && entry.data.startsWith("/items/artefact/"))
    .map((entry) => artifactIdFromListingPath(entry.data));
  assert(exboIds.length >= 100, `EXBO artifact catalog unexpectedly contains only ${exboIds.length} items`);
  assert(new Set(exboIds).size === exboIds.length, "EXBO artifact catalog contains duplicate IDs");

  const wikiById = new Map();
  for (const item of wikiItems) {
    assert(typeof item?.exbo_id === "string" && item.exbo_id.length > 0, "Wiki artifact is missing exbo_id");
    assert(!wikiById.has(item.exbo_id), `Wiki response contains duplicate artifact ${item.exbo_id}`);
    wikiById.set(item.exbo_id, item);
  }

  const missing = exboIds.filter((id) => !wikiById.has(id));
  assert(missing.length === 0, `Wiki response is missing EXBO artifacts: ${missing.join(", ")}`);
  const extras = [...wikiById.keys()].filter((id) => !exboIds.includes(id) && !WIKI_ONLY_IDS.has(id));
  assert(extras.length === 0, `Wiki response contains unexpected non-EXBO artifacts: ${extras.join(", ")}`);

  const artifacts = {};
  for (const artifactId of [...exboIds].sort()) {
    const item = wikiById.get(artifactId);
    assert(Array.isArray(item.additionalStats), `${artifactId}: additionalStats must be an array`);
    const expectedCount = artifactId === RUBIK_ID ? 24 : 3;
    assert(
      item.additionalStats.length === expectedCount,
      `${artifactId}: expected ${expectedCount} additional properties, received ${item.additionalStats.length}`,
    );
    const properties = item.additionalStats
      .map((stat) => normalizedProperty(stat, artifactId))
      .sort((left, right) => left.key.localeCompare(right.key));
    assert(
      new Set(properties.map((property) => property.key)).size === properties.length,
      `${artifactId}: duplicate additional property keys`,
    );
    artifacts[artifactId] = {
      mode: artifactId === RUBIK_ID ? "selectable" : "fixed-three",
      properties,
    };
  }

  const sourceDigest = createHash("sha256")
    .update(JSON.stringify(artifacts))
    .digest("hex");
  return {
    schemaVersion: 1,
    sources: {
      wiki: WIKI_ARTIFACTS_URL,
      exboListing: EXBO_LISTING_URL,
    },
    sourceDigest,
    artifacts,
  };
}

export function validateManifest(manifest) {
  assert(manifest?.schemaVersion === 1, "Unsupported artifact-property schema");
  assert(manifest.sources?.wiki === WIKI_ARTIFACTS_URL, "Unexpected Wiki source URL");
  assert(manifest.sources?.exboListing === EXBO_LISTING_URL, "Unexpected EXBO listing URL");
  assert(manifest.artifacts && typeof manifest.artifacts === "object", "Missing artifact-property map");
  assert(Object.keys(manifest.artifacts).length >= 100, "Generated artifact-property map is unexpectedly small");

  for (const [artifactId, artifact] of Object.entries(manifest.artifacts)) {
    const expectedCount = artifactId === RUBIK_ID ? 24 : 3;
    const expectedMode = artifactId === RUBIK_ID ? "selectable" : "fixed-three";
    assert(artifact?.mode === expectedMode, `${artifactId}: invalid additional-property mode`);
    assert(Array.isArray(artifact.properties), `${artifactId}: properties must be an array`);
    assert(artifact.properties.length === expectedCount, `${artifactId}: invalid property count`);
    const keys = new Set();
    for (const property of artifact.properties) {
      const normalized = normalizedProperty({
        ...property,
        type: "artifactAdditionalPropertyRange",
        name: { lines: { en: property.name } },
        value: { min: property.min, max: property.max },
        is_positive: property.positive,
        is_percentage: property.percentage,
      }, artifactId);
      assert(!keys.has(normalized.key), `${artifactId}: duplicate property ${normalized.key}`);
      keys.add(normalized.key);
    }
  }

  const expectedDigest = createHash("sha256")
    .update(JSON.stringify(manifest.artifacts))
    .digest("hex");
  assert(manifest.sourceDigest === expectedDigest, "Artifact-property source digest does not match the data");
  return manifest;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

async function main() {
  if (process.argv.includes("--check")) {
    const manifest = JSON.parse(await readFile(OUTPUT_URL, "utf8"));
    validateManifest(manifest);
    console.log(`Validated ${Object.keys(manifest.artifacts).length} artifact property definitions.`);
    return;
  }

  const [wikiItems, listing] = await Promise.all([
    fetchJson(WIKI_ARTIFACTS_URL),
    fetchJson(EXBO_LISTING_URL),
  ]);
  const manifest = validateManifest(buildManifest(wikiItems, listing));
  await mkdir(new URL("../src/generated/", import.meta.url), { recursive: true });
  await writeFile(OUTPUT_URL, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Updated ${fileURLToPath(OUTPUT_URL)} with ${Object.keys(manifest.artifacts).length} artifacts.`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
