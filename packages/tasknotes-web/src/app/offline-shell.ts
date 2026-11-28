export async function registerOfflineShell(): Promise<boolean> {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return false;
  try {
    await navigator.serviceWorker.register("/facet-sw.js", { scope: "/" });
    return true;
  } catch {
    return false;
  }
}
