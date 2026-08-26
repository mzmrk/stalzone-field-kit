import { pathToFileURL } from "node:url";
import { normalizePricingRegion } from "./pricing-regions.mjs";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const region = normalizePricingRegion(process.argv[2] ?? "eu");
  const keepArtifactId = Number(process.argv[3]);
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repository || !token || !Number.isSafeInteger(keepArtifactId) || keepArtifactId <= 0) {
    throw new Error("GITHUB_REPOSITORY, GITHUB_TOKEN, and a positive uploaded artifact ID are required.");
  }
  await pruneObsoletePricingCacheArtifacts({
    artifactName: `auction-history-cache-${region}`,
    keepArtifactId,
    repository,
    token,
  });
}

export async function pruneObsoletePricingCacheArtifacts({
  artifactName,
  keepArtifactId,
  repository,
  token,
  fetchImpl = fetch,
  log = console.log,
}) {
  const obsoleteIds = [];
  for (let page = 1; ; page += 1) {
    const listingUrl = new URL(`https://api.github.com/repos/${repository}/actions/artifacts`);
    listingUrl.searchParams.set("name", artifactName);
    listingUrl.searchParams.set("per_page", "100");
    listingUrl.searchParams.set("page", String(page));
    const response = await githubRequest(listingUrl, { fetchImpl, token });
    const listing = await response.json();
    if (!Array.isArray(listing.artifacts)) {
      throw new Error("GitHub returned an invalid Actions artifact listing.");
    }
    obsoleteIds.push(...listing.artifacts
      .filter((artifact) => artifact?.name === artifactName && artifact.id !== keepArtifactId)
      .map((artifact) => artifact.id)
      .filter((id) => Number.isSafeInteger(id) && id > 0));
    if (listing.artifacts.length < 100) break;
  }

  for (const artifactId of obsoleteIds) {
    await githubRequest(`https://api.github.com/repos/${repository}/actions/artifacts/${artifactId}`, {
      fetchImpl,
      method: "DELETE",
      token,
    });
  }
  log(`Kept ${artifactName} artifact ${keepArtifactId}; deleted ${obsoleteIds.length} obsolete artifact${obsoleteIds.length === 1 ? "" : "s"}.`);
  return { deletedArtifactIds: obsoleteIds, keptArtifactId: keepArtifactId };
}

async function githubRequest(url, { fetchImpl, method = "GET", token }) {
  const response = await fetchImpl(url, {
    method,
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
