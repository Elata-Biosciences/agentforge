# Competitive Landscape (And Where AgentForge Fits)

This doc is a pragmatic map of the current smart contract testing + security tool landscape and
the niche AgentForge is designed to occupy.

The goal is not to replace existing tools. It is to create a repeatable workflow for:

- multi-actor behavior over time,
- exploit discovery in exploration runs,
- deterministic replay for regression after contract changes,
- artifacts that prove what happened.

## TL;DR Positioning

AgentForge sits between:

- unit/fuzz/invariant testing (good at local correctness properties), and
- production monitoring / incident response tooling (good at "what happened on mainnet").

AgentForge's wedge is: "LLM-only agents + record/replay" that produces reproducible exploit traces,
plus a dashboard that makes those traces inspectable.

## Foundry (forge test, fuzzing, invariants)

What Foundry is best at:

- Extremely fast tests and excellent developer loop.
- Fuzz tests to explore input space.
- Invariant testing (stateful fuzzing) to detect property violations across sequences of calls.
- Local Anvil dev chain and scripting.

Gaps (where AgentForge adds value):

- Multi-agent modeling (many actors with different goals) is not a first-class abstraction.
- "Discovery then replay" for a discovered behavior is not packaged as a workflow artifact.
- Run-level artifacts are not standardized around agent actions, messages, budgets, and replay bundles.

How to integrate with Foundry (best practice):

- Keep Foundry as the contract correctness layer (unit/fuzz/invariant).
- Use AgentForge for scenario-level emergent behavior and adversarial search, then replay bundles as
  regression tests after code changes.

## Echidna / Medusa (property-based fuzzing)

What they are best at:

- Security-focused property testing at scale.
- Finding invariant breaks and edge cases quickly with specialized fuzz engines.

Gaps (where AgentForge adds value):

- They are property-testing tools, not "agent behavior over time" tools.
- They do not try to model beliefs, partial observability, or bounded budgets.
- They do not provide "LLM exploration -> replay bundle -> deterministic re-run" as a core workflow.

Recommended usage:

- Use Echidna/Medusa/Foundry invariants for deep property validation.
- Use AgentForge to find realistic exploit sequences (or competitive strategies), record them, and replay them
  after contract updates.

## Static analyzers (Slither, Semgrep, CodeQL, etc.)

What they are best at:

- Quick, cheap detection of common patterns.
- CI-friendly, low-cost signals.

Gaps (where AgentForge adds value):

- Static tools find "potential" issues; they don't prove exploitability.
- No on-chain evidence or trace artifacts.

Recommended usage:

- Keep static analyzers in CI for cheap signal.
- Use AgentForge to generate exploit proofs and replay regression suites.

## Fork testing / production simulators (Tenderly, etc.)

What they're best at:

- Transaction simulation and traces on real networks.
- Deep introspection of execution traces.
- Excellent UI for debugging.

Gaps (where AgentForge adds value):

- Tenderly-like systems are transaction-centric, not run-centric.
- They don't provide agent scheduling, gossip, budgets, partial observability, or deterministic replay of agent decisions.
- They do not aim to be a library you embed into a protocol repo as an automated CI primitive.

AgentForge roadmap alignment:

- For local runs, optionally integrate a local explorer/tracer (Blockscout via scoutup, or Ethernal).
- Keep AgentForge as the run orchestrator and artifact writer; link txHash to external trace UIs when configured.

## Chaos Engineering (Chaos Monkey style)

Core best practices to borrow:

- Explicit steady-state hypothesis (what "healthy" means).
- Minimize blast radius; start small and iterate.
- Rollback and abort conditions.

AgentForge mapping:

- Use smoke checkpoints and controlled perturbations to stress assumptions.
- Emit divergence artifacts and highlight failures in reports/dashboard.

## The Differentiator: Reproducible LLM Exploration

LLMs are non-deterministic and can be expensive. If you cannot replay what they did, you cannot trust them.

AgentForge's workflow:

1. Exploration run (LLM-enabled): record decisions, tool calls, queries, and arbitrary executions.
2. Replay run (LLM-disabled): deterministically re-run the exact trace and fail loudly on divergence.

The "proof" layer:

- Every exploit detection should be backed by txHash/receipt evidence and post-condition checks.

## What “Great” Looks Like

If AgentForge is mission-ready, a protocol team can:

- run an LLM-only exploit campaign against v1,
- get clear exploit evidence and an inspectable timeline,
- replay the same bundle against v2 and watch the exploit disappear,
- keep those bundles as regression assets over time.

