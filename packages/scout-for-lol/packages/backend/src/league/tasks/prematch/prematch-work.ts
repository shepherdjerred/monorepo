/** Whether prematch needs the shared Riot rank snapshot. */
export function shouldAcquirePrematchRanks(input: {
  deliveryChannelCount: number;
}): boolean {
  return input.deliveryChannelCount > 0;
}
