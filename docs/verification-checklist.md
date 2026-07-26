# Verification checklist

One pass through one vault that closes all eight gates in
[findings.md](findings.md). The order is not the numbering — it is the order that
lets the vault state carry from one gate to the next, so nothing has to be set up
twice. In particular the restart needed by gate 6 comes near the end, after
everything that would lose its state.

Record results in `findings.md` (☐ → ☑, plus date and Obsidian version). If a gate
fails, its section there names the exact knob that flips.

---

## Setup

```bash
npm install
npm run dev      # watch build into test-vault/.obsidian/plugins/barosaurus
```

1. Install **hot-reload** into `test-vault/.obsidian/plugins/hot-reload/` — it is
   gitignored, so it is not in the repo. Without it, reload the vault by hand after
   each rebuild (`⌘R`).
2. Open `test-vault/` in Obsidian. Enable community plugins, then enable
   **Barosaurus**.
3. *Settings → Hotkeys* → search **"Barosaurus: Open"** → assign a key. The plugin
   ships without one on purpose.

The vault is seeded so that the single query `meeting` lights up six groups at once
— *Notes and files*, *Headings and blocks*, *Folders*, *Tags*, *Bookmarks* and
*Found in text*. Several gates lean on that.

---

## 1. Gate 4 — the hotkey takeover (you are already in Settings → Hotkeys)

The takeover is deliberately **not built**; what ships is the explanation. This is a
one-look confirmation, not a real test.

- **Do:** *Settings → Barosaurus → Opening the bar → Hotkey*.
- **Expect:** a description of the two steps and an **Open hotkey settings** button.
  Click it — it must land on *Hotkeys*, not on a blank settings pane.
- **If it differs:** the button routes through `openSettingsTab()` in
  `src/ui/unsafe.ts` and does nothing visible when the internal is gone. That is the
  designed degradation, so only a *crash* is a failure here.

## 2. Gate 3a — internal APIs (stay in Settings)

- **Do:** *Settings → Barosaurus → About → Internal APIs*.
- **Expect:** "Every undocumented API Barosaurus relies on is present in this
  Obsidian build."
- **If it lists anything:** note the exact names in `findings.md`. Each missing entry
  costs one feature, by design — but a missing **Commands** means there is no command
  bar, and that is a release blocker.

`chooser` and `updateSuggestions` are *not* covered by this row. They live on the
modal, not on `app`, and are checked behaviourally in step 6.

## 3. Gate 1 — Markdown inside a coloured span

The load-bearing one. Everything else is polish next to this.

- **Prepare:** open `Colour test.md`.
- **Do:** select the line `This line has **bold** and *italic* in it.`, open the bar,
  apply a text colour. Then look at it in **Live Preview** *and* switch to
  **Reading view**.
- **Expect (best case):** coloured, and still bold and italic in both views.
- **Expect (worst case):** coloured, with literal `**` and `*` visible.
- **Record:** which of the two, and whether the two views agree — they can differ,
  and a disagreement is its own finding.
- **If it fails:** wire `containsMarkdownSyntax()` (`src/core/style.ts`, already
  exported and tested) into the colour action so the bar warns **once**, and consider
  offering "strip formatting and colour" instead.

## 4. Gate 2 — `var(--color-*)` through the sanitizer

- **Prepare:** same note. Undo the colour from step 3 first, then use the control
  line (`This line has no markup at all`) so markdown cannot confound the result.
- **Do:** apply each of the eight colours to something. Then toggle the theme between
  light and dark. Then right-click → *Inspect* on one coloured span.
- **Expect:** all eight legible in both modes, and the `style` attribute intact and
  verbatim in the inspector — `style="color: var(--color-red);"`, not stripped and
  not rewritten.
- **If it fails:** set `DEFAULT_SETTINGS.colorMode` to `"hex"` in `src/settings.ts`.
  The hex path is built and tested; only the default changes.

## 5. Gate 7 — moving the selection past a group header

