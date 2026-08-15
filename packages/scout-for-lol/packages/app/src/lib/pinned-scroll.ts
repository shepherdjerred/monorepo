/**
 * Whether the window is scrolled to (or near) the bottom of the document.
 *
 * The page body is the scroll container, so this is measured against the
 * window rather than an element. Pulled out of the hook so the initial state
 * and the scroll handler cannot answer it differently: assuming pinned on mount
 * is what yanks a reader who landed part-way up a conversation — a restored
 * scroll position, or a link into the middle of one — down to the bottom on the
 * first streamed token, before they have scrolled at all.
 */
export const PINNED_BOTTOM_SLACK_PX = 120;

export function isScrolledToBottom(input: {
  innerHeight: number;
  scrollY: number;
  scrollHeight: number;
  slackPx?: number;
}): boolean {
  const slack = input.slackPx ?? PINNED_BOTTOM_SLACK_PX;
  return input.innerHeight + input.scrollY >= input.scrollHeight - slack;
}
