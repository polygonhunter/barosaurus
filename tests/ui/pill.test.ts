// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { SelectionPill } from "../../src/ui/pill";

/** The selection pill measures once per frame, however often it is asked. */
describe("SelectionPill", () => {
	it("collapses many schedule() calls into one animation frame", () => {
		const frames: FrameRequestCallback[] = [];
		const raf = vi
			.spyOn(window, "requestAnimationFrame")
			.mockImplementation((cb: FrameRequestCallback) => {
				frames.push(cb);
				return frames.length;
			});
		const host = document.body.createDiv();
		const list = host.createDiv();
		const pill = new SelectionPill(host);
		pill.mount(list); // schedules the first measurement
		pill.schedule();
		pill.schedule();
		expect(frames.length).toBe(1);

		frames.shift()?.(0);
		pill.schedule();
		expect(frames.length).toBe(1); // a new frame only after the last one ran
		pill.destroy();
		raf.mockRestore();
	});
});
