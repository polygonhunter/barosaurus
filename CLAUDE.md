# Barosaurus — project rules

## Release policy (MANDATORY)

**Every change — no matter how small — gets a version bump AND a new GitHub
release.** No exceptions: docs, copy, CSS, workflow tweaks, one-liners.

Concretely, every change set MUST, in the same commit:

1. Bump the patch version (e.g. `0.9.1` → `0.9.2`) in **all three** files:
   - `manifest.json` → `version`
   - `package.json` → `version`
   - `versions.json` → add `"<new version>": "<minAppVersion>"`
2. Be pushed to `main`.

Pushing to `main` automatically triggers `.github/workflows/release.yml`,
which builds the plugin and publishes a GitHub release named after the
`manifest.json` version (tag == version, no `v` prefix), with `main.js`,
`manifest.json` and `styles.css` attached plus build provenance attestations.
Never push to `main` without a version bump — the release name comes from the
manifest, and an unchanged version would only refresh the previous release's
assets instead of creating a new release.

After pushing, verify the workflow run succeeded and the release for the new
version exists (assets present) before reporting the work as done.

**This rule applies from the first release onwards.** Pre-release development
happens on a feature branch, where the workflow never triggers — that is the
only time the version may stay put across commits.

## API floor

`minAppVersion` is **1.12.4**, and the public Obsidian desktop build is ahead
of it while the npm typings are ahead of *both* (they describe the 1.13.x
insider surface). **Never use an API tagged `@since 1.13.0` or later** — the
community-plugin linter checks static API usage against `minAppVersion` and
will reject the submission. `tsc` cannot catch this, so `tests/api-floor.test.ts`
greps the source for the known-forbidden symbols instead. Add to that list
whenever a new 1.13+ API becomes tempting.

Forbidden today: the declarative settings API (`getSettingDefinitions`,
`SettingDefinition*`, `SettingGroup`, `SettingPage`, `refreshDomState`,
`getControlValue`/`setControlValue`, `settingItems`), `Setting.errorEl`,
`Setting.setErrorMessage`, `Setting.addDisplayValue`, `ConfirmationModal`, and
the base-class `Plugin.settings` field. Use the imperative `display()` settings
tab; its deprecation warning is expected and correct for our floor.

Also gone from the API entirely (removed in 1.7.2, not merely new):
`prepareQuery`, `fuzzySearch`, `PreparedQuery`. Use `prepareFuzzySearch` /
`prepareSimpleSearch`.

## Community-plugin lint

`npm run lint` runs `eslint-plugin-obsidianmd` — the same linter the store review
runs. **It must report zero errors.** Warnings are a different matter: the ones
left standing are deliberate, and each was checked before being left.

Do not "fix" these; the fix is wrong:

- **`display` deprecated · `prefer-setting-definitions`** — the replacement is the
  declarative settings API, `@since 1.13.0`. Forbidden by the floor above.
- **`setWarning` deprecated** — replacement `setDestructive()` is `@since 1.13.0`.
- **`setDynamicTooltip` deprecated** — replacement `setDisplayFormat()` is
  `@since 1.13.0`, and the note "the value is now always shown inline" carries no
  version, so dropping the call may lose the value on our floor.
- **`ui/sentence-case`** — every hit is an acronym, a proper noun or a format
  token (`PDFs`, `German and English`, `Obsidian URI`, `YYYY-MM-DD`). Obeying it
  would write `pdfs` and `yyyy-mm-dd`, which is not sentence case, it is wrong.
- **`prefer-create-el`** — `createDiv`/`createEl` are declared on `Node` and
  **append to it**. Both sites build a detached element and swap it in only if it
  is still current; appending eagerly reintroduces the race the code exists to
  avoid. The suggestion also does not typecheck (`Window` has no `createDiv`).
- **`no-global-this` in `unsafe.ts`** — `navigator` is identical in every window,
  so there is no popout concern, and `activeWindow` does not exist in the node
  environment the accessors are unit-tested in.

Two rules that ARE worth obeying, and why:

- **`prefer-window-timers`** — use `window.setTimeout`, not `activeWindow`. A
  timer has no DOM to belong to, and `activeWindow` can change between scheduling
  and clearing, so `clearTimeout` silently misses. This is the one exception to
  the `activeWindow` rule below: nodes yes, timers no.
- **`unbound-method`** — injected callbacks on a host interface must be declared
  as **properties holding functions** (`pins?: () => string[]`), never as methods
  (`pins?(): string[]`). Callers pull them off the host before checking they
  exist, and method syntax makes every such read an unbound extraction.

## Architecture rules

- `src/core/**` never imports `obsidian`. That is what lets the whole test
  suite run under plain vitest with no shim. Anything obsidian-shaped that core
  needs is **injected** (see `FuzzyFactory`, `PluginCapabilities`).
- Every undocumented API (`app.commands`, `app.hotkeyManager`,
  `app.internalPlugins`, `app.plugins`, `app.setting`, `SuggestModal.chooser`,
  `SuggestModal.updateSuggestions`) lives in `src/ui/unsafe.ts` behind narrow
  accessors that return `null`/`false` instead of throwing. Every caller has a
  defined degraded behaviour. Nothing outside that file touches an internal.
- DOM is built with `createDiv`/`createSpan`/`createEl`/`setIcon` — **never**
  `innerHTML`. Styles go through `setCssStyles()`, not `.style.x =`.
- Use `activeWindow` / `node.doc` / `node.win` rather than the globals, so the
  bar works in popout windows.
- `moment` is **never** an esbuild external — that crashes the plugin with
  "Cannot find module 'moment'". Write a pure formatter instead.
- UI copy is sentence case. No default hotkeys. `console.error` only inside a
  `catch`. `normalizePath()` for every constructed path.

## Dev commands

```bash
npm install
npm run dev    # watch build into test-vault/.obsidian/plugins/barosaurus
npm test       # vitest unit tests over src/core
npm run build  # typecheck + production build (main.js at repo root)
```

## Notes

- The Obsidian community store reads `manifest.json` from the default branch
  and installs assets from the release whose tag equals its `version`.
- `docs/findings.md` tracks the empirical verification gates for assumptions
  that can only be tested inside a real Obsidian instance.
