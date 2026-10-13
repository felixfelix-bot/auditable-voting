# Harness wasm/core dependency + staleness detection

**Task:** document precisely what the harness needs from `auditable-voting-core`, whether the
prebuilt wasm under `web/src/wasm/` is sufficient to run the harness end-to-end, and how
staleness of those prebuilt artifacts would be detected.
**Branch:** `feat/windowed-publication-clean`
**Author:** offload worker (independent investigation)
**Date (UTC):** 2026-10-13
**Repo HEAD inspected:** `10fbba1` (`origin/feat/windowed-publication-clean`)

Every command in this document was run on this machine in the working tree, or in a scratch
`git clone` of it. Command output is reproduced verbatim. Anything not directly observed is
explicitly labelled **[INFERENCE]** or **[SPECULATION]**.

---

## 1. TL;DR / verdict

| Question | Answer |
|---|---|
| What does the harness need from `auditable-voting-core`? | One Rust crate (`auditable-voting-core`, cdylib+rlib) compiled to wasm with `--features openmls-engine` by `wasm-pack`, landing at `web/src/wasm/auditable_voting_coordinator_core/pkg/`. Plus a second, separate crate `web/rust-core` (`auditable-voting-rust-core`) landing at `web/src/wasm/auditable_voting_core/pkg/`. Six files are consumed by name. |
| Is the sibling-repo blocker real? | **Partly — the card's premise is wrong for this tree.** `../auditable-voting-core` is absent *on this machine only because it is not a sibling*; the core source is **vendored inside this repo** at `auditable-voting-core/` (20 git-tracked files). From `web/`, `cd ../auditable-voting-core` resolves to that vendored copy, so `build:wasm:coordinator` **works in a fresh checkout**. |
| Is the prebuilt wasm sufficient to run the harness? | **Yes, end-to-end.** The artifact guard no-ops, no `wasm-pack` is needed, and the wasm-consuming tests pass: `CoordinatorControlService.test.ts` → **5/5 pass**, full suite → **523 passed / 49 failed** with **all 49 failures unrelated to wasm**. |
| Can a fresh worker rebuild from source? | **Yes** — a fresh clone rebuilt the coordinator core in **2m48s** and the result was **byte-identical** (sha256 `a8dea6b9…`, 2 660 339 B) to the checked-in-on-disk artifact. But two unrelated fresh-worker blockers exist (§6). |
| Recommended staleness mechanism | **Committed checksum manifest** (`web/src/wasm/wasm-artifacts.lock.json`) carrying a `sourceFingerprint` (git tree hash of the two crate source trees) + sha256 of each artifact + the build profile/toolchain, verified by a fast `scripts/verify-wasm-artifacts.mjs`, *replacing* the current mtime heuristic. |

---

## 2. Scope: what "the harness" is

There is no file literally named "harness". In this repo the term resolves to the
Vitest + Node/tsx test surface that exercises the client, driven by the npm scripts in
`web/package.json`. The scale-specific file `web/src/questionnaireScaleHarness.test.ts` is
one test inside it, not the whole thing.

[INFERENCE] The harness = `cd web && npm test` (Vitest, `src/**/*.test.{ts,tsx}`) plus the
Node/tsx live smoke scripts (`test:live-*`, `verify:simple-blind-shares`). All of these sit
behind the same `pretest*` / `preverify*` hook that guards the wasm artifacts.

---

## 3. What is required from `auditable-voting-core`

### 3.1 Two distinct wasm crates

The web app embeds **two** Rust crates, compiled independently to their own wasm packages:

| # | Crate (`package.name`) | Source location | npm script | Output dir | Feature flags |
|---|---|---|---|---|---|
| 1 | `auditable-voting-rust-core` | `web/rust-core/` | `build:wasm:legacy` | `web/src/wasm/auditable_voting_core/pkg/` | *(none)* |
| 2 | `auditable-voting-core` | `auditable-voting-core/` | `build:wasm:coordinator` | `web/src/wasm/auditable_voting_coordinator_core/pkg/` | `--features openmls-engine` |

Crate 2 is the "auditable-voting-core" dependency the card asks about. Crate 1 is its
lighter sibling and is **not** in a sibling repo at all.

### 3.2 What crate 2 needs from Cargo

Observed `auditable-voting-core/Cargo.toml`:

- `crate-type = ["cdylib", "rlib"]` — the `cdylib` is what `wasm-pack` consumes.
- `[package.metadata.wasm-pack.profile.release] wasm-opt = false` — so `wasm-opt` is **not**
  required; a plain `wasm-pack build` works without binaryen.
