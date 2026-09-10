/**
 * Wrap a release callback so it runs at most once. The goal terminal paths
 * (finish, timeout, replace, shutdown) can race, and releasing the emulator's
 * input lease twice is a bug — this makes the second release a no-op.
 */
export function oneShot(action: () => void): () => void {
  let completed = false;
  return () => {
    if (completed) return;
    completed = true;
    action();
  };
}

function noOpRelease(): void {
  return;
}

/**
 * Default lease acquirer for tests and contexts without a real emulator lease.
 * Acquiring is a no-op and releasing does nothing.
 */
export function noOpAcquireInputLease(): () => void {
  return noOpRelease;
}
