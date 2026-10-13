# REPORT — wasm/core dependency + staleness detection for the harness

**Task:** Document what the harness needs from `auditable-voting-core`, whether the prebuilt
wasm under `web/src/wasm/` is sufficient to run the harness end-to-end, and how staleness of
those prebuilt artifacts would be detected — with exact commands and observed output.
**Repo:** `auditable-voting` · **Branch:** `feat/windowed-publication-clean`
**Deliverable:** `docs/harness-wasm-core-dependency.md` (committed)
**Status:** COMPLETE — all three DO items answered with raw evidence.

---

## 1. What the card asked, and what is actually true

The card's premise — "`build:wasm:coordinator` references a sibling repo `../auditable-voting-core`
which is ABSENT on this machine" — is **half right, and the wrong half matters**.

- The directory `/home/c03rad0r/repos/auditable-voting-core` genuinely does not exist.
- But the core source is **vendored inside this repository** at
  `auditable-voting/auditable-voting-core/`: **20 git-tracked files**, no `.gitmodules`, only
  `target/` ignored. The npm script does `cd ../auditable-voting-core` **from `web/`**, so it
  resolves to the vendored copy.
- Therefore there is **no sibling-repo dependency to fix**. A fresh worker with this repo and the
  Rust toolchain can build the wasm from tracked source.

The genuine fragilities found instead are: (a) the script is **cwd-sensitive** (fails with exit 2
if the vendored tree is gone/elsewhere), (b) `wasm-pack` is **not on PATH** on this machine
(exit 127 — the real failure here), (c) `npm ci` is **broken** by lockfile drift, and
(d) the artifact **guard cannot tell a fresh artifact from a corrupt or stale one**.

## 2. DO item 1 — what the harness needs from `auditable-voting-core`

Two independent Rust→wasm crates, both required by the web harness:

| Crate | Source | npm script | Output | Features |
|---|---|---|---|---|
| `auditable-voting-rust-core` | `web/rust-core/` | `build:wasm:legacy` | `web/src/wasm/auditable_voting_core/pkg/` | — |
| `auditable-voting-core` | `auditable-voting-core/` (vendored) | `build:wasm:coordinator` | `web/src/wasm/auditable_voting_coordinator_core/pkg/` | `openmls-engine` |

`build:wasm` = both, sequentially. Crate 2's `openmls-engine` feature pulls `openmls 0.8.1`,
`openmls_basic_credential 0.5.0`, `openmls_memory_keystore 0.2.0`, `openmls_rust_crypto 0.5.1`,
`openmls_traits 0.5.0`, `base64 0.22`, `getrandom 0.2.17`; `wasm-opt = false` so binaryen is not
needed. `crate-type = ["cdylib","rlib"]`.

Six artifacts are name-checked by `web/scripts/ensure-wasm-artifacts.mjs`:
`auditable_voting_rust_core{,_bg}.js` + `_bg.wasm`, and `auditable_voting_core{,_bg}.js` +
`_bg.wasm`. Consumers: `web/src/wasm/auditableVotingCore.ts:23` (legacy core) and
`web/src/core/wasmLoader.ts:5` (coordinator core, dyn-imported, reached from
`core/coordinatorCoreAdapter.ts` and `core/derivedStateAdapter.ts`).

### Is prebuilt wasm sufficient to run the harness end-to-end? — **YES** (with one important caveat)

Observed:

- `node scripts/ensure-wasm-artifacts.mjs` → **no output, exit 0** (no build spawned; `wasm-pack`
  deliberately absent from PATH).
- `npx vitest run src/services/CoordinatorControlService.test.ts` → **5 passed (5)** in 5.11s.
  That is the test that mounts the **real coordinator wasm** through `coordinatorCoreAdapter.ts`.
- `npm test` full harness → **523 passed / 49 failed (572)**, 225s. All 49 failures are in three
  files and **none is wasm-related**: `questionnaireOptionA.runtime.test.ts` (47, windowed
  publication / delegated proxy), `simpleLocalState.test.ts` (2, WebCrypto
  `Pbkdf2Params` salt TypeError), `QuestionnaireCoordinatorPanel.optionA.test.tsx` (1, option_a
  worker config). Reported here only so these are not mistaken for wasm failures.

**Caveat — the mock shortcut does not cover the coordinator core.** `web/vite.config.ts:16-29`
aliases `./wasm/auditableVotingCore` → `auditableVotingCore.mock.ts`, but **only in `mode ===
"test"` and only for the legacy core module name**. The coordinator core is loaded dynamically by
`wasmLoader.ts` and is **not** mocked, so a broken coordinator artifact is a hard failure
(`WebAssembly.compile(): BufferSource argument is empty`), not a silent mock pass. That is the
sharp edge.