- **Prepare:** open the bar, type `meeting`. Confirm at least three groups have rows.
- **Do:** hold `↓` from the top all the way down, then back up with `↑`.
- **Expect:** the highlight never rests on a group label, never skips a real row, and
  does not stutter or flicker. Watch the very first render too — Obsidian selects row
  0, which is always a header.
- **Repeat with:** `⌃N` / `⌃P`.
- **If it fails:** add `setSelectedItem` to the chooser accessor in
  `src/ui/unsafe.ts` and swap the one line in `navigate()`. If the internal is absent
  as well, render group labels outside the list as a sticky heading — that costs the
  grouped look but removes the problem entirely.

## 6. Gate 3b — `chooser` and `updateSuggestions`, behaviourally

Do this while the list from step 5 is still open.

- **Do (`chooser`):** press `⌃N` and `⌃P`.
- **Expect:** the highlight moves. If nothing happens, `chooser` is gone — the
  designed degradation, so arrow keys must still work.
- **Do (`updateSuggestions`):** press `⌘K` on a highlighted result, without typing
  anything.
- **Expect:** the list changes to that result's actions immediately. If it only
  updates after you type a character, `updateSuggestions` is gone and the synthetic
  `input` fallback is carrying it.

## 7. Gate 8 — Escape pops one level

- **Do:** with a note result highlighted, press `⌘K`, choose **Move to…**. A folder
  picker opens with a breadcrumb pill. Press `esc` **once**.
- **Expect:** back to the result list, query intact. **Wrong:** the bar closes
  outright.
- **Also:** repeat with `⌫` on an empty input — same behaviour. And confirm `esc` at
  the top level does close the bar.
- **Bonus (worth doing here):** actually complete a move into `Projects/Archive`,
  which is two levels deep, and confirm the note lands where the row said it would.
- **If it fails:** intercept Escape on the capture-phase `inputEl` listener that
  already handles the arrows, rather than through the scope.

## 8. Full-text sanity check (not a gate, but the fastest way to catch a dead index)

- **Do:** type `escarpment`. That word appears in no filename, heading or tag —
  only in the body of `Reference/Glossary.md`.
- **Expect:** the note shows up under **Found in text**.
- **If nothing:** the index is not being read, and OCR and `excludedFolders` are dead
  with it.

## 9. Gate 6 — deferred tabs (this one needs the restart, so it goes late)

- **Prepare:** open six notes in six tabs — `Colour test`, `Meeting notes`,
  `Weekly sync`, `Retro`, `Roadmap`, `Keyboard shortcuts`.
- **Do:** quit Obsidian fully and reopen it, so most tabs come back deferred. Open
  the bar without clicking any tab first.
- **Expect:** every one of the six appears under **Open tabs** with the correct
  title — not just the active one — and the console is clean.
- **If it fails:** call `loadIfDeferred()` before reading and accept the cost, or
  list only non-deferred leaves and let the files source cover the rest.

## 10. Gate 5 — the software keyboard on phones

Needs a real phone; the desktop emulator does not reproduce keyboard behaviour.

- **Do:** sync or copy `test-vault/` to Obsidian Mobile, open the bar, focus the
  input, and scroll to the last result.
- **Expect:** the last row stays reachable above the keyboard. Repeat in landscape,
  and on the other platform — iOS and Android have historically differed here.
- **Also check on a tablet:** the full desktop layout, and — the point of the fix —
  the selected row is **visibly** highlighted.
- **If it fails:** add the `visualViewport.height` measurement and size the modal
  against it on `resize`. That is the only reason to take on the complexity.

---

## When you are done

Transfer each result into `findings.md`: flip ☐ to ☑, add the date and the Obsidian
version you tested on, and write down anything that behaved differently from
"expect" even if you would not call it a failure. Then the version goes to **0.9.1**
in `manifest.json`, `package.json` and `versions.json` in one commit, and the push to
`main` cuts the release.
