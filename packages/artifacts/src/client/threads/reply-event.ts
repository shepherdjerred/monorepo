/** Fired on `document` with a thread id when the reviewer presses R to reply to it. */
export const REPLY_EVENT = "artifacts:reply";

export function requestReply(threadId: string): void {
  document.dispatchEvent(new CustomEvent(REPLY_EVENT, { detail: threadId }));
}