- Feature `openmls-engine` (default `[]`) pulls in the heavy optional deps: `openmls 0.8.1`
  (features `js`), `openmls_basic_credential 0.5.0`, `openmls_memory_keystore 0.2.0`,
  `openmls_rust_crypto 0.5.1`, `openmls_traits 0.5.0`, `base64 0.22`,
  `getrandom 0.2.17` (features `js`).
- Always-on deps: `serde`, `serde_json`, `serde-wasm-bindgen 0.6`, `thiserror 1.0`,
  `wasm-bindgen 0.2`.

`web/rust-core/Cargo.toml` needs only `bech32`, `chrono`, `js-sys`, `serde`,
`serde-wasm-bindgen`, `sha2`, `wasm-bindgen`.

**Consequence:** the `openmls-engine` feature is why build #2 is heavy (~2m48s cold) and build
#1 is light (~1m38s cold). Any staleness/build guard must treat the two separately.

### 3.3 The exact npm scripts

```jsonc
// web/package.json
"build:wasm": "npm run build:wasm:legacy && npm run build:wasm:coordinator",
"build:wasm:legacy": "cd rust-core && wasm-pack build --target bundler --out-dir ../src/wasm/auditable_voting_core/pkg",
"build:wasm:coordinator": "cd ../auditable-voting-core && wasm-pack build --target bundler --out-dir ../web/src/wasm/auditable_voting_coordinator_core/pkg -- --features openmls-engine",
"predev": "node scripts/ensure-wasm-artifacts.mjs",
"prebuild": "node scripts/ensure-wasm-artifacts.mjs",
"pretest": "node scripts/ensure-wasm-artifacts.mjs",
// …+ 8 more pretest*/preverify* hooks that all call the same script
```

Note `build:wasm:coordinator` runs `cd ../auditable-voting-core` **from `web/`** — i.e. it
expects the core at `<repo>/auditable-voting-core`, *not* at `../auditable-voting-core`
relative to the repo root.

### 3.4 The six artifacts consumed by name

`web/scripts/ensure-wasm-artifacts.mjs` requires exactly these to exist:

```
web/src/wasm/auditable_voting_core/pkg/auditable_voting_rust_core.js
web/src/wasm/auditable_voting_core/pkg/auditable_voting_rust_core_bg.js
web/src/wasm/auditable_voting_core/pkg/auditable_voting_rust_core_bg.wasm
web/src/wasm/auditable_voting_coordinator_core/pkg/auditable_voting_core.js
web/src/wasm/auditable_voting_coordinator_core/pkg/auditable_voting_core_bg.js
web/src/wasm/auditable_voting_coordinator_core/pkg/auditable_voting_core_bg.wasm
```

(Each `pkg/` also contains `.d.ts`, `.wasm.d.ts`, `package.json` — not name-checked but
needed by TS.)

Import sites that bind the app to those paths:

- `web/src/wasm/auditableVotingCore.ts:23` → `./auditable_voting_core/pkg/auditable_voting_rust_core`
- `web/src/core/wasmLoader.ts:5` → `../wasm/auditable_voting_coordinator_core/pkg/auditable_voting_core`
  (loaded lazily through `loadCoordinatorCoreModule` / `loadProtocolCoreModule`, consumed by
  `web/src/core/coordinatorCoreAdapter.ts` and `web/src/core/derivedStateAdapter.ts`)

---

## 4. Correction: the "absent sibling repo" premise

**Claim on the card:** `build:wasm:coordinator` references a sibling repo `../auditable-voting-core`
which is ABSENT on this machine.

**Observed:**

```
$ ls -la /home/c03rad0r/repos/auditable-voting-core
ls: cannot access '/home/c03rad0r/repos/auditable-voting-core': No such file or directory
```

```
$ ls auditable-voting-core/            # at the repo root
auditable-voting-core/target/          # ignore-listed build dir
auditable-voting-core/Cargo.toml
auditable-voting-core/Cargo.lock
auditable-voting-core/src/lib.rs
auditable-voting-core/src/coordinator_state.rs
auditable-voting-core/src/openmls_engine.rs
… (17 more .rs files)
```

```
$ git ls-files auditable-voting-core | wc -l
20
$ cat .gitmodules
(no .gitmodules)
```

So `auditable-voting-core` is **vendored into the repository** (20 git-tracked files; there is
no submodule). The path `../auditable-voting-core` in the npm script is written relative to
`cd web`, not relative to the repo root, so it resolves correctly:

```
$ cd /home/c03rad0r/av-fresh-sim/web && npm run build:wasm:coordinator
> cd ../auditable-voting-core && wasm-pack build --target bundler …   # resolves to <repo>/auditable-voting-core ✔
```

