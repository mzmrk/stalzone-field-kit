import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { restoreLatestPricingCache } from "../scripts/restore-pricing-cache.mjs";

const tempDirectories = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("pricing cache artifact restoration", () => {
  it("allows the updater to bootstrap when no retained cache exists", async () => {
    const requests = [];
    const result = await restoreLatestPricingCache({
      artifactName: "auction-history-cache-eu",
      expectedArchiveName: "auction-history-cache-eu.tar.gz",
      fetchImpl: async (input) => {
        requests.push(String(input));
        return jsonResponse({ artifacts: [] });
      },
      log: () => {},
      outputDirectory: await temporaryDirectory(),
      repository: "owner/repository",
      token: "test-token",
    });

    expect(result).toEqual({ restored: false, artifactId: null });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("name=auction-history-cache-eu");
  });

  it("selects the newest unexpired matching artifact and validates the restored archive", async () => {
    const outputDirectory = await temporaryDirectory();
    const downloadedUrls = [];
    const result = await restoreLatestPricingCache({
      artifactName: "auction-history-cache-eu",
      expectedArchiveName: "auction-history-cache-eu.tar.gz",
      fetchImpl: async (input, init) => {
        const url = String(input);
        expect(init.headers.Authorization).toBe("Bearer test-token");
        if (url.includes("/actions/artifacts?")) {
          return jsonResponse({
            artifacts: [
              artifact(1, "2026-01-01T00:00:00Z"),
              artifact(3, "2026-01-03T00:00:00Z", { expired: true }),
              artifact(2, "2026-01-02T00:00:00Z"),
            ],
          });
        }
        downloadedUrls.push(url);
        return new Response("zip bytes");
      },
      execFileImpl: async (command, args) => {
        if (command === "unzip") {
          expect(args.slice(0, 1)).toEqual(["-oq"]);
          const extractedDirectory = args.at(-1);
          await mkdir(extractedDirectory, { recursive: true });
          await writeFile(path.join(extractedDirectory, "auction-history-cache-eu.tar.gz"), "cache");
          return { stdout: "", stderr: "" };
        }
        expect(command).toBe("tar");
        expect(args[0]).toBe("-tzf");
        return { stdout: "./manifest.json\n./artifacts/\n", stderr: "" };
      },
      log: () => {},
      outputDirectory,
      repository: "owner/repository",
      token: "test-token",
    });

    expect(result).toEqual({ restored: true, artifactId: 2 });
    expect(downloadedUrls).toEqual(["https://api.example.test/artifacts/2/zip"]);
    expect(await readFile(path.join(outputDirectory, "auction-history-cache-eu.tar.gz"), "utf8")).toBe("cache");
  });

  it("keeps an existing cache when the downloaded artifact is invalid", async () => {
    const outputDirectory = await temporaryDirectory();
    const outputArchive = path.join(outputDirectory, "auction-history-cache-eu.tar.gz");
    await writeFile(outputArchive, "known-good-cache");

    await expect(
      restoreLatestPricingCache({
        artifactName: "auction-history-cache-eu",
        expectedArchiveName: "auction-history-cache-eu.tar.gz",
        fetchImpl: async (input) =>
          String(input).includes("/actions/artifacts?")
            ? jsonResponse({ artifacts: [artifact(1, "2026-01-01T00:00:00Z")] })
            : new Response("zip bytes"),
        execFileImpl: async (command, args) => {
          if (command === "unzip") {
            const extractedDirectory = args.at(-1);
            await mkdir(extractedDirectory, { recursive: true });
            await writeFile(path.join(extractedDirectory, "auction-history-cache-eu.tar.gz"), "invalid");
            return { stdout: "", stderr: "" };
          }
          return { stdout: "not-a-cache\n", stderr: "" };
        },
        log: () => {},
        outputDirectory,
        repository: "owner/repository",
        token: "test-token",
      }),
    ).rejects.toThrow("not a valid pricing cache archive");

    expect(await readFile(outputArchive, "utf8")).toBe("known-good-cache");
  });
});

function artifact(id, createdAt, overrides = {}) {
  return {
    id,
    name: "auction-history-cache-eu",
    expired: false,
    created_at: createdAt,
    archive_download_url: `https://api.example.test/artifacts/${id}/zip`,
    ...overrides,
  };
}

function jsonResponse(value) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "field-kit-workflow-test-"));
  tempDirectories.push(directory);
  return directory;
}
