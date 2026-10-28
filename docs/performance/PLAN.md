# Mobile performance 4.4.3 implementation plan
Goal: remove optional startup waits while preserving decision, training and storage contracts.
Baseline: 636b636b862d427d8a8d55a764159238c3029c0d. Original working tree and staged files are untouched.
Specification: user attachment 0571054c-7b65-4e49-99f8-1b77dc933d33.
Constraints: no version/weight/backend changes; no push, merge, release, training or deployment.
Execution: inline; user supplied detailed authorized implementation and delivery requirements.
- [ ] Capture all existing Node regressions and Chrome 6x measurements before runtime edits.
- [ ] P1 storage: delayed DB/content failure tests; remove content wait, gate active info until restore settles; preserve revision guard and per-game version pinning. Commit independently.
- [ ] P1 modules: lazy panel exports with per-path shared promise, explicit loading/error and disposal; preserve synchronous loaded calls. Test first/repeated open and pending disposal. Do not delay safety installs or change namespace API return types. Commit independently.
- [ ] P1 models: concurrent/repeated v5 load tests and exact prediction fixtures; shared load promise and bounded decode yields, lifecycle generation checks, no inference while disabled. Keep v3 math and one-shot loader. Commit independently.
- [ ] P2 decisions/diagnostics: measure first/continuous phases; only change computation with evidence. Add bounded longtask observer/resource timings and explicit ESM observation boundary; retain perfReport. Commit independently.
- [ ] Run full regressions, Chrome comparisons, host autoplay where available; report unsupported scenarios as unverified. Export patches, QA zip, file hashes, install instructions.
Review focus: late restore cannot overwrite new save; per-game specialist identity never changes; pending panel completion cannot remount; disabled shadow cannot restart after load; malformed model failure cannot retry forever.