**There is no sibling-repo dependency to fix.** The genuine fragility is that
`build:wasm:coordinator` is *cwd-sensitive*: run from the repo root (`cd auditable-voting-core`
instead of `cd web && …`) or from `web/` when the vendored tree has been deleted, and it
breaks. Two failure modes were captured verbatim.

### 4.1 Observed error — the core directory is missing (the card's stated scenario)

Simulated with the exact script body from a directory with no `../auditable-voting-core`:

```
$ sh -c 'cd ../auditable-voting-core && wasm-pack build --target bundler --out-dir ../web/src/wasm/auditable_voting_coordinator_core/pkg -- --features openmls-engine'
sh: 1: cd: can't cd to ../auditable-voting-core
EXIT=2
```

`npm` wraps that as: `npm error code 2 — sh: 1: cd: can't cd to ../auditable-voting-core`.
Note this fails **before** `wasm-pack` is ever invoked, so it is a distinct error from §6(b).

### 4.2 Observed error — `wasm-pack` not on PATH (the *actual* failure on a fresh box)

This is what fails in the real working tree:

```
$ cd web && npm run build:wasm:coordinator
sh: 1: wasm-pack: not found
EXIT=127
```

Full observed output:

```
> auditable-voting-web@0.1.166 build:wasm:coordinator
> cd ../auditable-voting-core && wasm-pack build --target bundler --out-dir ../web/src/wasm/auditable_voting_coordinator_core/pkg -- --features openmls-engine

sh: 1: wasm-pack: not found
```

---

## 5. Is the prebuilt wasm sufficient to run the harness? — **Yes**

But first, a correction that changes what "prebuilt" even means here.

### 5.1 The prebuilt artifacts are NOT committed — they are machine-local

```
$ git ls-files web/src/wasm/
web/src/wasm/auditableVotingCore.mock.ts
web/src/wasm/auditableVotingCore.ts
$ git ls-files 'web/src/wasm/*pkg*' | wc -l
0
$ git check-ignore -v web/src/wasm/auditable_voting_coordinator_core/pkg/auditable_voting_core_bg.wasm
.gitignore:43:web/src/wasm/auditable_voting_coordinator_core/pkg/   web/…/auditable_voting_core_bg.wasm
```

They are ignored **twice**: root `.gitignore` lines 42–43 and a `wasm-pack`-generated
`.gitignore` containing a bare `*` inside each `pkg/` directory. A fresh clone therefore has
**no** `pkg/` at all:

```
$ cd <fresh clone>/web && ls src/wasm/auditable_voting_core/pkg
ls: cannot access 'src/wasm/auditable_voting_core/pkg': No such file or directory
```

[INFERENCE] The `.mjs` guard was added precisely because the artifacts cannot be committed in
their current locations.

Consequence: the artifacts present on this machine exist only because someone built them here
on 2026-09-09. They are an *untracked local cache*, so "are the prebuilt artifacts sufficient?"
strictly means: *given artifacts produced by an equivalent build, is a rebuild needed to run
the harness?*

### 5.2 Evidence — the guard no-ops

```
$ cd web && node scripts/ensure-wasm-artifacts.mjs
$ echo $?
0
```

Zero output, exit 0, no build spawned. (PATH deliberately did **not** include `~/.cargo/bin`,
so `wasm-pack` was genuinely unavailable.)

### 5.3 Evidence — the wasm-consuming harness passes with zero rebuild

```
$ cd web && npx vitest run src/services/CoordinatorControlService.test.ts

 RUN  v4.1.2 /home/c03rad0r/repos/auditable-voting/web

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Duration  5.11s (transform 2.52s, setup 642ms, import 212ms, tests 3.74s, environment 0ms)
```

`CoordinatorControlService.test.ts` is the test that actually mounts the coordinator wasm
through `src/core/coordinatorCoreAdapter.ts`, i.e. the real artifact path — not the mock.

### 5.4 Evidence — full harness baseline

```
$ cd web && npm test          # runs pretest guard (no-op) then vitest run
 Test Files  3 failed | 64 passed (67)
      Tests  49 failed | 523 passed (572)
   Duration  225.40s
```

All 49 failures are in three files and **none of them is wasm-related**:

| Failing file | Failures | Nature of failure |
|---|---|---|
| `src/questionnaireOptionA.runtime.test.ts` | 47 | windowed-publication / delegated-proxy runtime assertions |
| `src/simpleLocalState.test.ts` | 2 | `TypeError: Failed to normalize algorithm: 'salt' of 'Pbkdf2Params' … is not instance of ArrayBuffer, Buffer, TypedArray, or DataView` |
| `src/QuestionnaireCoordinatorPanel.optionA.test.tsx` | 1 | option_a mode: blind-signing key in initial worker config |