**Second caveat — "prebuilt" here means machine-local, not committed.** `web/src/wasm/*/pkg/` is
ignored **twice** (root `.gitignore:42,43` plus a wasm-pack-generated `*` `.gitignore` in each
`pkg/`). `git ls-files 'web/src/wasm/*pkg*'` → **0**. A fresh clone has no `pkg/` at all. So
"artifacts present" is an untracked local cache; the correct reading is "given artifacts produced
by an equivalent build, no rebuild is needed".

## 3. DO item 2 — staleness detection

**Current mechanism:** `ensure-wasm-artifacts.mjs` is an **mtime-only** heuristic. It requires the
six files to exist and `latestArtifactMtimeMs >= latestRustInputMtimeMs`, else it runs
`npm run build:wasm`; `FORCE_WASM_BUILD=1` forces a build. Source roots watched:
`web/rust-core/{Cargo.toml,src}` and `../auditable-voting-core/{Cargo.toml,src}`.

**Reproduced gaps:**

- **A — content-blind.** Zero out the coordinator wasm, force its mtime to 2027: guard → **exit 0**
  (no rebuild). The harness then fails with
  `Error: Failed to parse WASM file: WebAssembly.compile(): BufferSource argument is empty`
  at `coordinatorCoreAdapter.ts:96` — **5/5 tests fail**. The guard passes while the harness is
  guaranteed to fail, and the only signal is a hard-to-attribute runtime error.
- **B — source-drift-blind.** It recurses only `src/` and `Cargo.toml`, so changes to
  `Cargo.lock`, `.cargo/config.toml`, `[profile]`/`[package.metadata.wasm-pack]`, or the build
  environment do not move `latestRustInputMtimeMs`. [INFERENCE from reading the two source-root
  tuples.]
- **C — missing source reads as "fresh".** `mv auditable-voting-core /tmp/hidden` with artifacts
  still present → guard **exit 0**, because an absent path contributes `0` to the max. The "cannot
  rebuild" case is silently converted into a pass.
- **D — mtime unstable across git ops.** [INFERENCE] checkout/clone/rebase set mtimes to checkout
  time. Supporting observation: a fresh clone with copied-in artifacts rebuilt **both** crates
  unconditionally because the artifact mtimes predated the checkout mtimes.
- **E — no provenance at all.** Nothing records which source revision an artifact corresponds to.

**Options considered:** (0) current mtime heuristic; (1) committed checksum manifest;
(2) `git log` of the managed core source; (3) build-script guard only; (4) commit the artifacts;
(5) mtime + `git log` hybrid. Option 4 puts 3 MB of binary in git, fights two ignore files, and
*still* leaves staleness ambiguous — rejected as primary. Option 2 alone says nothing about
content. Option 3 is already effectively enforced (missing core → exit 2; missing wasm-pack →
exit 127) but cannot prevent gap C.

**Recommendation (Option 1): committed checksum + source-fingerprint manifest.**

1. Commit `web/src/wasm/wasm-artifacts.lock.json` with: per-artifact `sha256` + `bytes`; a
   `sourceFingerprint` = `git rev-parse HEAD:<tree>` for `auditable-voting-core/src`,
   `auditable-voting-core/Cargo.toml`, `web/rust-core/src`, `web/rust-core/Cargo.toml`; and the
   build `toolchain` (wasm-pack / rustc / target).
