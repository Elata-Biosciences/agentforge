# LLM, Gossip, and Exploration/Replay Workflow

This guide documents the exploration workflow for LLM-driven stress testing and deterministic replay.

## Terminology

- **Exploration/Replay workflow** is the preferred term for this feature set.
- **Mode C** is kept only as a legacy shorthand from early design notes.
- In CLI and docs, use explicit mode names: `deterministic`, `exploration`, `replay`.

## Modes

- `deterministic`: seeded simulation, no live LLM calls, best for CI baselines.
- `exploration`: enables LLM policy behavior, arbitrary red-team exploration, and trace capture.
- `replay`: loads a replay bundle and re-runs recorded behavior without calling an LLM.

## Canonical Working Example

Run the built-in canonical example:

```bash
# Live provider + non-deterministic exploration behavior
forge-sim run examples/llm-gossip/scenario.ts --mode exploration

# Deterministic baseline (no live provider calls)
forge-sim run examples/llm-gossip/scenario.ts --mode deterministic
```

When using `exploration`, configure one provider key first (examples below). The scenario posts
provider-generated messages into gossip channels so you can inspect behavior in Studio's Gossip and
Inspector views.

## When To Use Each Mode

- Use `deterministic` for reproducible baseline checks and non-LLM regression tests.
- Use `exploration` to discover exploit paths, behavior regimes, and adversarial hypotheses.
- Use `replay` after contract changes to validate whether previously discovered behaviors still reproduce.
- Typical loop: `deterministic` baseline -> `exploration` discovery -> `replay` regression on new versions.

## Exploration/Replay Workflow

1. Run exploration to discover behaviors:

```bash
forge-sim run sim/scenarios/my-scenario.ts --mode exploration
```

2. Capture `replay_bundle.json` from the run output directory.

3. Re-run deterministically against changed contracts:

```bash
forge-sim run sim/scenarios/my-scenario.ts --mode replay --replay-bundle sim/results/my-run/replay_bundle.json
```

If replay diverges from the recorded campaign, AgentForge fails fast with diagnostics.

## LLM Policy Notes

- Use provider credentials in runtime environment (examples below).
- LLM behavior is treated as exploratory policy synthesis.
- Replay mode is the deterministic enforcement layer for regression checks.
- The provider interface is pluggable, so the same scenario can run against multiple LLM backends.
- Persona loops support a two-stage plan-then-act cycle; if plan parsing fails, action parsing falls
  back to legacy single-shot behavior.
- Tick context can carry a capability manifest (`ctx.capabilities`) with tool/query/contract metadata.

### Provider Configuration Examples

OpenAI:

```bash
export OPENAI_API_KEY="..."
```

Anthropic:

```bash
export ANTHROPIC_API_KEY="..."
```

DeepSeek/Kimi (and similar) via OpenAI-compatible endpoints:

```bash
export OPENAI_COMPAT_BASE_URL="https://api.deepseek.com/v1"
export OPENAI_COMPAT_API_KEY="..."
export OPENAI_COMPAT_MODEL="deepseek-chat"
```

OpenRouter:

```bash
export OPENROUTER_API_KEY="..."
export OPENROUTER_MODEL="openai/gpt-4o-mini"
export OPENROUTER_APP_NAME="agentforge-validation"
export OPENROUTER_APP_URL="https://github.com/Elata-Biosciences/agentforge"
```

Gemini:

```bash
export GEMINI_API_KEY="..."
export GEMINI_MODEL="gemini-1.5-flash"
```

## Gossip Layer

The gossip bus supports:

- global and topic channels,
- direct/group channel semantics by membership,
- posting/read budgets per tick,
- delivery queue with optional latency/drop controls,
- free-form text payloads (no structured intent tags).

This allows bounded-information experiments without changing the deterministic kernel.

### Strategy Channels

Channels can be scoped to specific agent sets via `members`. This is useful for creating
LLM-only coordination channels where intelligent agents discuss strategy without flooding
deterministic agents that don't process gossip:

```typescript
gossip: {
  channels: [
    { id: 'global', members: 'all' },
    { id: 'strategy', members: ['LlmAgent-0', 'LlmAgent-1', 'LlmAgent-2'] },
  ],
  budgets: { maxPostsPerTick: 3, maxReadsPerTick: 10 },
}
```

### Trust Primitives

Each message carries an optional `credibilityPrior` (0-1) set by the posting agent.
Channels can optionally enforce:

- `postCooldownTicks`: deterministic cooldown between posts per agent per channel
- `minCredibilityPrior` / `maxCredibilityPrior`: clamps message `credibilityPrior` into a channel-defined range

Receiving agents can use credibility scores to weight information, enabling trust modeling,
misinformation experiments, and adversarial coordination studies.

For "external shocks" and controlled misinformation, use scheduled `gossip_inject` events (below) with low credibility.

## External Shocks (Scheduled Events)

Scenarios can inject deterministic events at specific ticks:

- `gossip_inject`: post a system message into a gossip channel (bypasses budgets/cooldowns)
- `world_overlay`: overlay additional keys into the observed world state for all agents (persists)
- `world_overlay_clear`: clear overlay keys (or clear all overlays)

Example:

```typescript
schedule: [
  { tick: 10, type: 'gossip_inject', payload: { channelId: 'global', text: 'stablecoin depegged', credibilityPrior: 0.9 } },
  { tick: 10, type: 'world_overlay', payload: { overrides: { shock_stablecoin: 'depeg' } } },
]
```

## Arbitrary Tx/RPC in Exploration

Exploration-only arbitrary contract and RPC interaction is policy-driven:

- contract targets must be scenario-allowlisted,
- `strict` RPC policy requires allowlisted methods,
- `aggressive` RPC policy allows any non-empty RPC method when no allowlist is provided.

Deterministic and replay modes reject live arbitrary execution.

## Smoke Testing Assumptions

Scenarios can define smoke checkpoints to perturb assumptions and emit divergence artifacts (`smoke_results.json`) for fragility analysis.

Example:

```typescript
smoke: {
  checkpoints: [
    {
      tick: 50,
      branchTicks: 20,
      perturbations: [
        { key: 'oracle_noise_sigma', value: 0.15 },
        { key: 'latency_multiplier', value: 2 },
      ],
    },
  ],
}
```

## Related Guides

- [Core Concepts](./concepts.md)
- [Portability](./portability.md)
