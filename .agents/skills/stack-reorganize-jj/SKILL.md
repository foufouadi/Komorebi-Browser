---
name: stack-reorganize-jj
description: Analyze a range of local commits, and reorganize them to minimize latency and friction in the review and landing process. To achieve this, commits can be split, reordered, squashed / grouped, or even rewritten. In the final commit series / "patch stack", the codebase should build, lint, and test cleanly after every commit, and each individual commit should stand on its own.
when_to_use: Before a patch (or a patch series) is submitted for first review, if the user agrees to reorganization.
allowed-tools:
  - Bash(jj log:*),
  - Bash(jj show:*),
  - Bash(jj squash:*),
  - Bash(jj commit:*),
  - Bash(jj new:*),
  - Bash(jj describe:*),
  - Bash(jj rebase:*),
  - Bash(jj edit:*),
  - Bash(jj absorb:*),
  - Bash(jj restore:*),
  - Bash(jj file show:*),
  - Read,
  - Grep,
  - Glob
---

`docs/contributing/reviewable-patch-series.md` covers what a reviewable series
looks like: the goals, the sources of review friction, the strategies that
reduce them, the trade-offs involved, and a worked example. Read it first; this
skill covers the mechanics of carrying it out with jj.

# The contract

The goal is a patch series whose overall diff exactly matches the original overall diff. So resist the temptation to switch approaches; if the temptation is unbearable, ask the user for permission first. For cosmetic differences, you can have a "residue" patch at the end of the series which makes the diffs match, but which the user is free to abandon.

Sometimes the series should span multiple Bugzilla bugs (see the doc's "Multiple bugs"). You can use "Bug TBF-consolidate-rdm-styles - [...]" placeholders in the commit message (TBF = to-be-filed). When done, give the user a list of bugs that need to be filed prior to patch submission, and let them know which placeholders they will need to substitute.

# Mechanics

This skill has two phases: 1. Envision, and 2. Execute.

## Phase 1: Envision

### Preconditions

Before you start, ensure a clean starting state with no uncommited changes and no conflicts in the original commit series. If the repo is a jj (Jujutsu) repo, run `jj st` and `jj log -r 'main..@'`. Also note the current op-id (`jj op log -n1`) so you can `jj op restore` if anything goes sideways.

Then follow these steps:

1. If the original commit series is small, do a quick review of the original commit series. If it's clear that the patches are already clean, well-ordered, and ready for review, you're done.
2. Remember how to get the overall diff of the original commit series. E.g. `jj diff --git --from oty --to yuxp --at-op aab4`
3. Make a list of the original commits. For each commit:
  - List which files are touched by the commit
  - List which "logical units" the patch consists of. E.g. individual cleanups, orthogonal behavior changes, plumbing, refactors.
4. The hard part: Brainstorm various orderings of the logical units, regardless of what original commit the unit of change was originally part of. Here you create a fresh "origin story" for the final state, and this new origin story should satisfy all the goals above. This process can sometimes some time. One challenge is that you need to keep many different states of the code base in your head at the same time. For example, comments in earlier patches can't refer to concepts that only get introduced in later patches, because that would create a non-sensical intermediate state.
5. Settle on an ideal organization, think of commit messages.

Example:
- Commits A, B, C with logical units `A: [M, N, O], B: [P], C: [Q, R, S]`.
- Settled on ideal organization: `R, M, Q, P, [N, O], S`.

## Phase 2: Execution

Once you know where you want to go, it's just a matter of creating the right commits with the right commit message and the right content. For small commits it can make sense to just rewrite them from scratch. For larger commits you'll want tool assistance.

This section describes what to do if you're in a Jujutsu (jj) repository. If the user is not using jj, good luck and try your best.

You can choose to either mutate the original changes, or you can duplicate changes so that the original changes are still around to quickly compare against. If you mutate the original changes, you can use `--at-op=<operation-id>` with any jj command to simulate a previous state of the repository.

When you're done with everything, make sure the current jj change is an empty change on top of the last commit (`jj new`). In general, prefer `jj new; make changes; jj squash` over `jj edit` so that you can use `jj diff` while you're working to see just the changes you made - if you instead used `jj edit vwx; make changes; jj diff`, it will give you the combined diff of vwx + your local changes, which is often not what you want.

At the end, run `jj fix`. This will run ./mach lint --fix on every commit in parallel and make sure lint passes after every commit.

`jj describe -r <change> -m <commit-message>` sets the commit message for a change.
`jj commit -m <msg>` is a shortcut for `jj describe -m <msg> && jj new`
`jj rebase -r <single-change> -d <new-parent>` moves a single change.
`jj rebase -s <subtree-root> -d <new-parent>` moves a subtree.
`jj rebase -r <single-change> --before <new-child>` or `jj squash --from <change> --insert-before <new-child>` can be used to reorder.
`jj new <conflicted-change>; <address conflicts>; jj squash` can be used to resolve conflicts.
`jj squash --from <one-or-more-changes> --into <dest-change> [FILESET]` can be used to combine changes. Pass `-u` (use destination's description) or `-m "..."` to skip the description editor when both source and destination have descriptions.
`jj squash --from X --insert-before <target> FILESET` extracts FILESET from X into a new commit before `<target>`. This is the swiss army knife for splitting and relocating:
  - `--insert-before X` → FILESET goes into a new parent of X (split, FILESET first).
  - `--insert-before <child-of-X>` → FILESET goes into a new child of X (split, FILESET second).
  - `--insert-before <some-distant-commit>` → FILESET is relocated elsewhere in the stack (the "land-early nugget" case).
  Prefer this over `jj split`, which is a less general subset.
`jj absorb -f <change>` is the fastest way to fold a refactor commit back into its ancestors: each modified line goes to the closest mutable ancestor that last touched it. Anything attributable only to immutable code (e.g. `main`) stays behind in `<change>` as a residue, which can then be squashed manually. Try this first when "fold C4 into C2 and C3"-style work is needed.
`jj restore --from <rev> [paths]` pulls file content from another revision into the working copy without launching an editor.
`jj file show -r <rev> <path>` prints the file's content at `<rev>` to stdout — useful for snapshotting "final state" into a temp file before you rewrite history, so you can later restore or diff against it without checking out the revision.

For guidance on splitting commits, check the `stack-split-jj` skill.

`jj op log` plus `jj op restore <op-id>` lets you undo cleanly after mutating commits; `jj --at-operation <op>` peeks at (or even mutates) prior states without disturbing current work.

### Avoiding interactive tools

Avoid running `jj diffedit`, `jj split` (without paths), and `jj squash -i` - these all open a diff editor and aren't usable from a non-interactive shell.
