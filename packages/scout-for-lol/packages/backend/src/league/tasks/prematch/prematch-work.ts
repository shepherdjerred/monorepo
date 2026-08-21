/** Whether prematch needs the shared Riot rank snapshot. */
export function shouldAcquirePrematchRanks(input: {
  predictionEligible: boolean;
  deliveryChannelCount: number;
}): boolean {
  return input.predictionEligible || input.deliveryChannelCount > 0;
}
