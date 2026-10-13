import { untrack } from "svelte";

/**
 * Run `load` now and again whenever `key()` changes, for a page whose data
 * depends on a route param.
 *
 * SvelteKit REUSES a page component when only its params change (one run to
 * another, a workflow renamed in place), so an `onMount` load runs once and
 * the page keeps showing the first subject. Call this during component
 * init instead.
 *
 * `load` runs untracked, so only `key()` decides when it re-runs. `isStale()`
 * turns true once the key has moved on (or the page unmounted); check it
 * after each await before writing state, so a slow answer for the previous
 * key never lands on the new one.
 */
export function reloadOn<K>(
	key: () => K,
	load: (key: K, isStale: () => boolean) => unknown,
): void {
	$effect(() => {
		const current = key();
		let stale = false;
		untrack(() => {
			void load(current, () => stale);
		});
		return () => {
			stale = true;
		};
	});
}
