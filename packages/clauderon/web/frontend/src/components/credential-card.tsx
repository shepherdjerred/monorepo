import {
  CheckCircle2,
  XCircle,
  Eye,
  EyeOff,
  Lock,
  Loader2,
} from "lucide-react";
import type { CredentialStatus } from "@clauderon/client";

type CredentialCardProps = {
  cred: CredentialStatus;
  credentialInput: string;
  showCredential: boolean;
  savingCredential: boolean;
  saveError: string | undefined;
  onCredentialChange: (serviceId: string, value: string) => void;
  onToggleShow: (serviceId: string) => void;
  onSave: (serviceId: string) => void;
};

function CredentialInputForm({
  cred,
  credentialInput,
  showCredential,
  savingCredential,
  saveError,
  onCredentialChange,
  onToggleShow,
  onSave,
}: CredentialCardProps) {
  return (
    <div className="mt-3 space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={showCredential ? "text" : "password"}
            value={credentialInput}
            onChange={(e) => {
              onCredentialChange(cred.service_id, e.target.value);
            }}
            placeholder={`Enter ${cred.name} credential`}
            className="w-full px-3 py-2 bg-background border border-input rounded-md pr-10"
            disabled={savingCredential}
            autoComplete="new-password"
          />
          <button
            type="button"
            onClick={() => {
              onToggleShow(cred.service_id);
            }}
            className="cursor-pointer absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-secondary rounded transition-colors duration-200"
            disabled={savingCredential}
          >
            {showCredential ? (
              <EyeOff className="w-4 h-4" />
            ) : (
              <Eye className="w-4 h-4" />
            )}
          </button>
        </div>
        <button
          onClick={() => {
            onSave(cred.service_id);
          }}
          disabled={savingCredential}
          className="cursor-pointer px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {savingCredential ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Saving...</span>
            </>
          ) : (
            <span>Save</span>
          )}
        </button>
      </div>
      {saveError != null && saveError.length > 0 && (
        <div className="text-sm text-destructive">{saveError}</div>
      )}
    </div>
  );
}

export function CredentialCard({
  cred,
  credentialInput,
  showCredential,
  savingCredential,
  saveError,
  onCredentialChange,
  onToggleShow,
  onSave,
}: CredentialCardProps) {
  return (
    <div className="p-4 bg-secondary/30 rounded-md border border-secondary">
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
              {cred.available &&
                cred.source != null &&
                cred.source.length > 0 &&
                !cred.readonly && (
                  <span className="text-xs text-muted-foreground bg-background px-2 py-0.5 rounded">
                    {cred.source}
                  </span>
                )}
            </div>

            {cred.available &&
              cred.masked_value != null &&
              cred.masked_value.length > 0 && (
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
              <CredentialInputForm
                cred={cred}
                credentialInput={credentialInput}
                showCredential={showCredential}
                savingCredential={savingCredential}
                saveError={saveError}
                onCredentialChange={onCredentialChange}
                onToggleShow={onToggleShow}
                onSave={onSave}
              />
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
  );
}
