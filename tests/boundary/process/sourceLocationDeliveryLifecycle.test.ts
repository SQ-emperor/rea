import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { processTest } from "../../support/process/processFixture.js";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

for (const mode of ["clean", "nonzero", "primary-clean", "primary-hang"]) {
  processTest(
    `source-location driver preserves task and shutdown outcomes: ${mode}`,
    async ({ processes }) => {
      const root = await createTestTempDirectory("rea-source-location-close-");
      await mkdir(join(root, "scripts"));
      await copyFile(
        resolve("tests/fixtures/sourceLocationDeliveryChild.mjs"),
        join(root, "scripts/rea.mjs"),
      );
      const text = "x".repeat(800);
      const map = JSON.stringify({
        version: 3,
        sources: ["authored.js"],
        sourcesContent: [text],
        names: [],
        mappings: "AAAA",
      });
      const point = { line: 1, column: 0 };
      await writeFile(join(root, "fixture.js.map"), map);
      await writeFile(
        join(root, "artifacts.json"),
        JSON.stringify([
          {
            path: "fixture.js.map",
            url: "https://fixture.invalid/fixture.js.map",
            bytes: Buffer.byteLength(map),
            sha256: hash(map),
            point,
            generated_script: { path: "fixture.js" },
            expected_matches: [
              {
                source_index: 0,
                source: "authored.js",
                original_line: 1,
                original_column: 300,
                content_sha256: hash(text),
              },
            ],
          },
        ]),
      );
      const result = await processes.run(
        process.execPath,
        [
          resolve("scripts/verify/analysis/source-location-delivery/task.mjs"),
          root,
          JSON.stringify({
            artifactDir: root,
            select: "fixture.",
            detail: "complete",
          }),
        ],
        {
          env: { ...process.env, SOURCE_LOCATION_FIXTURE_MODE: mode },
          timeoutMs: 20_000,
        },
      );
      expect(result.signal).toBeNull();
      expect(await readFile(join(root, "closed.txt"), "utf8")).toBe("EOF");
      if (mode === "clean") {
        expect(result.exitCode).toBe(0);
        expect(JSON.parse(result.stdout)).toMatchObject({
          evidence_id: "fixture-evidence",
          source_map_sha256: hash(map),
          matches: [{ content: { snippet: { length_utf16: 512 } } }],
        });
        return;
      }
      expect(result.exitCode).not.toBe(0);
      if (mode === "nonzero") expect(result.stderr).toContain("17");
      if (mode.startsWith("primary"))
        expect(result.stderr).toContain("controlled primary mapping refusal");
      if (mode.endsWith("hang")) {
        expect(result.stderr).toContain("MCP close timeout");
        expect(await readFile(join(root, "terminated.txt"), "utf8")).toBe(
          "TERM",
        );
      }
    },
  );
}
