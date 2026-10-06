import { createYielder } from "../core/budget";

/**
 * A time-budgeted yield for the build loops (see core/budget.ts).
 * setTimeout(0), NOT requestIdleCallback: the latter does not exist on every
 * mobile platform we ship to. `window` and not `activeWindow` on purpose —
 * these loops must survive a popout being closed mid-build.
 */
export function yielder(): () => Promise<boolean> {
	return createYielder({
		now: () => performance.now(),
		sleep: () => new Promise((resolve) => window.setTimeout(resolve, 0)),
	});
}
