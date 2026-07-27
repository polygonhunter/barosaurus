# M0 spike — empirical findings & open gates

Research verified most mechanisms against the Obsidian API, the developer docs and
production plugins, but a handful of facts can only be pinned down empirically in a real
vault on Obsidian ≥ 1.12.4. Each has a **gate**: what to check, and which knob in the code
flips if the assumption fails.

Status legend: ☐ unverified · ☑ verified (fill in date + Obsidian version).

This file is the *reference* — one section per assumption, with the knob that flips if it
fails. To actually run them, follow **[verification-checklist.md](verification-checklist.md)**,
which orders the same eight gates into a single pass through one vault so the state carries
from one to the next.

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

**Check:** `chooser` and `updateSuggestions` are **modal**-scoped, not app-scoped — they
exist only while the bar is open, so no load-time probe can ever see them. `capabilities()`
in `src/ui/unsafe.ts` therefore covers the six `app`-level internals only, and *Settings →
About → Internal APIs* displays its verdict. The gate splits in two:

1. *Settings → About → Internal APIs* must report everything present. That covers
   commands, hotkey chips, community- and core-plugin detection, the vault tag list and
   settings pages.
2. `chooser` and `updateSuggestions` are checked **behaviourally**: `⌃N`/`⌃P` move the
   highlight (that is `chooser`), and a mode change with no keystroke — pressing `⌘K` on a
   result — refreshes the list (that is `updateSuggestions`).

**If it fails:** the fallback is already the design — `unsafe.ts` returns `null`/`false`
and the modal falls back to dispatching a synthetic `input` event for refresh, and to
Obsidian's own arrow handling for movement. Ctrl+N/Ctrl+P would then be dropped rather
than broken.

## 4. ☐ Rewriting another command's hotkey (the Cmd+K takeover) — NOT BUILT

**Assumption:** `app.hotkeyManager` exposes enough to move `editor:insert-link` to
Cmd+Shift+K and to revert it, so the onboarding modal can offer a one-click takeover of
Cmd+K.

Only `getHotkeys` and `getDefaultHotkeys` are known from other plugins' usage; the write
side (`setHotkeys` / `removeDefaultHotkeys` / `bake` / `save`) is entirely unverified.

**Check:** in the onboarding modal, take Cmd+K, then confirm in Settings → Hotkeys that
`Insert link` really moved and that Barosaurus really holds Cmd+K. Restart Obsidian and
check it persisted. Then use the revert button and confirm both go back.

**Status:** the takeover is deliberately NOT implemented. `src/ui/unsafe.ts` exposes only
`getHotkeys` / `getDefaultHotkeys`; there is no write path, and inventing one against an
entirely unverified internal in order to move a *different* command's shortcut is a poor
trade. What ships is the "show me how" degradation: the settings tab explains the two
steps and offers a button that opens Settings → Hotkeys. This gate stays open in case the
write side is ever worth revisiting.

## 5. ☐ Modal height against the software keyboard on phones

**Assumption:** `window.visualViewport.height` shrinks when the software keyboard opens on
both iOS and Android, so the modal could size itself against it instead of against
`innerHeight`.

**Status:** NOT implemented, on purpose. What ships is the CSS-only path — the same one
Searchosaurus and Slashosaurus use — with `env(safe-area-inset-bottom)` padding on the
result list. No sibling plugin measures `visualViewport`, so there is no in-family
precedent on either platform, and the honest order is to measure the problem before
writing code for it.

**Check:** open the bar on a phone, focus the input, and confirm the last result row stays
reachable above the keyboard. Repeat in landscape, and on the other platform — iOS and
Android have historically differed here.

**If it fails:** add the `visualViewport.height` measurement, sizing the modal against it
on `resize`. That is the only reason to take on the complexity.

## 6. ☐ Deferred tabs in the open-tabs source

**Assumption:** since 1.7.2 background tabs are deferred, `leaf.isDeferred` is true and
`leaf.view` is a `DeferredView` rather than a `MarkdownView`, so the tabs source must read
the path from `leaf.getViewState()` and never cast the view.

**Check:** open six notes in tabs, restart Obsidian so most are deferred, then open the bar
and confirm every tab appears with the correct title — not just the active one, and with no
console errors.

**If it fails:** `loadIfDeferred()` before reading, accepting the cost, or fall back to
listing only non-deferred leaves and letting the files source cover the rest.

## 7. ☐ Moving the selection past a group header

**Assumption:** re-dispatching a synthetic `ArrowDown` on the input moves Obsidian's own
selection, so the bar can skip over a group label by dispatching twice.

There is no public setter for the highlighted suggestion, and `src/ui/unsafe.ts` exposes
`chooser.useSelectedItem` but no `setSelectedItem`. So `navigate()` swallows the real
arrow key, finds the next row that is a real result, and re-dispatches exactly as many
synthetic ones as the gap between the two — one press, one item, however many labels are
in between. A MutationObserver covers the selections the bar did not make: the first
render and every repaint, where Obsidian selects row 0 and row 0 is always a label.

That net used to be a second, independent skip that stepped once in `lastDirection` — the
direction of the last key `navigate()` had handled. Reaching a label going *up* while that
remembered direction was *down* pushed the selection straight back to the row it came
from, so ↑ across a group boundary did nothing at all, however often it was pressed. The
net now continues the move that actually happened (`travelDirection`), shares
`navigate()`'s two helpers, and reads its own landing back out of the DOM — the step
happens with the observer disconnected, so no callback is coming to tell it where it
ended up. `tests/ui/bar-groups.test.ts` holds the boundary cases.

**Check:** open the bar with results in at least three groups. Hold ↓ from the top to the
bottom and back up. The highlight must never rest on a group label, must not skip a real
row, and must not stutter or flicker. Repeat with `⌃N` / `⌃P`.

**If it fails:** add `setSelectedItem` to the chooser accessor in `src/ui/unsafe.ts` and
swap the one line in `navigate()`. If the internal is absent too, fall back to rendering
group labels as a non-row element (a sticky heading outside the list), which costs the
grouped-list look but removes the problem entirely.

## 8. ☐ Escape reaching our handler before Modal's

**Assumption:** `Modal` registers its own Escape handler in the constructor, and our later
`scope.register` for Escape takes precedence — so Esc pops one page instead of closing the
whole bar.

**Check:** open the bar, run "Move to…" to push a folder picker, press Esc once. Expected:
back to the result list with the query intact. Wrong: the bar closes outright.

**If it fails:** the degraded behaviour is the default expectation anyway (Esc closes), so
this is not a crash — but the fix is to intercept Escape on the capture-phase `inputEl`
listener that already handles the arrow keys, rather than through the scope.

## Also worth recording during the spike

- Whether `checkCallback(true)` is safe to call for every registered command at query time,
  or whether some third-party plugin does real work in its "checking" branch.
- How many commands a heavily-loaded vault actually registers, to confirm the
  `prepareFuzzySearch` prefilter threshold is set sensibly (the typings warn about "more
  than a few thousand" calls).
- Whether `internalPlugins.getPluginById("command-palette").instance.options.pinned` is
  readable, and whether writing to it is picked up without a restart.
