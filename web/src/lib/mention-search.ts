import { searchMentions, type MentionResult } from "$lib/api";

/** The MentionResult fields the popover reads (MentionPopover's MentionItem). */
export type MentionSearchItem = Pick<MentionResult, "name" | "description" | "kind" | "source" | "fileCount" | "insertText">;

/** Search mentions and shape the results for MentionPopover (both composers). */
export async function searchMentionItems(
	query: string,
	type: Parameters<typeof searchMentions>[1],
	projectId: string | undefined,
): Promise<MentionSearchItem[]> {
	const results = await searchMentions(query, type, projectId);
	return results.map((r) => ({
		name: r.name,
		description: r.description,
		kind: r.kind,
		source: r.source,
		fileCount: r.fileCount,
		insertText: r.insertText,
	}));
}
