# Contributing to AgentForge

Thank you for your interest in contributing to AgentForge! This document provides guidelines and information for contributors.

## Table of Contents

- [Development Setup](#development-setup)
- [Code Style](#code-style)
- [Testing Guidelines](#testing-guidelines)
- [Pull Request Process](#pull-request-process)
- [Project Structure](#project-structure)
- [Adding Features](#adding-features)

## Development Setup

### Prerequisites

- Node.js >= 18.0.0
- pnpm (recommended) or npm
- Git

### Getting Started

1. Clone the repository:

```bash
git clone https://github.com/wkyleg/agentforge.git
cd agentforge
```

2. Install dependencies:

```bash
pnpm install
```

3. Build the project:

```bash
pnpm build
```

4. Run tests to verify setup:

```bash
pnpm test
```

5. Try the CLI:

```bash
pnpm sim:toy
```

### Available Scripts

| Script | Description |
|--------|-------------|
| `pnpm build` | Compile TypeScript to JavaScript |
| `pnpm build:watch` | Watch mode compilation |
| `pnpm dev` | Run CLI in development mode with watch |
| `pnpm dev:cli` | Run CLI directly without watch |
| `pnpm test` | Run all tests |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm test:coverage` | Run tests with coverage report |
| `pnpm test:ui` | Open Vitest UI |
| `pnpm lint` | Check code with Biome |
| `pnpm lint:fix` | Auto-fix linting issues |
| `pnpm format` | Format code with Biome |
| `pnpm typecheck` | Type-check without building |
| `pnpm clean` | Remove build artifacts |
| `pnpm sim:toy` | Run toy simulation |
| `pnpm sim:doctor` | Run environment check |

## Code Style

We use [Biome](https://biomejs.dev/) for linting and formatting, not ESLint/Prettier.

### Key Rules

- **Single quotes** for strings
- **Semicolons** at end of statements
- **ES5 trailing commas** in arrays and objects
- **Imports** organized and sorted automatically
- **No unused variables** (errors, not warnings)
- **Template literals** preferred over string concatenation

### Running the Linter

```bash
# Check for issues
pnpm lint

# Auto-fix issues
pnpm lint:fix

# Format code
pnpm format
```

### TypeScript

- **Strict mode** is enabled - no implicit any, null checks required
- **Exact optional properties** - undefined must be explicit
- **No unchecked indexed access** - array access may return undefined
- Prefer `unknown` over `any`
- Use explicit return types for public functions
- Export types using `export type` when possible

## Testing Guidelines

### TDD Workflow (Required for Core Changes)

For simulation-kernel, replay, gossip, query, and LLM-policy work, follow this sequence:

1. Add or update tests first (`test/unit` and `test/integration`).
2. Run the smallest relevant test subset.
3. Implement code until tests pass.
4. Run full validation:
   - `pnpm typecheck`
   - `pnpm test`
   - `pnpm lint`

This keeps deterministic and replay guarantees from regressing.

### Test Structure

```
test/
├── unit/              # Unit tests for individual modules
│   ├── rng.test.ts
│   ├── scheduler.test.ts
│   ├── agent.test.ts
│   ├── engine.test.ts
│   └── ...
├── integration/       # Integration tests for CLI and full runs
│   ├── cli-doctor.test.ts
│   ├── cli-run-toy.test.ts
│   └── ...
└── mocks/            # Shared mock utilities
    ├── mockPack.ts
    ├── mockAgent.ts
    ├── mockLogger.ts
    ├── mockRpc.ts
    └── index.ts
```

### Writing Tests

Use Vitest for all tests:

```typescript
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

describe('MyModule', () => {
  beforeEach(() => {
    // Setup
  });

  afterEach(() => {
    // Cleanup
  });

  it('should do something', () => {
    expect(result).toBe(expected);
  });

  it('should handle edge case', async () => {
    await expect(asyncFn()).resolves.toBe(expected);
  });
});
```

### Using Mocks

```typescript
import {
  createMockPack,
  createMockLogger,
  MockAgent,
} from '../mocks/index.js';

const mockPack = createMockPack({
  initialMetrics: { value: 100 },
});

const logger = createMockLogger();
```

### Coverage Requirements

- Lines: 80%
- Functions: 80%
- Branches: 70%
- Statements: 80%

Run coverage report:

```bash
pnpm test:coverage
```

### Optional Real OpenAI Integration Test

By default, LLM integration tests use mocks. To run the live OpenAI test explicitly:

```bash
RUN_OPENAI_INTEGRATION_TEST=1 OPENAI_API_KEY=... pnpm test -- test/integration/llm-openai.optional.test.ts
```

This test is intentionally skipped unless both env variables are set.

## Pull Request Process

### Before Submitting

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make your changes** with clear, atomic commits

3. **Ensure all checks pass**:
   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm build
   ```

4. **Add/update tests** for your changes

5. **Update documentation** if needed

### Commit Messages

Use clear, descriptive commit messages:

```
type(scope): short description

Longer description if needed.

- Bullet points for multiple changes
- Reference issues: #123
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `test`: Adding or updating tests
- `chore`: Build process or auxiliary tool changes

### PR Description

Include:
- **Summary** of changes
- **Motivation** for the change
- **Testing** done
- **Screenshots** if applicable
- **Breaking changes** if any

### Review Process

1. Create PR against `main`
2. CI checks must pass
3. At least one approval required
4. Squash and merge preferred

## Project Structure

```
agentforge/
├── src/
│   ├── index.ts           # Main library exports
│   ├── cli/               # CLI implementation
│   │   ├── index.ts       # Entry point
│   │   ├── commands/      # Command implementations
│   │   └── ui/            # Output formatting
│   ├── core/              # Core library
│   │   ├── engine.ts      # SimulationEngine
│   │   ├── agent.ts       # BaseAgent
│   │   ├── types.ts       # Type definitions
│   │   ├── rng.ts         # Deterministic RNG
│   │   ├── scheduler.ts   # Agent scheduling
│   │   ├── metrics.ts     # Metrics collection
│   │   ├── artifacts.ts   # Output writing
│   │   ├── logging.ts     # Pino logging
│   │   ├── scenario.ts    # Scenario loading
│   │   ├── schemas.ts     # Zod validation
│   │   ├── errors.ts      # Error types
│   │   └── preconditions.ts # Action preconditions
│   ├── adapters/          # External integrations
│   │   ├── anvil.ts       # Anvil control
│   │   ├── foundry.ts     # Foundry detection
│   │   └── viem.ts        # Viem helpers
│   └── toy/               # Built-in toy simulation
│       ├── toyPack.ts
│       ├── toyAgents.ts
│       ├── toyScenario.ts
│       └── index.ts
├── test/
├── examples/
├── package.json
├── tsconfig.json
├── biome.json
└── vitest.config.ts
```

## Adding Features

### Adding a New CLI Command

1. Create command file in `src/cli/commands/`:

```typescript
import { Command } from 'commander';

export const myCommand = new Command('mycommand')
  .description('Description')
  .option('-f, --flag', 'Flag description')
  .action(async (options) => {
    // Implementation
  });
```

2. Register in `src/cli/index.ts`:

```typescript
import { myCommand } from './commands/mycommand.js';
program.addCommand(myCommand);
```

3. Add tests in `test/integration/cli-mycommand.test.ts`

### Adding a New Core Module

1. Create module in `src/core/`
2. Export from `src/index.ts`
3. Add unit tests in `test/unit/`
4. Update documentation

### Adding Agent Features

1. Modify `src/core/agent.ts`
2. Update tests in `test/unit/agent.test.ts`
3. Add examples in `examples/`
4. Update README agent authoring guide

## Questions?

- Open an issue for bugs or feature requests
- Start a discussion for questions or ideas
- Contact the maintainers

Thank you for contributing!