Representative raw failure:

```
FAIL  src/simpleLocalState.test.ts > simpleLocalState > encrypts and restores a full-state backup bundle with a passphrase
TypeError: Failed to normalize algorithm: 'salt' of 'Pbkdf2Params' (passed algorithm) is not instance of ArrayBuffer, Buffer, TypedArray, or DataView.
 ❯ derivePassphraseKey src/simpleLocalState.ts:169:27
```

These are environment/Node-version (WebCrypto) and feature-branch defects — **out of scope for
this card** and reported here only to make clear they are not wasm-artifact failures. The
wasm-dependent tests pass.

### 5.5 Caveat — the mock shortcut does not cover the coordinator core

`web/vite.config.ts:16-29` aliases `./wasm/auditableVotingCore` → `auditableVotingCore.mock.ts`
**only when `mode === "test"`**. [OBSERVED] That alias is scoped to the *legacy* core module
name. The **coordinator** core is loaded dynamically by `src/core/wasmLoader.ts` and is **not**
aliased to a mock, which is why a broken/absent coordinator artifact is a hard test failure
(see §7.1) rather than a silently-mocked pass. This is the sharp edge a fresh worker hits.

---

## 6. Can a fresh worker build it? — Yes, with two blockers to know about

Simulation: `git clone` of this repo into a scratch dir (inheriting HEAD `56c907d`).

### 6.1 Toolchain present

```
$ rustc --version ; cargo --version
rustc 1.94.0 (4a4ef493e 2026-03-02)
cargo 1.94.0 (85eff7c80 2026-01-15)
$ rustup target list --installed | grep wasm
wasm32-unknown-unknown
```

### 6.2 BLOCKER (a) — `npm ci` fails; the lockfile is out of sync

CI (`test.yml`) uses `npm ci`. In a fresh clone:

```
$ cd web && npm ci
npm error code EUSAGE
npm error `npm ci` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync. Please update your lock file with `npm install` before continuing.
npm error Missing: esbuild@0.27.7 from lock file
EXIT=1
```

Root cause, observed in `web/package-lock.json`: the lockfile contains `@esbuild/*` platform
packages at **0.27.5**, and nested `"esbuild": "~0.27.0"` / `"^0.27.0"` dependency *declarations*,
but **no parent `node_modules/esbuild` entry at 0.27.x** — only a root `esbuild` at **0.21.5**
(for vite). npm resolves the parent to 0.27.x from `package.json` and cannot find it locked.

Workaround that works:

```
$ npm install --no-audit --no-fund
added 266 packages in 29s
```

This is unrelated to wasm but it means a fresh worker following CI's recipe (`npm ci`) is
blocked before touching any Rust. **It should be filed as its own defect; this worker did not
fix it (out of scope, and lockfile regeneration is a repo-wide change).**

### 6.3 BLOCKER (b) — `wasm-pack` is installed but not on PATH

```
$ which wasm-pack
(not found)
$ ~/.cargo/bin/wasm-pack --version
wasm-pack 0.13.1
$ ls -la ~/.cargo/bin/wasm-pack
-rwxrwxr-x 1 c03rad0r c03rad0r 7162000 Sep  9 13:58 /home/c03rad0r/.cargo/bin/wasm-pack
```

`~/.cargo/bin` is **not** on this machine's `PATH`, and `web/package.json` has `wasm-pack` as a
devDependency (0.15.0) but `node_modules/.bin/wasm-pack` **does not exist** after install
(observed: `ls node_modules/.bin | grep wasm` → empty). So all three of these fail:

```
$ npm run build:wasm            # → sh: 1: wasm-pack: not found  (exit 127)
$ node scripts/ensure-wasm-artifacts.mjs   # (fresh clone) same, exit 127
$ npx wasm-pack --version       # would need to download it
```

Fix used here: `export PATH="$HOME/.cargo/bin:$PATH"`.

### 6.4 Rebuild from tracked source succeeds — and is reproducible

In the fresh clone:

```
$ export PATH="$HOME/.cargo/bin:$PATH"
$ cd web && npm run build:wasm:coordinator
…
    Finished `release` profile [optimized] target(s) in 2m 21s
[INFO]: ⬇️  Installing wasm-bindgen...
[INFO]: ✨   Done in 2m 36s
[INFO]: 📦   Your wasm pkg is ready to publish at …/auditable_voting_coordinator_core/pkg.

real    2m48.143s
```

`wasm-pack` self-installs the matching `wasm-bindgen` CLI into `~/.cache/.wasm-pack/`
(observed: `wasm-bindgen-ef34ece7d857f713`), so no preinstalled `wasm-bindgen` is required.

Legacy core for completeness: `1m38s` cold.

