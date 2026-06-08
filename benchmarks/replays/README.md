# bench replays

Capture sink for `VK_BENCH_CAPTURE=1` runs. Each successful capture writes two
files into this directory:

- `<timestamp>-<runId>.tar.gz` — the workdir bundled by `tar`
  (excludes `node_modules`, `.git`, `.env*`, build outputs, logs).
- `<timestamp>-<runId>.json` — anonymized sidecar with task title, prompt,
  metadata, and outcome. Paths are scrubbed; secrets/UUIDs/emails redacted;
  project name reduced to a stable hash.

Override the location with `VK_BENCH_REPLAY_DIR=/abs/path`.

The `.gitignore` keeps payloads out of git; only this README and the
`.gitignore` itself are tracked.

Replay them with `bun benchmarks/harness/run.ts replay --since=YYYY-MM-DD`
(see Phase L3 in `.missions/benchmark-pipeline-coverage.md`).
