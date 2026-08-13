---
name: update-project-documentation
description: Maintain compact, source-linked documentation as a memory bank for future agents. Use after every change to code, configuration, schemas, data, tooling, deployment, or workflows; when a task reveals a non-obvious project behavior, recurring mistake, decision, invariant, or operational lesson; when documentation drift or bloat is suspected; or when documentation is created, reviewed, consolidated, or corrected. Read the complete documentation set in a fresh context, update affected knowledge in the same change, verify changed documents proportionately, and explicitly report when there is no documentation impact.
---

# Update Project Documentation

Preserve a compact and accurate project memory that lets a fresh agent understand the system, avoid known mistakes, and
locate authoritative source quickly.

## Load the Complete Memory

1. Read every applicable `AGENTS.md` file.
2. List every human-maintained document with `find docs -type f -name '*.md' -print | sort`.
3. Measure the documentation set with `find docs -type f -name '*.md' -print0 | xargs -0 wc -l -w` so read strategy
   and growth remain visible.
4. Read every listed document before assessing or editing documentation, and track each path until its end of file is
   confirmed.
   - Use the parallel fast path when every document is at most 240 lines and the complete set is at most 8,000 words:
     launch one bounded read command per document concurrently in the same orchestration call (for example with
     `Promise.all`). Keep every returned record labeled by path and inspect its output and exit status independently;
     do not concatenate documents inside one shell stream. Set the orchestration output budget above the measured
     aggregate size (20,000 tokens is appropriate for the fast-path limit).
   - Confirm that every parallel command succeeded and that its requested range reaches the measured line count. If any
     result is truncated, missing, or does not reach the expected final line, re-read that document sequentially from
     the last confirmed line.
   - Outside the fast path, read one document per tool result and page large documents through bounded ranges, such as
     `sed -n '1,240p'` followed by `sed -n '241,480p'`, until the final range reaches EOF.
   - Treat this complete read as the baseline for the current context. After a document changes, re-read that document
     to confirmed EOF; unchanged documents retain their baseline read. Reload the complete set only when a trigger under
     [Verify Documentation Efficiently](#verify-documentation-efficiently) applies.
   - Do not substitute an index-only read, a task-specific excerpt, hashes, summaries, or output redirected away from
     the model context.
5. Inspect `git status --short`, the complete relevant staged and unstaged diffs, and changes already present in the
   worktree. List untracked files with `git ls-files --others --exclude-standard` and read every relevant untracked
   file; ordinary `git diff` output does not include them. Preserve unrelated user changes.

Treat the full read, or a qualifying current-context read, as required context. Use `docs/README.md` as the index and
ownership map, not as a substitute for reading the other documents.

## Trace the Implemented Change

1. Identify the active entry point, callers, routes, schemas, tests, scripts, and persistence paths affected by the
   change.
2. Verify that plausible-looking files are active before documenting them. Search imports, registrations, references,
   and generated outputs rather than inferring authority from names or locations.
3. Resolve conflicting claims in this order:
   - Executable code, schemas, migrations, configuration, and package scripts.
   - Tests and validators that demonstrate supported behavior.
   - Generated contracts for inspection only.
   - Existing human documentation.
4. Distinguish implemented behavior from intended policy. Treat `AGENTS.md` as policy and change it only when the user
   intends to change project rules.
5. Distinguish current limitations from deliberate design. Do not use words such as `intentional` or `deliberate`
   without evidence.

## Preserve Useful Memory

Record knowledge when it is durable, project-specific, and useful to a future agent. Prefer:

- Product behavior and domain invariants.
- Component ownership, runtime flows, and persistence boundaries.
- Contracts between ClientRN, ServerNodeJS, generated artifacts, data, and deployment.
- Authentication, authorization, privacy, security, migration, backup, and recovery constraints.
- Non-obvious active or inactive paths that could lead an agent to edit the wrong place.
- Failure modes, verification requirements, and operational lessons with meaningful consequences.
- Decisions and rationale that future maintainers could reasonably revisit.

Do not turn documentation into a mirror of the repository. Exclude:

- Exhaustive file trees, endpoint lists, dependency lists, schema fields, environment reads, or command inventories that
  source and generated artifacts already express clearly.
- One-off debugging history, chronological mistake logs, temporary status, timestamps, and resolved incidents.
- Obvious implementation mechanics that an agent can recover quickly from the linked source.
- Speculation presented as future behavior.
- Secret values or copied `.env` contents.

Link to the authoritative file, schema, script, test, or generated contract whenever it is more durable than duplicating
mechanics. Explain why a boundary matters and what must remain true.

## Prevent Repeated Mistakes

When work exposes a mistake or surprising behavior, handle it in this order:

1. Prevent it with types, tests, validation, fail-fast behavior, or a clearer code boundary when practical.
2. Put broad mandatory engineering policy in the root `AGENTS.md` when the user intends that policy.
3. Document the remaining project-specific reasoning, trap, or limitation in the existing topic that owns it.

Capture a lesson only when it is non-obvious, likely to recur, materially costly, and still true after the change. Write
it as a current actionable fact, invariant, or warning. Do not narrate who made the mistake or preserve incident
history.

Remove or rewrite a warning when code, tests, or architecture eliminate the underlying problem. Do not preserve stale
cautions as folklore.

## Report Observed Workflow Friction

Treat this skill as an evolving workflow and report actionable friction caused by its instructions when it is observed
during normal use. Mention feedback only when the issue actually occurred in the current task or is supported by
repeated experience in the current context, and when it caused meaningful delay, duplicate work, ambiguity, noisy
output, or correctness risk. Do not pause the task to audit the skill, invent hypothetical edge cases, report minor
preferences, or attribute unrelated task and environment difficulties to the skill.

When qualifying friction exists, add a concise `Skill feedback` note to the final response that states the observed
behavior, its practical impact, and a specific improvement. Limit feedback to the few material issues actually
observed, and do not modify the skill automatically unless the user requested that change. When no qualifying issue was
observed, omit skill feedback entirely; do not add a placeholder or claim that no issues were found.

## Keep the Memory Compact

Store all human-maintained project documentation under `docs/`. Keep the root `AGENTS.md`, `.agents/skills/`, generated
OpenAPI/type artifacts, deployed artifacts, and runtime assets outside `docs/`. Do not create component READMEs or
nested `AGENTS.md` files for implementation knowledge.

Maintain these constraints:

- Write all explanatory prose in English. Retain exact non-English identifiers, source-data fields, or user-facing
  examples only when translation would be technically incorrect.
- Give each durable claim one canonical owner. Replace stale text instead of appending contradictory notes.
- Add a document only when no existing document can own the topic without losing clarity.
- Consolidate or remove duplicated and source-repeated content before expanding the memory bank.
- Keep `docs/README.md` synchronized with every document addition, removal, rename, or move.
- Keep the entire documentation set practical as mandatory reading. Treat material word-count growth as a design issue
  and justify it with durable knowledge, not convenience.
- Use relative documentation links and kebab-case filenames.

## Update After Every Change

1. Compare the implementation and complete diff with the full documentation memory.
2. Identify every document affected directly or indirectly. Consider product, architecture, development, contracts,
   security, data, operations, and known traps across component boundaries.
3. Decide whether the lesson belongs in code/tests, `AGENTS.md`, documentation, or a combination. Prefer enforceable
   safeguards over prose-only warnings.
4. Update current behavior, invariants, reasoning, workflows, and source pointers in the same change.
5. Remove obsolete claims, resolved warnings, and duplicated detail encountered in affected topics.
6. Update `docs/README.md` ownership or impact routing when document responsibilities change.
7. Avoid cosmetic edits when no durable knowledge changed.

## Verify Documentation Efficiently

1. Re-read each added or edited document to confirmed EOF after the final documentation edit. Batch edits first so a
   minor follow-up correction does not cause duplicate reads.
2. Inspect `docs/README.md` when document ownership, impact routing, or the documentation inventory may have changed.
   Search references to changed paths, terms, commands, and claims across `docs/`; read the relevant surrounding
   documents when the search exposes a possible contradiction.
3. Reload every document under `docs/` only when at least one of these triggers applies:
   - A document was added, removed, renamed, or moved.
   - Ownership or a durable claim changed across multiple documentation topics.
   - The task changed multiple product, architecture, data, security, operations, or development boundaries.
   - The complete baseline read is absent from the current context.
   - External or user changes make the documentation inventory or baseline state uncertain.
   Use the bounded procedure from [Load the Complete Memory](#load-the-complete-memory) and confirm EOF for every path.
4. Do not reload unchanged documents solely because code, configuration, tooling, workflow, or one owning document
   changed. When no durable documentation update is needed, confirm the inventory and documentation worktree state are
   unchanged, retain the baseline read, and report `Documentation impact: none`.
5. Re-check every changed claim against active implementation and tests.
6. Confirm new lessons are actionable current facts rather than historical narration or unsupported intent.
7. Confirm commands state prerequisites and working directories. Give risky procedures verification and recovery
   guidance.
8. Never manually edit generated OpenAPI schemas or generated API type declarations. Run the project generator when
   contracts change and review every generated copy.
9. Run documented safe commands with timeouts when practical. Inspect definitions instead of executing destructive,
   stateful, production, deployment, backup, restore, or expensive commands unless the task requires them.
10. Run `node .agents/skills/update-project-documentation/scripts/validate-docs.mjs` from the repository root.
11. Run `git diff --check` and review the final diff for unrelated churn, secrets, stale warnings, and documentation
   growth without corresponding durable value.

Finish by naming documents added, updated, consolidated, moved, or removed and why. State which relevant commands were
not executed. If no durable project knowledge changed, report `Documentation impact: none` only after completing the
impact assessment against a full or qualifying current-context read.