**Reproducibility check — the decisive result:**

```
$ sha256sum <fresh clone>/web/src/wasm/auditable_voting_coordinator_core/pkg/auditable_voting_core_bg.wasm
a8dea6b9ce57e541ea603ac7a7f0decafb440e594e367dd88e6533784f09b6df   size=2660339
$ sha256sum <repo>/web/src/wasm/auditable_voting_coordinator_core/pkg/auditable_voting_core_bg.wasm
a8dea6b9ce57e541ea603ac7a7f0decafb440e594e367dd88e6533784f09b6df   size=2660339
```

The from-source rebuild of the *tracked* source is **byte-identical** to the artifact already on
disk. Therefore, as of this HEAD:

- the local prebuilt artifacts are **not stale** (source last changed `da5b9aa`, 2026-07-15;
  artifacts built 2026-09-09; rebuild reproduces them exactly);
- a checksum-manifest staleness mechanism would have a **stable, deterministic** referent
  (the wasm build is reproducible here), which is what makes §7.3 recommend it.

[SPECULATION] Byte-identical reproduction is observed for this pinned source + this
`wasm-pack`/rustc combo. Cross-toolchain (e.g. CI's `wasm-pack 0.15.0` vs local `0.13.1`) it may
differ. A manifest that stamps the toolchain versions is therefore preferable to a bare hash —
see §7.3.

---

## 7. Staleness detection

### 7.1 The current mechanism, and its exact gaps

`web/scripts/ensure-wasm-artifacts.mjs` is the only gate. It works like this:

1. `requiredFiles` — the six paths from §3.4 must exist.
2. `rustSourceRoots` — `web/rust-core/Cargo.toml`, `web/rust-core/src`,
   `../auditable-voting-core/Cargo.toml`, `../auditable-voting-core/src`.
3. `latestMtimeMs(paths)` — recursively max `mtimeMs`; **absent** paths contribute nothing
   (`existsSync` filter), so a *fully missing* source root yields `0`.
4. If all six exist **and** `latestArtifactMtimeMs >= latestRustInputMtimeMs` **and**
   `FORCE_WASM_BUILD !== "1"` → `process.exit(0)` (no build).
5. Otherwise `spawnSync("npm", ["run", "build:wasm"])` and exit with its status.

So the guard is **mtime-only**. Three concrete consequences were reproduced.

**Gap A — content is never checked; `FORCE_WASM_BUILD` is the only escape hatch.**

```
# scratch tree: artifacts present, mtimes forced NEWER than source, content ZEROED
$ : > web/src/wasm/auditable_voting_coordinator_core/pkg/auditable_voting_core_bg.wasm
$ find web/src/wasm/*/pkg -type f -exec touch -d '2027-06-01' {} \;
$ stat -c '%s %n' web/src/wasm/auditable_voting_coordinator_core/pkg/auditable_voting_core_bg.wasm
0  web/src/wasm/auditable_voting_coordinator_core/pkg/auditable_voting_core_bg.wasm
$ node scripts/ensure-wasm-artifacts.mjs ; echo "EXIT=$?"
EXIT=0                      # ← accepted a 0-byte wasm, no rebuild
```

…and the harness then fails:

```
$ npx vitest run src/services/CoordinatorControlService.test.ts
 FAIL  src/services/CoordinatorControlService.test.ts > … retries coordinator control publish until a relay accepts it
Error: Failed to parse WASM file: WebAssembly.compile(): BufferSource argument is empty
 ❯ src/wasm/auditable_voting_coordinator_core/pkg/auditable_voting_core.js:3:1
 ❯ Function.create src/core/coordinatorCoreAdapter.ts:96:20
 Test Files  1 failed (1)
      Tests  5 failed (5)
```

So the guard can pass while the harness is guaranteed to fail. The only signal that the artifact
is bad is a downstream, hard-to-attribute `WebAssembly.compile` error.

**Gap B — a **stale** artifact is accepted whenever its mtime happens to be newer than source.**
This is the normal case for anyone who edited the *build inputs the guard does not watch*: it
recurses `src/` and `Cargo.toml` only. Changes to `Cargo.lock`, `.cargo/config.toml`,
`[profile]`/`[package.metadata.wasm-pack]` sections, or the wasm-build environment do **not**
move `latestRustInputMtimeMs`. [INFERENCE, from reading the two `rustSourceRoots` tuples.]

**Gap C — a missing source root is silently treated as "fresh".**

```
$ mv auditable-voting-core /tmp/hidden      # core source gone, artifacts still present
$ node scripts/ensure-wasm-artifacts.mjs ; echo "EXIT=$?"
EXIT=0
```

Because the absent root contributes `0` to the max, `latestArtifactMtimeMs >= 0` holds and the
guard declares everything fresh — even though nothing could be rebuilt. The "source is gone"
failure is thus converted into a silent pass in exactly the case where it matters.

**Gap D — mtime is not a stable signal across git operations.** [INFERENCE] `git checkout` /
`git clone` / rebase set file mtimes to checkout time, so a branch switch rewrites the ordering
and can trigger (or mask) rebuilds for no content reason. Observed supporting behaviour: a fresh
clone with artifacts copied in rebuilt **both** crates unconditionally, because the copied
artifacts' mtimes were older than the checkout mtimes of the source files.

**Gap E — no signal at all for "the source moved on".** Nothing records which source revision an
artifact corresponds to, so a reviewer cannot tell whether an artifact predates a core change.

### 7.2 Options considered

| Option | Detects content corruption | Detects source drift | Detects toolchain drift | Cost | Works when core src absent |
|---|---|---|---|---|---|
| **0. Current mtime heuristic** | ✗ (Gap A) | ✗ (Gaps B/D/E) | ✗ | ~0 | misleadingly "passes" (Gap C) |
| **1. Committed checksum manifest** (sha256 artifacts + source fingerprint + toolchain) | ✓ | ✓ | ✓ | one verify run ~ms | ✓ (reports "cannot verify", fails) |
| **2. `git log` of the managed core source** | ✗ | ✓ | ✗ | cheap | ✓ |
| **3. Build-script guard only** (fail if sibling missing / no wasm-pack) | ✗ | ✗ | partial | ~0 | ✓ but noisy |
| **4. Commit the artifacts** (`git add -f`) | ✓ implicitly | ✗ (still ambiguous — a hash diff is opaque) | ✗ | +3 MB binary in git, churn on every core rebuild | ✓ |
| **5. mtime + `git log` hybrid** | ✗ | ✓ | ✗ | cheap | partial |

Notes on the rejected/shortlisted ones:

- **Option 2 alone is insufficient** because it says nothing about artifact content, and its
  meaning depends on which revision is "the" core revision. It is however a *cheap* complement
  and is what the card suggests as one candidate.
- **Option 4 (commit the artifacts)** is the only option that removes the build requirement for
  a fresh worker — but it puts a 2.66 MB binary (plus 0.34 MB) in git, fights the two ignore
  files, and still leaves the *staleness question* unanswered: a committed artifact is stale just
  as silently as an untracked one. Reject as the primary mechanism. If the goal is "fresh worker
  needs no Rust toolchain", a release-artifact download is the better shape [SPECULATION on
  implementation].
