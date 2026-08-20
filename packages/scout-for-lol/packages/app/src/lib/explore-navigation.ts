/** Keep a delayed new-run response from overriding later user navigation. */
export function shouldOpenStartedExploreConversation(input: {
  submittedConversationId: string | null;
  submittedLocationKey: string;
  currentLocationKey: string;
}): boolean {
  return (
    input.submittedConversationId === null &&
    input.submittedLocationKey === input.currentLocationKey
  );
}
