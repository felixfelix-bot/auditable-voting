# PROGRESS — wasm/core dependency + staleness detection (harness)

Branch: `feat/windowed-publication-clean`
Task: document what the harness needs from auditable-voting-core, whether prebuilt
wasm under `web/src/wasm/` is sufficient, and how staleness would be detected.

## Crash-recovery log (finding → status → files touched)

1. **Sibling-repo claim is WRONG for this tree** → VERIFIED (raw output) → no files.
   `../auditable-voting-core` is absent on this machine, but the core source is
   **vendored at repo root** `auditable-voting-core/` (20 git-tracked files; only
   `target/` ignored). `../auditable-voting-core` from `web/` resolves to
   `auditable-voting/auditable-voting-core` — the vendored copy. So `build:wasm:coordinator`
   works in a fresh checkout; it fails only if invoked from a different cwd.

2. **Prebuilt artifacts are NOT committed** → VERIFIED → no files.
   `web/src/wasm/*/pkg/` is gitignored twice (root `.gitignore` L42–43 + a
   wasm-pack-generated `*` .gitignore inside each `pkg/`). Fresh clone has the
   `.ts`/`.mock.ts` sources but no `pkg/`.

3. **Prebuilt artifacts ARE sufficient to run the harness** → VERIFIED → no files.
   `ensure-wasm-artifacts.mjs` exits 0 (no build); `npx vitest run
   src/services/CoordinatorControlService.test.ts` → 5/5 pass in 5.1s with no
   wasm-pack on PATH.

4. **Fresh worker CAN rebuild from tracked source** → VERIFIED → no files.
   Fresh clone + `wasm-pack 0.13.1` rebuilt coordinator core in 2m48s, byte-identical
   to the prebuilt artifact (sha256 `a8dea6b9…`, 2660339 bytes).

5. **Two real fresh-worker blockers** → VERIFIED → to be documented.
   (a) `npm ci` FAILS: "Missing: esbuild@0.27.7 from lock file" (lockfile drift);
   `npm install` works.
   (b) `wasm-pack` is at `~/.cargo/bin/wasm-pack` but NOT on PATH.

6. **Staleness detection gap in the guard** → VERIFIED (strong) → to be documented.
   `ensure-wasm-artifacts.mjs` uses mtime only: on a 0-byte corrupted wasm with
   mtime forced newer than source it exited 0 (no rebuild), and the harness then
   failed with `WebAssembly.compile(): BufferSource argument is empty`.

7. **CI gap: static.yml has no Rust setup** → VERIFIED → to be documented.
   `test.yml` installs Rust+wasm-pack; `static.yml` (Pages deploy) does not, yet
   its `npm run build` triggers `prebuild` → guard → wasm build.

## Status: see REPORT.md