- **Option 3 is already effectively enforced** by accident: a missing core dir gives exit 2
  (§4.1) and a missing `wasm-pack` gives exit 127 (§4.2), so the guard *does* fail loudly when a
  build is genuinely needed and impossible. Gap C exists only because the guard decides no build
  is needed first. Worth keeping, not sufficient alone.

### 7.3 Recommended mechanism — committed checksum + source-fingerprint manifest

**Recommendation: Option 1, layered on the existing guard.** Concretely:

1. **Add `web/src/wasm/wasm-artifacts.lock.json`** — committed, checked in, small, human-readable:

   ```jsonc
   {
     "schema": 1,
     "toolchain": { "wasm-pack": "0.13.1", "rustc": "1.94.0", "target": "wasm32-unknown-unknown" },
     "artifacts": {
       "auditable_voting_core/pkg/auditable_voting_rust_core_bg.wasm":
         { "sha256": "bc81831e1263f1ad5fbc3423530233e8f524441cbb285b840d359247ce593ed3", "bytes": 336967 },
       "auditable_voting_coordinator_core/pkg/auditable_voting_core_bg.wasm":
         { "sha256": "a8dea6b9ce57e541ea603ac7a7f0decafb440e594e367dd88e6533784f09b6df", "bytes": 2660339 }
       // + the four *_bg.js / *.js glue files, and the two pkg/package.json files
     },
     "sourceFingerprint": {
       "auditable-voting-core/src":    "<git rev-parse HEAD:auditable-voting-core/src>",
       "auditable-voting-core/Cargo.toml": "<git rev-parse HEAD:auditable-voting-core/Cargo.toml>",
       "web/rust-core/src":            "<git rev-parse HEAD:web/rust-core/src>",
       "web/rust-core/Cargo.toml":     "<git rev-parse HEAD:web/rust-core/Cargo.toml>"
     }
   }
   ```

   The exact hashes observed today (used to seed the file above) are reproducible with:

   ```bash
   git rev-parse HEAD:auditable-voting-core/src      # -> e628074598da219ec1f0740e28003f443befbee4
   git rev-parse HEAD:web/rust-core/src              # -> 0b579bcc51586fb1ea0e4d8bc398b6124f2af6ae
   ```

