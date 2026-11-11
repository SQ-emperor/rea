import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

// A protocol fixture for driver shutdown; no REA or target code is loaded.
const root = process.cwd();
const mode = process.env.SOURCE_LOCATION_FIXTURE_MODE;
const source = JSON.parse(
  readFileSync(join(root, "artifacts.json"), "utf8"),
)[0];
const map = readFileSync(join(root, source.path), "utf8");
const text = JSON.parse(map).sourcesContent[0];
const input = createInterface({ input: process.stdin });
const reply = (id, result) =>
  console.log(JSON.stringify({ jsonrpc: "2.0", id, result }));

// Bound the fixture even if a broken driver never closes its child.
setTimeout(() => process.exit(91), 12_000).unref();
input.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  if (request.method === "initialize") return reply(request.id, {});
  if (request.method === "tools/list")
    return reply(request.id, {
      tools: [{ name: "trace_web_source_location" }],
    });
  if (request.method !== "tools/call")
    throw new Error(`Unexpected fixture request: ${request.method}`);
  reply(request.id, {
    content: [],
    structuredContent: {
      evidence_id: "fixture-evidence",
      raw_result: { source_map_text: map },
      normalized_result: {
        source_map: {
          sha256: mode.startsWith("primary")
            ? "controlled primary mapping refusal"
            : source.sha256,
        },
        lookup: {
          requested: source.point,
          matched_generated_position: source.point,
        },
        matches: [
          {
            state: "mapped",
            source_index: 0,
            reported_source: "authored.js",
            original_position: { line: 1, column: 300, offset: 300 },
            content: {
              state: "embedded",
              text,
              utf8_sha256: source.expected_matches[0].content_sha256,
            },
          },
        ],
      },
    },
  });
});
input.on("close", () => {
  writeFileSync(join(root, "closed.txt"), "EOF");
  if (!mode.endsWith("hang")) process.exit(mode === "nonzero" ? 17 : 0);
  setInterval(() => {}, 1000);
  process.on("SIGTERM", () => {
    writeFileSync(join(root, "terminated.txt"), "TERM");
    process.exit(0);
  });
});
