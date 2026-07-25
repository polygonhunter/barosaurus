# M0 spike — empirical findings & open gates

Research verified most mechanisms against the Obsidian API, the developer docs and
production plugins, but a handful of facts can only be pinned down empirically in a real
vault on Obsidian ≥ 1.12.4. Each has a **gate**: what to check, and which knob in the code
flips if the assumption fails.

Status legend: ☐ unverified · ☑ verified (fill in date + Obsidian version).

## 1. ☐ Markdown inside a coloured `<span>`

**Assumption (load-bearing for the colour actions):** wrapping a selection in
`<span style="color: var(--color-red);">` keeps the selection's own markdown rendering.

The docs cut both ways on this. `Editing and formatting/HTML content.md` states plainly:

> **No Markdown inside HTML.** Obsidian does not render Markdown syntax inside HTML
> elements.

but then qualifies it for exactly the element we use:

> Some inline HTML tags like `<span>` or `<a>` have limited functionality and may appear
> to render Markdown, but this is not actually what's happening.

So the behaviour for an inline `<span>` is explicitly ambiguous and must be observed.

**Check:** select the text `**bold** and *italic*`, apply a text colour. Inspect the result
in Live Preview **and** in Reading view. Expected best case: coloured, still bold and
italic. Expected worst case: coloured, with literal asterisks visible.

**If it fails:** `src/core/style.ts` already exports `containsMarkdownSyntax()`. Wire it
into the colour action so the bar warns once (a single Notice, not per use) before
wrapping a selection that contains markdown. Consider offering "strip formatting and
colour" as the alternative.

## 2. ☐ `var(--color-*)` inside an inline style attribute in a note

**Assumption:** Obsidian's sanitizer keeps `style="color: var(--color-red);"` intact and
the variable resolves against the theme, so colours follow light/dark mode.

This is the reason the theme mode is the default rather than hex. If the sanitizer strips
`var()` — or strips `style` in ways the docs do not enumerate — every coloured span
renders in the default text colour, which is a silent failure.

**Check:** apply each of the eight colours, then toggle the theme between light and dark.
Each colour must remain legible in both. Inspect one span in the dev tools and confirm the
`style` attribute survived verbatim.

**If it fails:** flip `DEFAULT_SETTINGS.colorMode` to `"hex"` in `src/settings.ts`. The hex
path is already implemented and tested; only the default changes.

## 3. ☐ `chooser` and `updateSuggestions()` on SuggestModal

**Assumption:** the undocumented `chooser` object and `updateSuggestions()` method still
exist on `SuggestModal` in 1.12.x, so the bar can move the selection programmatically
(Ctrl+N/Ctrl+P, keeping the highlight across a re-query) and force a refresh when the mode
changes without a keystroke.

Neither appears anywhere in `obsidian.d.ts` — zero occurrences. Better Command Palette has
depended on both since 2021, which is evidence they exist but not that they will remain.

**Check:** open the bar, `console.log` the capability probe from `src/ui/unsafe.ts` once,
and confirm both are reported present. Then verify Ctrl+N/Ctrl+P actually move the
highlight.

**If it fails:** the fallback is already the design — `unsafe.ts` returns `null`/`false`
and the modal falls back to dispatching a synthetic `input` event for refresh, and to
Obsidian's own arrow handling for movement. Ctrl+N/Ctrl+P would then be dropped rather
than broken.

## 4. ☐ Rewriting another command's hotkey (the Cmd+K takeover)

**Assumption:** `app.hotkeyManager` exposes enough to move `editor:insert-link` to
Cmd+Shift+K and to revert it, so the onboarding modal can offer a one-click takeover of
Cmd+K.

Only `getHotkeys` and `getDefaultHotkeys` are known from other plugins' usage; the write
side (`setHotkeys` / `removeDefaultHotkeys` / `bake` / `save`) is entirely unverified.

**Check:** in the onboarding modal, take Cmd+K, then confirm in Settings → Hotkeys that
`Insert link` really moved and that Barosaurus really holds Cmd+K. Restart Obsidian and
check it persisted. Then use the revert button and confirm both go back.

**If it fails:** degrade the onboarding option from "do it for me" to "show me how" — the
modal explains the two steps and offers a button that opens Settings → Hotkeys. No other
code changes; the button already exists in `src/settings.ts`.

## 5. ☐ Modal height against the software keyboard on phones

**Assumption:** `window.visualViewport.height` shrinks when the software keyboard opens on
both iOS and Android, so the modal can size itself against it instead of against
`innerHeight` and avoid having its last rows sit underneath the keyboard.

No sibling plugin does this — Searchosaurus and Slashosaurus both solve mobile purely with
`body.is-phone` CSS and never touch `visualViewport`. So there is no in-family precedent
to lean on, on either platform.

**Check:** open the bar on a phone, focus the input, and confirm the last result row stays
visible above the keyboard. Repeat in landscape. Repeat on the other platform — iOS and
Android historically differ here.

**If it fails:** fall back to a pure CSS solution — `max-height` in `dvh` units with
`env(safe-area-inset-bottom)`, which is already in `styles.css` — and drop the JS
measurement entirely.

## 6. ☐ Deferred tabs in the open-tabs source

**Assumption:** since 1.7.2 background tabs are deferred, `leaf.isDeferred` is true and
`leaf.view` is a `DeferredView` rather than a `MarkdownView`, so the tabs source must read
the path from `leaf.getViewState()` and never cast the view.

**Check:** open six notes in tabs, restart Obsidian so most are deferred, then open the bar
and confirm every tab appears with the correct title — not just the active one, and with no
console errors.

**If it fails:** `loadIfDeferred()` before reading, accepting the cost, or fall back to
listing only non-deferred leaves and letting the files source cover the rest.

## Also worth recording during the spike

- Whether `checkCallback(true)` is safe to call for every registered command at query time,
  or whether some third-party plugin does real work in its "checking" branch.
- How many commands a heavily-loaded vault actually registers, to confirm the
  `prepareFuzzySearch` prefilter threshold is set sensibly (the typings warn about "more
  than a few thousand" calls).
- Whether `internalPlugins.getPluginById("command-palette").instance.options.pinned` is
  readable, and whether writing to it is picked up without a restart.
