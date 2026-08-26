import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { normalizePricingRegion } from "./pricing-regions.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const region = normalizePricingRegion(process.argv[2] ?? "eu");
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repository || !token) {
    throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required to restore a pricing cache.");
  }

  await restoreLatestPricingCache({
    artifactName: `auction-history-cache-${region}`,
    expectedArchiveName: `auction-history-cache-${region}.tar.gz`,
    outputDirectory: path.join(projectRoot, "data", "pricing", "cache", region),
    repository,
    token,
  });
}

export async function restoreLatestPricingCache({
  artifactName,
  expectedArchiveName,
  outputDirectory,
  repository,
  token,
  fetchImpl = fetch,
  execFileImpl = execFileAsync,
  log = console.log,
}) {
  const listingUrl = new URL(`https://api.github.com/repos/${repository}/actions/artifacts`);
  listingUrl.searchParams.set("name", artifactName);
  listingUrl.searchParams.set("per_page", "100");
  const listingResponse = await githubRequest(listingUrl, { fetchImpl, token });
  const listing = await listingResponse.json();
  if (!Array.isArray(listing.artifacts)) {
    throw new Error("GitHub returned an invalid Actions artifact listing.");
  }

  const artifact = listing.artifacts
    .filter(
      (candidate) =>
        candidate?.name === artifactName &&
        candidate.expired === false &&
        typeof candidate.archive_download_url === "string",
    )
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))[0];

  if (!artifact) {
    log(`No retained ${artifactName} artifact was found; the cache updater will bootstrap one.`);
    return { restored: false, artifactId: null };
  }

  const archiveResponse = await githubRequest(artifact.archive_download_url, { fetchImpl, token });
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "field-kit-cache-restore-"));
  const artifactZip = path.join(temporaryDirectory, "artifact.zip");

  try {
    await writeFile(artifactZip, Buffer.from(await archiveResponse.arrayBuffer()));
    const extractedDirectory = path.join(temporaryDirectory, "extracted");
    await mkdir(extractedDirectory, { recursive: true });
    await execFileImpl("unzip", ["-oq", artifactZip, "-d", extractedDirectory]);
    const restoredArchive = path.join(extractedDirectory, expectedArchiveName);
    const restoredStat = await stat(restoredArchive);
    if (!restoredStat.isFile() || restoredStat.size === 0) {
      throw new Error(`Restored artifact does not contain a usable ${expectedArchiveName}.`);
    }
    const { stdout: cacheMembers } = await execFileImpl("tar", ["-tzf", restoredArchive]);
    if (!cacheMembers.includes("manifest.json") || !cacheMembers.includes("artifacts/")) {
      throw new Error(`Restored ${expectedArchiveName} is not a valid pricing cache archive.`);
    }

    await mkdir(outputDirectory, { recursive: true });
    const outputArchive = path.join(outputDirectory, expectedArchiveName);
    const temporaryOutput = `${outputArchive}.${process.pid}.tmp`;
    await rm(temporaryOutput, { force: true });
    try {
      await copyFile(restoredArchive, temporaryOutput);
      await rename(temporaryOutput, outputArchive);
    } finally {
      await rm(temporaryOutput, { force: true });
    }
    log(`Restored ${artifactName} from Actions artifact ${artifact.id}.`);
    return { restored: true, artifactId: artifact.id };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function githubRequest(url, { fetchImpl, token }) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2026-03-10",
    },
  });
  if (response.ok) return response;
  const body = await response.text();
  throw new Error(`GitHub artifact request failed (${response.status}): ${body.slice(0, 200)}`);
}
