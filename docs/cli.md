# CLI Reference

AgentForge ships a single CLI binary exposed as both:

- `forge-sim`
- `agentforge`

The canonical command name in docs/examples is `forge-sim`.

## Command Overview

| Command | Purpose |
|---|---|
| `doctor` | Validate local environment and optional LLM keys |
| `init` | Scaffold simulation project files |
| `run` | Execute one scenario (deterministic, exploration, or replay) |
| `report` | Generate markdown/JSON report from one run |
| `dashboard` | Generate static run dashboard assets |
| `serve` | Serve `dashboard/` output over HTTP |
| `studio` | Launch Studio UI for multi-run browsing and analytics |
| `extract-agent` | Convert replay bundle to deterministic `ActionSequenceAgent` |
| `compare` | Diff two runs |
| `sweep` | Multi-seed run with aggregate report |
| `matrix` | Multi-variant + multi-seed run matrix |
| `types` | Generate TS ABI types from Foundry artifacts |

## `doctor`

```bash
forge-sim doctor [--json] [--check-llm]
```

- `--json`: emit machine-readable output.
- `--check-llm`: also inspect common provider env vars.

## `init`

```bash
forge-sim init [path] [--force] [--wizard] [--llm] [--llm-model <id>] [--llm-dry]
```

- `--wizard`: richer non-interactive starter template.
- `--llm`: generate contract-aware starter scaffolding from artifacts.
- `--llm-model`: model hint for generated examples.
- `--llm-dry`: scaffold only; skip live provider calls.

## `run`

```bash
forge-sim run [scenario] [options]
```

Primary options:

- `--toy`: run built-in toy scenario if no scenario path is supplied.
- `--toy-traders <n>`, `--toy-momentum <n>`, `--toy-holders <n>`, `--toy-chaos <n>`: toy composition.
- `--seed <n>`, `--ticks <n>`, `--tick-seconds <n>`: override scenario runtime knobs.
- `--out <dir>`: output root directory.
- `--output-path <path>`: exact output path (takes precedence over `--out`).
- `--run-id-suffix <suffix>`: append to run id.
- `--mode <mode>`: `deterministic`, `exploration`, or `replay`.
- `--replay-bundle <path>`: required for `--mode replay`.
- `--capture-memory`: write `agent_memory.ndjson`.
- `--memory-sample-every <n>`, `--memory-max-bytes <n|null>`: memory artifact controls.
- `--live --live-host <host> --live-port <port>`: enable live WS event stream.
- `--watch`: rerun when scenario file changes.
- `--fork-url <url>`: pass network fork URL to scenario/pack workflows.
- `--snapshot-every <n>`: scenario snapshot cadence.
- `--ci`, `--summary`, `--verbose`, `--json`: output/verbosity controls.

## `report`

```bash
forge-sim report <runDir> [--output <path>] [--json] [--no-git]
```

- Markdown report by default (`report.md` in run directory).
- JSON mode emits summary/config/hash metadata for automation.

## `dashboard`

```bash
forge-sim dashboard <runDir> [--output <dir>] [--no-git]
```

- Produces a static dashboard folder (`dashboard/` by default).
- For large runs, may emit sampled data and guidance to use Studio paging.

## `serve`

```bash
forge-sim serve <runDir> [--host <host>] [--port <port>] [--open] [--check]
```

- Serves `runDir/dashboard` over HTTP.
- `--check` starts, validates one request, then exits (CI-friendly).

## `studio`

```bash
forge-sim studio [--root <dir> ...] [--host <host>] [--port <port>] [--live] [--open] [--check]
```

- Multi-run UI with paging, report execution, and analytics endpoints.
- `--root` is repeatable to aggregate multiple result trees.
- `--live` enables proxying live run events to Studio clients.

## `extract-agent`

```bash
forge-sim extract-agent <replayBundle> [--agent-id <id>] [--output <path>]
```

- Writes deterministic action sequence agent source.
- Default output: `sim/generated/ExtractedAgent.ts`.

## `compare`

```bash
forge-sim compare <runA> <runB> [--output <path>] [--json] [--threshold <percent>]
```

- Produces KPI/action/revert diffs and determinism-hash comparison.

## `sweep`

```bash
forge-sim sweep [scenario] [--toy] [--seeds <range>] [--ticks <n>] [--out <dir>] [--parallel <n>] [--ci] [--verbose] [--json]
```

- Seed format supports:
  - range: `1..25`
  - list: `1,4,7`
  - count: `25` (interpreted as `1..25`)

## `matrix`

```bash
forge-sim matrix <scenario> [--variants <file>] [--seeds <range>] [--ticks <n>] [--out <dir>] [--ci] [--verbose] [--json]
```

- Runs each variant across each seed.
- Writes per-variant run folders plus `summary.csv` and `report.md`.

## `types`

```bash
forge-sim types [--dir <path>] [--out <path>] [--no-index] [--filter <pattern>] [--json]
```

- Extracts ABIs from Foundry artifacts and generates TypeScript types.

## Mode Guidance

- `deterministic`: seeded, CI-friendly, no live LLM calls.
- `exploration`: non-deterministic discovery mode; can emit replay bundles.
- `replay`: deterministic execution of a previously recorded exploration bundle.

## Key Run Artifacts

- `summary.json`
- `metrics.csv`
- `actions.ndjson`
- `config_resolved.json`
- `replay_bundle.json` (exploration)
- `gossip.ndjson` (if gossip enabled)
- `agent_memory.ndjson` (if memory capture enabled)
- `smoke_results.json` (if smoke checkpoints configured)
