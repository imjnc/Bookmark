---
name: code-hygiene
description: >
  Post-code verification, structural modularity, and lean-code enforcement pipeline.
  Runs format check, lint check, TypeScript/type check, dead/unused code audits, file line limits,
  single-line toggle modularity, and duplicate code prevention. Enforces Ponytail (smallest diff,
  zero unnecessary files, YAGNI) and Caveman (terse, fluff-free reporting). Use after writing or
  modifying code, or during code audits.
argument-hint: "[check|fix|strict]"
license: MIT
---

# Code Hygiene & Lean Gate

Autonomous post-code pipeline: enforce clean code, zero dead code, strict types, and absolute minimal diffs.

Two permanent operating rules:
1. **Ponytail Rule**: The best code is code never written. Smallest diff that fully solves the task. No extra files. No speculative abstractions. Deletion beats addition.
2. **Caveman Rule**: Terse voice. Fluff dead. Zero ceremony. Report facts, commands, and numbers directly. Save every token.

---

## The Verification Pipeline

Run these 5 checks after every code change:

```text
1. Format Check ──> 2. Lint Check ──> 3. Type/TS Check ──> 4. Dead Code Audit ──> 5. Ponytail Gate
```

### Stage 1: Format Check
- **Goal**: Consistent style, indentation, quoting, and line breaks.
- **Action**: Check if `package.json` has `format` or `format:check`.
- **Command**: `npm run format:check` or `npx prettier --check .` (or `npx prettier --write .` on fix mode).
- **Rule**: Never reformat files untouched by the current task unless explicitly asked.

### Stage 2: Lint Check
- **Goal**: Catch syntax issues, logical traps, and antipatterns.
- **Action**: Check if `package.json` has `lint`.
- **Command**: `npm run lint` or `npx eslint . --ext .js,.ts,.tsx`.
- **Rule**: Zero linter errors allowed. Do not disable lint rules with inline comments unless documented with reason.

### Stage 3: Type & TypeScript Check
- **Goal**: Full type safety, zero compile errors, no implicit `any`.
- **Action**: Check if TypeScript config (`tsconfig.json`) exists.
- **Command**: `npx tsc --noEmit` or `npm run typecheck`.
- **Rule**:
  - All touched functions and interfaces must be type-sound.
  - No `// @ts-ignore` without justification.
  - Check export types match what callers expect.

### Stage 4: Unused Code & Dead Code Audit
- **Goal**: Zero unreachable branches, zero orphan files, zero unused imports or variables.
- **Checks**:
  - **Unused imports/variables**: Grep or linter unused-vars check. Remove immediately.
  - **Dead functions/classes**: Verify callers exist. If caller deleted, delete the function. Do not leave "for later".
  - **Orphan files**: If a file has 0 importers and is not an entry point, remove it.
  - **Dependencies**: Never keep packages in `package.json` that are not imported anywhere.
- **Rule**: Delete dead code directly. Never comment it out.

### Stage 5: Ponytail Lean Gate
- **Checklist before marking any task complete**:
  1. **Did I add unnecessary files?** If code fits in an existing file cleanly, keep it there. Do not spawn multi-file sprawl for simple logic.
  2. **Did I add unnecessary abstractions?** No wrappers, factories, or helper functions that have only one caller. Inline them.
  3. **Did I add speculative code?** No features, configs, or options nobody asked for.
  4. **Is the diff the shortest possible?** Verify line count. Deletions celebrated.
  5. **Did I test the critical path?** One small assert or test for non-trivial logic.

---

## Structural Integrity & Modular Architecture Rules

Every codebase modification must adhere to these 3 structural pillars:

### 1. Hard File Line Limits (Anti-Bloat Cap)
- **Line Limit Rule**: Keep all files concise and focused. Target maximum **150-200 lines** per file (absolute ceiling: **250 lines** for complex main entrypoints).
- If a file approaches or exceeds the limit, immediately decompose into focused sub-modules, routes, or components.
- Single Responsibility: One file = one distinct job. No monolithic files.
- Reject "kitchen sink" files (never allow a generic `utils.js` or `helpers.js` that accumulates unrelated logic).

### 2. Independent Modular Design (Single-Line Toggle)
- Modules must be loosely coupled and self-contained.
- **Single-Line Toggle Rule**: Disabling or commenting out a module/feature must only require commenting out **one line** (e.g. in `index.js`, router registration, or app setup).
- Disabling a module must never require editing multiple unrelated files or cause cascading import breaks.
- Dependency flow is always one-way (`main -> module`). Never create circular dependencies.

### 3. Strict Code Reuse (Search Before Writing)
- **Search Before Coding**: Before writing *any* helper, validator, parser, query, or utility, grep the codebase first.
- If identical or similar functionality already exists anywhere in the project, **import and reuse it**.
- Never create duplicate implementations across multiple files.
- If duplicate logic is discovered, immediately unify it into the existing utility module.

---

## Auto-Detection & Fallback Commands

If project lacks explicit scripts in `package.json`, inspect repository stack and execute standard tooling:

| Stack / Tool | Check Command | Auto-Fix Command |
|---|---|---|
| **TypeScript** | `npx tsc --noEmit` | N/A (fix type errors manually) |
| **ESLint** | `npx eslint .` | `npx eslint . --fix` |
| **Prettier** | `npx prettier --check .` | `npx prettier --write <files>` |
| **Knip (Dead Code)** | `npx knip` | Remove reported unused files/exports |
| **Python** | `ruff check .` / `mypy .` | `ruff check --fix .` / `ruff format .` |

---

## Reporting Style (Caveman Voice)

Output must follow Caveman rules:
- Answer first. No greeting, no apology, no fluff.
- Terse status lines with numbers.
- Example summary format:

```text
Hygiene check passed:
- Format: Clean
- Lint: 0 errors
- Types (tsc): 0 errors
- Dead code: 2 unused imports removed in server/routes.js
- Line limits: All touched files < 200 lines (longest: server/routes.js at 112 lines)
- Modularity: Feature self-contained (single-line toggle in server/index.js)
- Reuse: Reused existing authValidator (0 duplicate helpers created)
- Ponytail: 1 helper inlined, 0 extra files, net -14 lines
```
