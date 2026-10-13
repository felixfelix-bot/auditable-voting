# PROGRESS — wasm/core dependency + staleness detection (harness)

Branch: `feat/windowed-publication-clean`
Task: document what the harness needs from auditable-voting-core, whether prebuilt
wasm under `web/src/wasm/` is sufficient, and how staleness would be detected.

## Deliverable

`docs/harness-wasm-core-dependency.md` — full write-up with raw command output,
evidence index, and copy-paste commands.

## Crash-recovery log (finding → status → files touched)

1. **Sibling-repo claim is WRONG for this tree** → VERIFIED → no files.
   `../auditable-voting-core` is absent as a *sibling*, but the core source is
   **vendored at repo root** `auditable-voting-core/` (20 git-tracked files, no
   `.gitmodules`). From `web/`, `cd ../auditable-voting-core` resolves to the
   vendored copy, so `build:wasm:coordinator` works in a fresh checkout.

2. **Prebuilt artifacts are NOT committed** → VERIFIED → no files.
   `web/src/wasm/*/pkg/` gitignored twice (root `.gitignore` L42–43 + a
   wasm-pack-generated `*` .gitignore inside each `pkg/`).

3. **Prebuilt artifacts ARE sufficient to run the harness** → VERIFIED → no files.
   Guard exits 0 with `wasm-pack` off PATH; `CoordinatorControlService.test.ts`
   5/5 pass in 5.1s; full suite 523 passed / 49 failed with **zero** wasm failures.

4. **Fresh worker CAN rebuild from tracked source** → VERIFIED → no files.
   Fresh clone + wasm-pack 0.13.1 rebuilt coordinator core in 2m48s, **byte-identical**
   to the artifact on disk (sha256 `a8dea6b9…`, 2660339 B).

5. **Two fresh-worker blockers found (both unrelated to wasm source)** → VERIFIED.
   (a) `npm ci` fails: `Missing: esbuild@0.27.7 from lock file`; `npm install` works (266 pkgs).
   (b) `wasm-pack` exists at `~/.cargo/bin/wasm-pack` but is NOT on PATH (exit 127).

6. **Staleness detection gap — guard is mtime-only** → VERIFIED (strong).
   Zero-byte wasm with mtime forced newer than source → guard `EXIT=0`, no rebuild,
   then the harness dies with `WebAssembly.compile(): BufferSource argument is empty`.
   Also: hiding the core source dir entirely still gives guard `EXIT=0`.

7. **CI: static.yml Pages job has no Rust/wasm-pack setup** → VERIFIED (grep).
   `test.yml` sets up `dtolnay/rust-toolchain@stable` + `cargo install wasm-pack`;
   `static.yml` has zero matches yet its `npm run build` fires the unconditional
   `prebuild` hook which needs wasm-pack.

8. **Recommendation delivered** → committed.
   Committed checksum manifest (`web/src/wasm/wasm-artifacts.lock.json`) carrying
   per-artifact sha256 + bytes, the core/rust-core source fingerprint
   (`git rev-parse HEAD:<tree>`), and toolchain versions; verified by a new
   `scripts/verify-wasm-artifacts.mjs`, replacing the mtime heuristic as authority.

## Commit / push log (observed)

- `10fbba1` — `docs(harness): progress map for wasm core dependency investigation`
  → pushed `56c907d..10fbba1` (fork → `feat/windowed-publication-clean`, rc=0).
- `699d64c` — `docs(harness): wasm/core dependency, prebuilt sufficiency, staleness detection`
  (adds `docs/harness-wasm-core-dependency.md`) → pushed `10fbba1..699d64c`.
- Final commit — `REPORT.md` + this `PROGRESS.md` update.

## Status: COMPLETE
All three DO items answered with raw evidence. No remaining steps.
Out-of-scope defects found and reported in `REPORT.md` §Recommendations (not fixed here):
the `npm ci` lockfile drift and the `static.yml` missing Rust setup.