2. **Add `web/scripts/verify-wasm-artifacts.mjs`** that fails (non-zero, actionable message) if
   any of: an artifact is missing, an artifact's sha256 ≠ manifest, an artifact's byte length ≠
   manifest, the current core source fingerprint ≠ manifest (→ "artifacts predate source change
   X, run `npm run build:wasm`"), or the toolchain versions ≠ manifest (→ warn, not fail, since
   a different-but-valid toolchain still produces working output).

3. **Wire it into the existing hooks** so `predev`/`prebuild`/`pretest` run verify → (rebuild if
   needed) → re-verify, and add an explicit `npm run verify:wasm-artifacts`. Keep the mtime check
   as a fast pre-filter inside the guard, but make the manifest the **authority**.

4. **Regenerate the manifest as part of the build** (a `postbuild:wasm` step) so it can never
   drift from the artifacts it describes.

Why this and not the alternatives: it is the only option that closes Gaps A, B, C and E at once;
it costs one small reviewed file; it produces an actionable error ("your artifacts predate the
core change" or "your wasm is corrupt") instead of a downstream `WebAssembly.compile` stack; and
because the build is reproducible here (§6.4) its hashes are stable rather than churny. The
toolchain fields exist so a legitimate CI/local version skew downgrades to a warning rather than
a false alarm.

**[SPECULATION] Counter-consideration, stated for honesty:** sha256 of a wasm binary is only a
useful invariant if the build is reproducible *for the toolchain in use*. It was byte-identical
here for rustc 1.94.0 + wasm-pack 0.13.1; CI pins neither (it runs `cargo install wasm-pack
--locked` on floating `dtolnay/rust-toolchain@stable`), so CI's hash will likely differ from the
committed one. That is exactly why (2) above treats toolchain mismatch as a warning, and why the
manifest should key on the **source fingerprint** for the "must rebuild" decision and use the
artifact hashes for "must not be corrupt". [UNVERIFIED] Whether CI currently even reaches the
wasm step is doubtful — see §8.

---

## 8. Buildability in CI

### 8.1 `test.yml` — correct

```
$ grep -nE "rust-toolchain|wasm-pack|cargo install" .github/workflows/test.yml
30:      # from source via wasm-pack. The coordinator core builds with `--features openmls-engine`.
32:        uses: dtolnay/rust-toolchain@stable
36:      - name: Install wasm-pack
37:        run: cargo install wasm-pack --locked
```

It sets up the `wasm32-unknown-unknown` target, installs `wasm-pack`, then `npm ci && npm test`.
That is consistent with §3: the artifacts are not committed, so CI must build them. [OBSERVED, but
not executed here] This job would currently stop at `npm ci` because of blocker 6.2(a).

### 8.2 `static.yml` (GitHub Pages deploy) — missing the Rust setup

```
$ grep -nE "rust|wasm|cargo|dtolnay" .github/workflows/static.yml
(ZERO matches)
```

`static.yml` runs `npm ci` then `npm run build`. `build` fires the `prebuild` hook
(`node scripts/ensure-wasm-artifacts.mjs`), and on a fresh CI checkout with no artifacts and no
`wasm-pack` that hook runs `npm run build:wasm`, which fails with exit 127 (§4.2). So the Pages
deploy has no toolchain able to satisfy its own prebuild hook.

[SPECULATION] Two readings, flagged because this worker could not execute CI:
(i) the deploy job is silently broken (it would fail on a clean runner), or
(ii) it "passes" only because something else in that pipeline provides artifacts. Nothing in
`static.yml` does. **Recommended fix** (either): add the same Rust + wasm-pack steps as
`test.yml` to the `build` job, or inline the build there. This belongs to the same card family as
this document and should be filed.

The observed behaviour underpinning that claim, from a fresh clone where `node_modules` was
linked in and `wasm-pack` was *available*:

```
$ cd <fresh clone>/web && npm run prebuild
> node scripts/ensure-wasm-artifacts.mjs
… spawns `npm run build:wasm` …
[INFO]: 🌀  Compiling to Wasm... (full legacy + coordinator build)
# exceeded a 300 s foreground timeout — i.e. it does NOT no-op on a fresh checkout
```

i.e. the prebuild hook is **unconditional** (there is no env guard in `web/package.json`), so any
job that runs `npm run build` on a fresh checkout pays a full Rust build.

---

## 9. Copy-paste commands

```bash
# --- fresh worker, from a clean clone -------------------------------------------------
cd web
export PATH="$HOME/.cargo/bin:$PATH"        # blocker 6.3: wasm-pack is not on PATH by default
npm install --no-audit --no-fund            # blocker 6.2: `npm ci` fails on the stale lockfile

# Option A — use a locally prebuilt artifact if you already have one (no Rust build):
node scripts/ensure-wasm-artifacts.mjs      # prints nothing, exit 0 on a good artifact set
npx vitest run src/services/CoordinatorControlService.test.ts

# Option B — build the wasm from tracked source (~4m30s cold for both crates):
npm run build:wasm                          # legacy (~1m38s) + coordinator (~2m48s)
node scripts/ensure-wasm-artifacts.mjs      # now a no-op

# Force a rebuild even if the guard thinks it is fresh:
FORCE_WASM_BUILD=1 npx vitest run

# --- staleness / integrity checks (current mechanism) ---------------------------------
sha256sum web/src/wasm/auditable_voting_core/pkg/auditable_voting_rust_core_bg.wasm
#   bc81831e1263f1ad5fbc3423530233e8f524441cbb285b840d359247ce593ed3  (336967 B)
sha256sum web/src/wasm/auditable_voting_coordinator_core/pkg/auditable_voting_core_bg.wasm
#   a8dea6b9ce57e541ea603ac7a7f0decafb440e594e367dd88e6533784f09b6df  (2660339 B)

# --- source fingerprint (the input a manifest should record) --------------------------
git rev-parse HEAD:auditable-voting-core/src        # e628074598da219ec1f0740e28003f443befbee4
git rev-parse HEAD:web/rust-core/src                # 0b579bcc51586fb1ea0e4d8bc398b6124f2af6ae
git log -1 --format='%h %ad' --date=short -- auditable-voting-core/src web/rust-core/src
#   da5b9aa 2026-07-15
```

---

## 10. Evidence index

| Claim | How observed | Result |
|---|---|---|
| Core is vendored, not a sibling repo | `ls`, `find`, `git ls-files`, `cat .gitmodules` | 20 tracked files at `auditable-voting-core/`; no `.gitmodules` |
| `../auditable-voting-core` absent as a sibling | `ls /home/c03rad0r/repos/auditable-voting-core` | `No such file or directory` |
| Missing-core error is exit 2, pre-wasm-pack | `sh -c 'cd ../auditable-voting-core && wasm-pack …'` | `sh: 1: cd: can't cd to ../auditable-voting-core` / `EXIT=2` |
| Real failure on this box is exit 127 | `npm run build:wasm:coordinator` | `sh: 1: wasm-pack: not found` / `EXIT=127` |
| Artifacts are gitignored twice | `git ls-files`, `git check-ignore -v`, `cat pkg/.gitignore` | root `.gitignore:42,43` + `*` in each `pkg/.gitignore` |
| Fresh clone has no artifacts | `git clone` then `ls web/src/wasm/*/pkg` | `No such file or directory` |
| Prebuilt artifacts suffice (guard) | `node scripts/ensure-wasm-artifacts.mjs` | no output, `EXIT=0` |
| Prebuilt artifacts suffice (harness) | `npx vitest run src/services/CoordinatorControlService.test.ts` | `5 passed (5)`, 5.11s |
| Full-harness baseline | `npm test` | `523 passed / 49 failed (572)`, 3 files, no wasm failures |
| `npm ci` broken | `npm ci` | `npm error Missing: esbuild@0.27.7 from lock file` / `EXIT=1` |
| `npm install` works | `npm install --no-audit --no-fund` | `added 266 packages in 29s` |
| `wasm-pack` installed, off-PATH | `which wasm-pack` vs `~/.cargo/bin/wasm-pack --version` | not found / `wasm-pack 0.13.1` |
| Rebuild from tracked source works | fresh clone `npm run build:wasm:coordinator` | `Done in 2m 36s`, `real 2m48.143s` |
| Build is byte-reproducible | `sha256sum` rebuilt vs on-disk | identical: `a8dea6b9…` / 2660339 B |
| Guard is content-blind | zero the wasm, mtime 2027, run guard | guard `EXIT=0` |
| …and the harness then breaks | vitest on the zeroed wasm | `WebAssembly.compile(): BufferSource argument is empty`, `5 failed` |
| Guard is source-blind | hide core source, run guard | `EXIT=0` |
| Fresh-checkout prebuild does not no-op | fresh clone `npm run prebuild` | full wasm build launched (exceeded 300 s) |
| `static.yml` has no Rust setup | `grep -nE "rust\|wasm\|cargo\|dtolnay"` | zero matches |
| `test.yml` does set up Rust | `grep -nE` | `dtolnay/rust-toolchain@stable`, `cargo install wasm-pack --locked` |