2. Add `web/scripts/verify-wasm-artifacts.mjs` that fails with an actionable message on missing
   artifact, hash mismatch, byte-length mismatch, or source-fingerprint drift ("run
   `npm run build:wasm`"), and **warns** (not fails) on toolchain-version skew.
3. Wire it into the existing `predev`/`prebuild`/`pretest*` hooks (verify → rebuild if needed →
   re-verify) and expose `npm run verify:wasm-artifacts`. Keep mtime as a fast pre-filter; make the
   manifest the authority.
4. Regenerate the manifest in a `postbuild:wasm` step so it cannot drift from its artifacts.

**Why this is sound here — the build is byte-reproducible.** A fresh clone + `wasm-pack 0.13.1`
rebuilt the coordinator core in **2m48s** and the result was **byte-identical** to the artifact on
disk:

```
a8dea6b9ce57e541ea603ac7a7f0decafb440e594e367dd88e6533784f09b6df  (2660339 bytes)   ×2
```

Hashes observed for seeding the manifest:

```
auditable_voting_rust_core_bg.wasm        bc81831e1263f1ad5fbc3423530233e8f524441cbb285b840d359247ce593ed3   336967 B
auditable_voting_core_bg.wasm             a8dea6b9ce57e541ea603ac7a7f0decafb440e594e367dd88e6533784f09b6df  2660339 B
git rev-parse HEAD:auditable-voting-core/src   e628074598da219ec1f0740e28003f443befbee4
git rev-parse HEAD:web/rust-core/src           0b579bcc51586fb1ea0e4d8bc398b6124f2af6ae
git log -1 -- auditable-voting-core/src web/rust-core/src   da5b9aa 2026-07-15
```

**[SPECULATION, flagged]** sha256 is only a useful invariant if the build reproduces *for the
toolchain in use*. It did here (rustc 1.94.0 + wasm-pack 0.13.1); CI pins neither, so CI's hash
will likely differ. Hence the design keys the "must rebuild" decision on the **source
fingerprint** and uses artifact hashes only for corruption, treating toolchain mismatch as a
warning.

## 4. Evidence: the two recorded build failures

**Card's stated scenario — core directory missing** (fails *before* wasm-pack is invoked):

```
$ sh -c 'cd ../auditable-voting-core && wasm-pack build --target bundler --out-dir ../web/src/wasm/auditable_voting_coordinator_core/pkg -- --features openmls-engine'
sh: 1: cd: can't cd to ../auditable-voting-core
EXIT=2
```

**The failure that actually occurs on this machine:**

```
$ cd web && npm run build:wasm:coordinator
> cd ../auditable-voting-core && wasm-pack build --target bundler --out-dir ../web/src/wasm/auditable_voting_coordinator_core/pkg -- --features openmls-engine
sh: 1: wasm-pack: not found
EXIT=127
```

## 5. Fresh-worker blockers (found, reported, NOT fixed — out of scope)

1. **`npm ci` fails; lockfile out of sync.** `npm ci` → `npm error Missing: esbuild@0.27.7 from
   lock file`, exit 1. `web/package-lock.json` carries `@esbuild/*` platform packages at
   **0.27.5** and `"esbuild": "~0.27.0"`/`"^0.27.0"` *declarations*, but **no parent
   `node_modules/esbuild` at 0.27.x** (only a root esbuild at 0.21.5 for vite). `npm install
   --no-audit --no-fund` works (`added 266 packages in 29s`). CI `test.yml` uses `npm ci`, so CI
   would stop here. **Recommend filing as its own defect; lockfile regeneration is a repo-wide
   change and was deliberately not done by this documentation card.**
2. **`wasm-pack` off PATH.** `which wasm-pack` → not found; `~/.cargo/bin/wasm-pack` → `0.13.1`.
   `web/package.json` lists `wasm-pack` as a devDependency but `node_modules/.bin/wasm-pack` does
   not exist after install. Fix: `export PATH="$HOME/.cargo/bin:$PATH"`.

## 6. CI buildability

- `test.yml` is correct: `dtolnay/rust-toolchain@stable` (target `wasm32-unknown-unknown`) +
  `cargo install wasm-pack --locked`, then `npm ci && npm test`. Consistent with artifacts not
  being committed. [Not executed here] Would currently stop at `npm ci` (blocker 1).
- `static.yml` (Pages deploy) has **zero** Rust/wasm matches, yet runs `npm run build`, whose
  `prebuild` hook is **unconditional** and needs `wasm-pack` on a fresh checkout. Observed
  supporting behaviour: a fresh clone's `npm run prebuild` launched a full wasm build (exceeded a
  300 s timeout) rather than no-opping. **[SPECULATION]** either the deploy job is silently broken
  on a clean runner, or something outside `static.yml` supplies artifacts — nothing in that file
  does. Recommended fix: add the same Rust + wasm-pack steps to the `build` job.

## 7. Deliverables and commit trail (all observed)

- `docs/harness-wasm-core-dependency.md` — new, 33.7 KB, full write-up with raw output, evidence
  index, and copy-paste commands.
- `PROGRESS.md` — crash-recovery map.
- Commits pushed to **fork** `felixfelix-bot/auditable-voting`, branch
  `feat/windowed-publication-clean` (additive only):
  - `10fbba1` — progress map → push `56c907d..10fbba1`
  - `699d64c` — the documentation → push `10fbba1..699d64c`
  - final — `REPORT.md` + `PROGRESS.md`

No upstream (`tidley`) push was made. Nothing was fixed in application code.

## 8. Answers to the card, in one line each

- **Required from the core:** the `auditable-voting-core` crate built with `wasm-pack
  --target bundler --features openmls-engine` into
  `web/src/wasm/auditable_voting_coordinator_core/pkg/` (plus the separate `web/rust-core` crate);
  six named artifact files consumed by `auditableVotingCore.ts` and `wasmLoader.ts`.
- **Is prebuilt wasm sufficient end-to-end?** **Yes** — guard no-ops, `wasm-pack` not needed,
  coordinator wasm test 5/5 pass, full suite has zero wasm failures. Caveat: the artifacts are
  untracked, and the coordinator core is not mocked in tests, so a corrupt artifact fails hard.
- **Staleness detection:** current mechanism is mtime-only and is content-blind, source-drift-blind,
  and treats absent source as fresh (all reproduced). **Recommended:** committed checksum +
  source-fingerprint manifest (`web/src/wasm/wasm-artifacts.lock.json`) verified by
  `scripts/verify-wasm-artifacts.mjs`, with the byte-reproducible build (`a8dea6b9…`) making the
  hashes stable.
