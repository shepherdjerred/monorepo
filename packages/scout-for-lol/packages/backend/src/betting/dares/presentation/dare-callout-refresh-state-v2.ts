export function pendingDareV2CalloutRefresh() {
  return {
    calloutRefreshPending: true,
    calloutRefreshVersion: { increment: 1 },
  };
}
