/**
 * Debounced search where only the LATEST request may write its result.
 *
 * Used by the composers' mention popovers (ChatInput, PanelChatInput) and the
 * conversation list's message search. Searches are async and can resolve out
 * of order (a slow `@src/` file walk lands after the faster `@src/li`), and a
 * search can still be in flight after its popover closed. Without this guard
 * an old answer replaces the current list, and Enter then picks an item the
 * user never asked for.
 */
export interface LatestSearchOptions<T> {
	delayMs: number;
	/** Written instead of the result when the search throws. */
	fallback: T;
	onLoading: (loading: boolean) => void;
	onResult: (result: T) => void;
}

export interface LatestSearch<T> {
	/** Run `search` after the debounce; any earlier request becomes stale. */
	schedule: (search: () => Promise<T>) => void;
	/** Drop the pending and in-flight requests (closed, cleared, unmounted). */
	cancel: () => void;
}

export function createLatestSearch<T>(options: LatestSearchOptions<T>): LatestSearch<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let generation = 0;

	function cancel() {
		clearTimeout(timer);
		generation++;
		options.onLoading(false);
	}

	function schedule(search: () => Promise<T>) {
		clearTimeout(timer);
		const mine = ++generation;
		timer = setTimeout(async () => {
			options.onLoading(true);
			let result: T;
			try {
				result = await search();
			} catch {
				result = options.fallback;
			}
			if (mine !== generation) return;
			options.onResult(result);
			options.onLoading(false);
		}, options.delayMs);
	}

	return { schedule, cancel };
}
