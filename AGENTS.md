# Conductor agent instructions

## Default workflow

For small fixes, tuning changes, copy changes, and UI polish:

- Make the change directly without creating a plan or walkthrough artifact.
- Start with the named file or subsystem.
- Inspect direct dependencies only when necessary.
- Do not perform repository-wide exploration unless the target cannot be found.
- Keep changes narrowly scoped.
- Do not refactor unrelated code.
- Do not add dependencies unless requested.

## Verification

- Run the most relevant individual Vitest file.
- Run `npm run typecheck` after TypeScript changes.
- Run the full test suite only for cross-cutting changes or when targeted tests fail.
- Run a production build only for structural, dependency, or release changes.
- Do not launch the browser for constants, copy, tests, internal refactors, or straightforward styling changes.
- Use browser verification for camera, gesture, audio, animation, layout, or end-to-end behaviour.

## Releases

- Do not update `version.json`, `package.json` version, or visible version text during ordinary development.
- Update versions and release history only when the user explicitly asks to prepare a release.
- Release versions use major.minor.patch format.

## Feature flags

- Add a feature flag for a genuinely new major mode or experimental system.
- Do not add feature flags for bug fixes, tuning adjustments, visual polish, or extensions to an existing feature.

## Project map

- `src/camera`: hand tracking, gesture interpretation, Magic Finger and camera UI
- `src/audio`: instrument loading, playback and dynamics
- `src/clock`: musical timing and conducting tempo
- `src/experience`: overall experience state and coordination
- `src/score`: MIDI repertoire and score transport
- `src/ui`: score visualization and debug interface
- `src/warmup`: initial loading and interactive tutorial
- `tests`: Vitest tests corresponding to these systems
- `public/midi`: repertoire content and metadata

The local development URL is `http://localhost:5173/`. Mention it only when starting the server or when the user asks where to play.