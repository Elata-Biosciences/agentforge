# CI Integration

AgentForge is designed for continuous integration workflows. This guide covers exit codes, CI mode, and artifact handling.

## Exit Codes

AgentForge uses standard exit codes to communicate results:

| Code | Meaning | Description |
|------|---------|-------------|
| `0` | Success | All assertions passed |
| `1` | Assertion Failure | One or more assertions failed |
| `2` | Infrastructure Error | Setup failure, file not found, etc. |

## CI Mode

Enable CI mode with the `--ci` flag or `CI=true` environment variable:

```bash
forge-sim run sim/scenarios/stress.ts --ci --seed 42
```

CI mode changes behavior:

- **No colors**: Plain text output for log parsing
- **Stable run IDs**: Uses `<scenario>-ci` instead of timestamps
- **Strict exit codes**: Failures exit immediately with code 1

## Basic CI Setup

### GitHub Actions

```yaml
name: Simulations

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  simulate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          
      - name: Install dependencies
        run: npm ci
        
      - name: Run simulations
        run: npx forge-sim run sim/scenarios/stress.ts --ci --seed 42
        
      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: simulation-results
          path: sim/results/
```

### GitLab CI

```yaml
simulate:
  image: node:20
  script:
    - npm ci
    - npx forge-sim run sim/scenarios/stress.ts --ci --seed 42
  artifacts:
    when: always
    paths:
      - sim/results/
```

### CircleCI

```yaml
version: 2.1
jobs:
  simulate:
    docker:
      - image: cimg/node:20.0
    steps:
      - checkout
      - run: npm ci
      - run: npx forge-sim run sim/scenarios/stress.ts --ci --seed 42
      - store_artifacts:
          path: sim/results
```

## Multi-Scenario Runs

Run multiple scenarios in CI:

```yaml
- name: Run stress tests
  run: |
    npx forge-sim run sim/scenarios/stress.ts --ci --seed 42
    npx forge-sim run sim/scenarios/edge-cases.ts --ci --seed 42
```

Or use the sweep command for seed variation:

```yaml
- name: Seed sweep
  run: npx forge-sim sweep sim/scenarios/stress.ts --seeds 1..50 --ci
```

Or use matrix runs for multi-variant checks:

```yaml
- name: Variant matrix
  run: npx forge-sim matrix sim/scenarios/stress.ts --variants sim/variants.ts --seeds 1..5 --ci
```

## Comparing Runs

Use the compare command to diff runs:

```yaml
- name: Compare with baseline
  run: |
    npx forge-sim run sim/scenarios/stress.ts --ci --seed 42 --out sim/results/current
    npx forge-sim compare sim/baseline/stress-ci sim/results/current/stress-ci
```

## Generating Reports

Generate reports for CI artifacts:

```yaml
- name: Generate reports
  run: |
    npx forge-sim run sim/scenarios/stress.ts --ci --seed 42
    npx forge-sim report sim/results/stress-ci
```

Generate static dashboards when you need artifact UIs:

```yaml
- name: Build dashboard
  run: npx forge-sim dashboard sim/results/stress-ci
```

## Artifact Structure

After a CI run, artifacts are organized as:

```
sim/results/
└── stress-ci/
    ├── summary.json
    ├── metrics.csv
    ├── actions.ndjson
    ├── config_resolved.json
    └── report.md
```

## Handling Failures

Failed assertions produce exit code 1. To capture failures:

```yaml
- name: Run simulation
  id: simulate
  continue-on-error: true
  run: npx forge-sim run sim/scenarios/stress.ts --ci --seed 42

- name: Check results
  if: steps.simulate.outcome == 'failure'
  run: |
    echo "Simulation failed - checking assertions"
    cat sim/results/stress-ci/summary.json | jq '.failedAssertions'
```

## JSON Output

For programmatic processing, use `--json`:

```yaml
- name: Run simulation
  run: |
    npx forge-sim run sim/scenarios/stress.ts --ci --seed 42 --json > result.json
    echo "Success: $(jq '.success' result.json)"
```

## Doctor Check

Run doctor before simulations to verify environment:

```yaml
- name: Check environment
  run: |
    npx forge-sim doctor --json > doctor.json
    if [ $(jq '.allPassed' doctor.json) != "true" ]; then
      echo "Environment check failed"
      exit 1
    fi
```

## Best Practices

1. **Pin seeds**: Always specify seeds for reproducibility
2. **Upload artifacts**: Capture results even on failure
3. **Use CI mode**: Stable naming makes artifact comparison easier
4. **Generate reports**: Include report.md for human review
5. **Compare runs**: Use compare command to detect regressions
6. **Sweep critical scenarios**: Run multiple seeds for confidence

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CI` | Set to `true` to enable CI mode automatically |
| `FORGE_SIM_OUT` | Default output directory |
| `AGENTFORGE_AUTONOMOUS_RPC_POLICY` | Exploration RPC policy override (`strict` or `aggressive`) |
| `AGENTFORGE_DISABLE_AUTONOMOUS_RPC` | Disable autonomous exploration RPC when set to `1` |

## Troubleshooting

### Simulation hangs

Add timeout to CI job and check for infinite loops in agents.

### Different results locally vs CI

Ensure same Node.js version and seed. Check for non-deterministic code in pack or agents.

### Out of memory

Large simulations may need more memory:

```yaml
env:
  NODE_OPTIONS: --max-old-space-size=4096
```
