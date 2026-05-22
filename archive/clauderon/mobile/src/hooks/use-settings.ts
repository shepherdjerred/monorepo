import { useState, useEffect, useCallback } from "react";
import { getDaemonUrl, setDaemonUrl } from "../lib/storage";
import { isValidUrl } from "../lib/utils";

export function useSettings() {
  const [daemonUrl, setDaemonUrlState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load daemon URL on mount
  useEffect(() => {
    async function load() {
      try {
        const url = await getDaemonUrl();
        setDaemonUrlState(url);
      } catch (error_) {
        setError(error_ instanceof Error ? error_.message : "Failed to load settings");
      } finally {
        setIsLoading(false);
      }
    }
    void load();
  }, []);

  // Save daemon URL
  const saveDaemonUrl = useCallback(async (url: string): Promise<boolean> => {
    // Validate URL
    if (!isValidUrl(url)) {
      setError("Invalid URL format. Must start with http:// or https://");
      return false;
    }

    try {
      await setDaemonUrl(url);
      setDaemonUrlState(url);
      setError(null);
      return true;
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : "Failed to save URL");
      return false;
    }
  }, []);

  return {
    daemonUrl,
    isLoading,
    error,
    saveDaemonUrl,
  };
}
