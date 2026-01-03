import { useState, useEffect } from "react";
import {
  X,
  CheckCircle2,
  XCircle,
  Globe,
  Server,
  Shield,
  Eye,
  EyeOff,
  Lock,
  Loader2,
} from "lucide-react";
import type { SystemStatus, CredentialStatus, ProxyStatus } from "@clauderon/client";
import { useSessionContext } from "../contexts/SessionContext";

type StatusDialogProps = {
  onClose: () => void;
}

export function StatusDialog({ onClose }: StatusDialogProps) {
  const { client } = useSessionContext();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Credential input state
  const [credentialInputs, setCredentialInputs] = useState<Map<string, string>>(new Map());
  const [showCredentials, setShowCredentials] = useState<Map<string, boolean>>(new Map());
  const [savingCredential, setSavingCredential] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<Map<string, string>>(new Map());

  const fetchStatus = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await client.getSystemStatus();
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void fetchStatus();
  }, [client]);

  const handleCredentialChange = (serviceId: string, value: string) => {
    const newInputs = new Map(credentialInputs);
    newInputs.set(serviceId, value);
    setCredentialInputs(newInputs);

    // Clear error when user starts typing
    const newErrors = new Map(saveErrors);
    newErrors.delete(serviceId);
    setSaveErrors(newErrors);
  };

  const toggleShowCredential = (serviceId: string) => {
    const newShow = new Map(showCredentials);
    newShow.set(serviceId, !newShow.get(serviceId));
    setShowCredentials(newShow);
  };

  const handleSaveCredential = async (serviceId: string) => {
    const value = credentialInputs.get(serviceId);
    if (!value || value.trim() === "") {
      const newErrors = new Map(saveErrors);
      newErrors.set(serviceId, "Credential value cannot be empty");
      setSaveErrors(newErrors);
      return;
    }

    setSavingCredential(serviceId);
    const newErrors = new Map(saveErrors);
    newErrors.delete(serviceId);
    setSaveErrors(newErrors);

    try {
      await client.updateCredential(serviceId, value);

      // Clear input
      const newInputs = new Map(credentialInputs);
      newInputs.delete(serviceId);
      setCredentialInputs(newInputs);

      // Refresh status to show updated credential
      await fetchStatus();
    } catch (err) {
      const newErrors = new Map(saveErrors);
      newErrors.set(serviceId, err instanceof Error ? err.message : String(err));
      setSaveErrors(newErrors);
      // Refresh to show actual state even on error
      await fetchStatus();
    } finally {
      setSavingCredential(null);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-40" style={{
        backgroundColor: 'hsl(220, 90%, 8%)',
        opacity: 0.85
      }} />
      <div className="fixed inset-0 flex items-center justify-center p-8 z-50">
        <div className="max-w-4xl w-full max-h-[90vh] flex flex-col border-4 border-primary" style={{
          backgroundColor: 'hsl(220, 15%, 95%)',
          boxShadow: '12px 12px 0 hsl(220, 85%, 25%), 24px 24px 0 hsl(220, 90%, 10%)'
        }}>
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b-4 border-primary" style={{ backgroundColor: 'hsl(220, 85%, 25%)' }}>
            <h2 className="text-2xl font-bold font-mono uppercase tracking-wider text-white">System Status</h2>
            <button
              onClick={onClose}
              className="p-2 border-2 border-white bg-white/10 hover:bg-red-600 hover:text-white transition-all font-bold text-white"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6 space-y-6">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          )}

          {error && (
            <div className="p-4 border-4 font-mono" style={{ backgroundColor: 'hsl(0, 75%, 95%)', color: 'hsl(0, 75%, 40%)', borderColor: 'hsl(0, 75%, 50%)' }}>
              <strong className="font-bold">ERROR:</strong> {error}
            </div>
          )}

          {status && (
            <>
              {/* Credentials Section */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Shield className="w-5 h-5 text-primary" />
                  <h3 className="text-xl font-semibold">Credentials</h3>
                </div>

                <div className="grid gap-3">
                  {status.credentials.map((cred: CredentialStatus) => (
                    <div
                      key={cred.service_id}
                      className="p-4 bg-secondary/30 rounded-md border border-secondary"
                    >
                      <div className="flex items-start justify-between gap-4">
                        {/* Credential Info */}
                        <div className="flex items-start gap-3 flex-1">
                          {cred.available ? (
                            <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                          ) : (
                            <XCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium">{cred.name}</span>
                              {cred.readonly && (
                                <div className="flex items-center gap-1 text-xs text-muted-foreground bg-background px-2 py-0.5 rounded">
                                  <Lock className="w-3 h-3" />
                                  <span>Environment</span>
                                </div>
                              )}
                              {cred.available && cred.source && !cred.readonly && (
                                <span className="text-xs text-muted-foreground bg-background px-2 py-0.5 rounded">
                                  {cred.source}
                                </span>
                              )}
                            </div>

                            {cred.available && cred.masked_value && (
                              <div className="mt-1 font-mono text-sm text-muted-foreground">
                                {cred.masked_value}
                              </div>
                            )}

                            {cred.readonly && cred.available && (
                              <div className="mt-2 text-sm text-muted-foreground">
                                Set via environment variable - cannot be updated through UI
                              </div>
                            )}

                            {/* Input for missing or file-based credentials */}
                            {!cred.available && !cred.readonly && (
                              <div className="mt-3 space-y-2">
                                <div className="flex gap-2">
                                  <div className="relative flex-1">
                                    <input
                                      type={showCredentials.get(cred.service_id) ? "text" : "password"}
                                      value={credentialInputs.get(cred.service_id) ?? ""}
                                      onChange={(e) => { handleCredentialChange(cred.service_id, e.target.value); }}
                                      placeholder={`Enter ${cred.name} credential`}
                                      className="w-full px-3 py-2 bg-background border border-input rounded-md pr-10"
                                      disabled={savingCredential === cred.service_id}
                                      autoComplete="new-password"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => { toggleShowCredential(cred.service_id); }}
                                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-secondary rounded"
                                      disabled={savingCredential === cred.service_id}
                                    >
                                      {showCredentials.get(cred.service_id) ? (
                                        <EyeOff className="w-4 h-4" />
                                      ) : (
                                        <Eye className="w-4 h-4" />
                                      )}
                                    </button>
                                  </div>
                                  <button
                                    onClick={() => { void handleSaveCredential(cred.service_id); }}
                                    disabled={savingCredential === cred.service_id}
                                    className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                  >
                                    {savingCredential === cred.service_id ? (
                                      <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span>Saving...</span>
                                      </>
                                    ) : (
                                      <span>Save</span>
                                    )}
                                  </button>
                                </div>
                                {saveErrors.get(cred.service_id) && (
                                  <div className="text-sm text-destructive">
                                    {saveErrors.get(cred.service_id)}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Status Badge */}
                        <div className="flex-shrink-0">
                          <span
                            className={`text-sm font-medium ${
                              cred.available ? "text-green-500" : "text-red-500"
                            }`}
                          >
                            {cred.available ? "Found" : "Not Found"}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Credentials can be loaded from environment variables or files in ~/.secrets/
                  </p>
                  <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
                    <p className="text-sm text-yellow-600 dark:text-yellow-500">
                      <strong>Note:</strong> Updated credentials will take effect for new sessions.
                      Restart the clauderon daemon for changes to apply to all services.
                    </p>
                  </div>
                </div>
              </div>

              {/* Proxies Section */}
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Server className="w-5 h-5 text-primary" />
                  <h3 className="text-xl font-semibold">Proxy Services</h3>
                </div>

                <div className="grid gap-3">
                  {status.proxies.map((proxy: ProxyStatus) => (
                    <div
                      key={`${proxy.name}-${String(proxy.port)}`}
                      className="flex items-center justify-between p-4 bg-secondary/30 rounded-md border border-secondary"
                    >
                      <div className="flex items-center gap-3">
                        {proxy.active ? (
                          <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                        ) : (
                          <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" />
                        )}
                        <div>
                          <div className="font-medium">{proxy.name}</div>
                          <div className="text-sm text-muted-foreground">
                            Port {String(proxy.port)} • {proxy.proxy_type}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`text-sm font-medium ${
                          proxy.active ? "text-green-500" : "text-red-500"
                        }`}
                      >
                        {proxy.active ? "Active" : "Inactive"}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Session Proxies Summary */}
                {status.active_session_proxies > 0 && (
                  <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-md">
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-blue-500" />
                      <span className="text-sm">
                        <span className="font-semibold">{String(status.active_session_proxies)}</span>{" "}
                        session-specific {status.active_session_proxies === 1 ? "proxy" : "proxies"} running
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Info Footer */}
              <div className="pt-4 border-t text-sm text-muted-foreground space-y-2">
                <p>
                  <strong>Credentials</strong> are automatically injected into proxied requests based on the target host.
                </p>
                <p>
                  <strong>Global proxies</strong> are shared across all sessions. <strong>Session proxies</strong> are created per Docker session with access mode filtering.
                </p>
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex justify-end gap-3 p-6 border-t-4 border-primary" style={{ backgroundColor: 'hsl(220, 15%, 90%)' }}>
          <button
            onClick={onClose}
            className="px-4 py-2 border-2 font-bold transition-colors"
            style={{ backgroundColor: 'hsl(220, 85%, 25%)', color: 'white', borderColor: 'hsl(220, 85%, 25%)' }}
          >
            Close
          </button>
        </div>
        </div>
      </div>
    </>
  );
}
