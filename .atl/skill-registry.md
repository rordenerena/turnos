# Skill Registry

**Delegator use only.** Any agent that launches sub-agents reads this registry to resolve compact rules, then injects them directly into sub-agent prompts. Sub-agents do NOT read this registry or individual SKILL.md files.

See `_shared/skill-resolver.md` for the full resolution protocol.

## User Skills

| Trigger | Skill | Path |
|---------|-------|------|
| When creating a pull request, opening a PR, or preparing changes for review. | branch-pr | /home/rorden/.config/opencode/skills/branch-pr/SKILL.md |
| When creating a GitHub issue, reporting a bug, or requesting a feature. | issue-creation | /home/rorden/.config/opencode/skills/issue-creation/SKILL.md |
| When writing Go tests, using teatest, or adding test coverage. | go-testing | /home/rorden/.config/opencode/skills/go-testing/SKILL.md |
| When user says "judgment day", "judgment-day", "review adversarial", "dual review", "doble review", "juzgar", "que lo juzguen". | judgment-day | /home/rorden/.config/opencode/skills/judgment-day/SKILL.md |
| When user asks to create a new skill, add agent instructions, or document patterns for AI. | skill-creator | /home/rorden/.config/opencode/skills/skill-creator/SKILL.md |

## Compact Rules

Pre-digested rules per skill. Delegators copy matching blocks into sub-agent prompts as `## Project Standards (auto-resolved)`.

### branch-pr
- Every PR MUST link an approved issue and include exactly one `type:*` label.
- Branch names MUST match `type/description` using lowercase `a-z0-9._-` only.
- Use conventional commits only; no `Co-Authored-By` trailers.
- Follow the PR template: linked issue, single PR type, summary, changes table, test plan, checklist.
- Run required validation for modified shell scripts before opening the PR.

### issue-creation
- Never open blank issues; always use the bug-report or feature-request template.
- Search for duplicates first, then fill all required fields and pre-flight checkboxes.
- New issues start with `status:needs-review`; implementation waits for `status:approved`.
- Questions belong in Discussions, not Issues.
- Use conventional-commit style issue titles like `fix(scope): ...` or `feat(scope): ...`.

### go-testing
- Prefer table-driven tests for Go logic with named cases and explicit error expectations.
- Test Bubbletea state changes through `Model.Update()` and full flows with `teatest`.
- Use golden files only for stable visual output and store them under `testdata/`.
- For side effects, mock dependencies; for filesystem work, use `t.TempDir()`.
- Cover success and failure paths explicitly instead of relying on ad-hoc manual testing.

### judgment-day
- Before launching judges, resolve relevant compact rules from this registry and inject them identically.
- Run two blind review agents in parallel; neither judge knows about the other.
- Classify findings as `CRITICAL`, `WARNING (real)`, `WARNING (theoretical)`, or `SUGGESTION`.
- Fix only confirmed issues, then re-judge; after two iterations, ask the user before continuing.
- If no registry exists, warn and fall back to generic review standards.

### skill-creator
- Create a skill only for reusable, non-trivial patterns that need AI guidance.
- Use `skills/{skill-name}/SKILL.md` with full frontmatter and a trigger in `description`.
- Put templates/schemas in `assets/` and local doc pointers in `references/`.
- Keep examples minimal, focus on critical patterns, and avoid duplicate documentation.
- Register new skills in `AGENTS.md` after creation.

## Project Conventions

| File | Path | Notes |
|------|------|-------|
| — | — | No project-level convention files detected (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `GEMINI.md`, `copilot-instructions.md`). |

Read the convention files listed above for project-specific patterns and rules. All referenced paths have been extracted — no need to read index files to discover more.
