import type { Page } from "@playwright/test";

/**
 * Navigate in-app, the way a link click does: SvelteKit's router intercepts
 * the click, so a page on the same route is REUSED, not remounted. That is
 * the path a full `page.goto` never exercises (one run's page linking to
 * another, a rename that follows the new name).
 *
 * Appends a temporary anchor, clicks it with a real Playwright click, and
 * removes it. The pointer then moves to the middle of the main pane, so it
 * does not linger over a sidebar control and leave a hover tooltip in the
 * evidence screenshot.
 */
export async function clickInAppLink(page: Page, href: string): Promise<void> {
	await page.evaluate((target) => {
		const link = document.createElement("a");
		link.href = target;
		link.textContent = "in-app link";
		link.dataset.testid = "e2e-in-app-link";
		link.style.cssText = "position:fixed;top:50%;right:0;z-index:2147483647";
		document.body.append(link);
	}, href);
	await page.getByTestId("e2e-in-app-link").click();
	await page.evaluate(() => document.querySelector('[data-testid="e2e-in-app-link"]')?.remove());
	const viewport = page.viewportSize();
	if (viewport) await page.mouse.move(viewport.width * 0.6, viewport.height * 0.8);
}
