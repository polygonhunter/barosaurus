import { Platform } from "obsidian";

/**
 * The gliding selection pill: one absolutely positioned element inside the
 * scrolling result list that slides behind whichever row carries
 * `.is-selected`, replacing the theme's hard highlight rectangle.
 *
 * Purely additive. If the expected DOM is not there — no rows, or a row the
 * renderer did not build — the fallback class goes on and the CSS highlight
 * takes over, so the selection is never invisible.
 */
export class SelectionPill {
	private pillEl: HTMLElement | null = null;
	private listEl: HTMLElement | null = null;
	/** The animation frame an update is queued for, if any. */
	private frame: number | null = null;
	private frameWin: Window | null = null;

	/**
	 * @param fallbackEl element that carries `barosaurus-no-pill` when the
	 * pill cannot be positioned; scoping the CSS fallback to it keeps the
	 * plain highlight off every other prompt.
	 */
	constructor(private readonly fallbackEl: HTMLElement) {}

	/**
	 * Idempotent; call freely on every render pass.
	 *
	 * There is no observer of its own any more. The pill used to watch the
	 * list for class flips next to the modal's observer watching the same
	 * list for the same flips, and each fired a synchronous measure-and-write
	 * — layout thrash on every arrow key. The modal now calls `schedule()`
	 * from its one selection hook instead.
	 */
	mount(listEl: HTMLElement): void {
		// Touch has no hover, no arrow keys and no patience for a blur layer.
		// isPhone, NOT isMobile: isMobile covers tablets too, and a tablet runs
		// the full desktop layout. Skipping it there left the selection with no
		// pill AND no theme highlight, so nothing showed which row was active.
		if (Platform.isPhone) return;
		if (this.pillEl !== null && this.pillEl.isConnected && this.listEl === listEl) return;
		this.destroy();
		this.listEl = listEl;
		this.pillEl = listEl.createDiv({ cls: "barosaurus-pill is-teleporting" });
		this.schedule();
	}

	/**
	 * Re-measure on the next frame. Any number of calls within one frame
	 * collapse into one read and one write, after the browser has laid out
	 * whatever changed the selection.
	 */
	schedule(): void {
		const pill = this.pillEl;
		if (pill === null || this.frame !== null) return;
		const win = pill.win;
		if (typeof win.requestAnimationFrame !== "function") {
			this.update();
			return;
		}
		this.frameWin = win;
		this.frame = win.requestAnimationFrame(() => {
			this.frame = null;
			this.frameWin = null;
			this.update();
		});
	}

	private update(): void {
		const pill = this.pillEl;
		const list = this.listEl;
		if (pill === null || list === null) return;
		if (!pill.isConnected) {
			// Obsidian re-rendered the list and dropped us; remount lazily and
			// land without animating from wherever we used to be.
			list.appendChild(pill);
			pill.addClass("is-teleporting");
		}

		const selected = list.querySelector<HTMLElement>(".suggestion-item.is-selected");
		if (selected === null) {
			this.hide(pill);
			return;
		}
		// A group overline is not a target; it must not look selected either.
		if (selected.hasClass("barosaurus-group-row")) {
			this.hide(pill);
			return;
		}

		const row = selected.querySelector<HTMLElement>(".barosaurus-row");
		if (row === null) {
			// Unexpected shape (a row someone else rendered): give the theme
			// its highlight back rather than leaving the selection unmarked.
			this.fallbackEl.addClass("barosaurus-no-pill");
			this.hide(pill);
			return;
		}
		this.fallbackEl.removeClass("barosaurus-no-pill");

		// Measure the row, not the suggestion item — padding stays outside.
		pill.setCssStyles({
			opacity: "1",
			transform: `translateY(${selected.offsetTop + row.offsetTop}px)`,
			height: `${row.offsetHeight}px`,
		});

		if (pill.hasClass("is-teleporting")) {
			// Two frames: land instantly on the first, let the transition come
			// back on the second. One frame is not enough — the style flush and
			// the class removal end up in the same frame and it animates anyway.
			const win = pill.win;
			win.requestAnimationFrame(() => {
				win.requestAnimationFrame(() => pill.removeClass("is-teleporting"));
			});
		}
	}

	private hide(pill: HTMLElement): void {
		pill.setCssStyles({ opacity: "0" });
	}

	destroy(): void {
		if (this.frame !== null) this.frameWin?.cancelAnimationFrame(this.frame);
		this.frame = null;
		this.frameWin = null;
		this.pillEl?.remove();
		this.pillEl = null;
		this.listEl = null;
		this.fallbackEl.removeClass("barosaurus-no-pill");
	}
}
