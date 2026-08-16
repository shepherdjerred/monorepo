/**
 * Global API settings panel (for modal)
 */
import { useState } from "react";
import { z } from "zod";
import type { GlobalConfig } from "#src/lib/review-tool/config/schema.ts";
import {
  exportGlobalConfigAsBlob,
  importGlobalConfigFromBlob,
} from "#src/lib/review-tool/config-manager.ts";

const ErrorSchema = z.object({ message: z.string() });

type ApiSettingsPanelProps = {
  config: GlobalConfig;
  onChange: (config: GlobalConfig) => void;
};

export function ApiSettingsPanel({ config, onChange }: ApiSettingsPanelProps) {
  const [showImportExport, setShowImportExport] = useState(false);
  const [importInput, setImportInput] = useState("");

  const handleExport = () => {
    const blob = exportGlobalConfigAsBlob(config);
    void navigator.clipboard.writeText(blob);
    alert("API config copied to clipboard! Share this with trusted users.");
  };

  const handleImport = () => {
    try {
      const importedConfig = importGlobalConfigFromBlob(importInput.trim());
      onChange(importedConfig);
      setImportInput("");
      setShowImportExport(false);
      alert("API config imported successfully!");
    } catch (error) {
      const errorResult = ErrorSchema.safeParse(error);
      alert(
        errorResult.success
          ? errorResult.data.message
          : "Failed to import config",
      );
    }
  };

  return (
    <div className="space-y-6">
      {/* API Keys */}
      <div>
        <h3 className="text-sm font-semibold text-scout-ink mb-3">API Keys</h3>
        <div className="space-y-4">
          <div>
            <label
              htmlFor="openrouter-api-key"
              className="block text-sm font-medium text-scout-ink mb-1"
            >
              OpenRouter API Key
            </label>
            <input
              id="openrouter-api-key"
              type="password"
              value={config.api.openRouterApiKey ?? ""}
              onChange={(e) => {
                onChange({
                  ...config,
                  api: {
                    ...config.api,
                    openRouterApiKey: e.target.value || undefined,
                  },
                });
              }}
              className="w-full px-3 py-2 bg-scout-surface text-scout-ink border border-scout-border rounded focus:ring-2 focus:ring-scout-focus focus:border-scout-brand placeholder:text-scout-subtle"
              placeholder="sk-or-v1-..."
            />
          </div>
        </div>
      </div>

      {/* S3/R2 Configuration */}
      <div className="pt-4 border-t border-scout-border">
        <h3 className="text-sm font-semibold text-scout-ink mb-3">
          S3 / R2 Configuration (Optional)
        </h3>
        <div className="space-y-4">
          <div>
            <label
              htmlFor="s3-bucket-name"
              className="block text-sm font-medium text-scout-ink mb-1"
            >
              Bucket Name
            </label>
            <input
              id="s3-bucket-name"
              type="text"
              value={config.api.s3BucketName ?? ""}
              onChange={(e) => {
                onChange({
                  ...config,
                  api: {
                    ...config.api,
                    s3BucketName: e.target.value || undefined,
                  },
                });
              }}
              className="w-full px-3 py-2 bg-scout-surface text-scout-ink border border-scout-border rounded focus:ring-2 focus:ring-scout-focus focus:border-scout-brand placeholder:text-scout-subtle"
              placeholder="my-bucket-name"
            />
          </div>
          <div>
            <label
              htmlFor="aws-access-key-id"
              className="block text-sm font-medium text-scout-ink mb-1"
            >
              Access Key ID
            </label>
            <input
              id="aws-access-key-id"
              type="password"
              value={config.api.awsAccessKeyId ?? ""}
              onChange={(e) => {
                onChange({
                  ...config,
                  api: {
                    ...config.api,
                    awsAccessKeyId: e.target.value || undefined,
                  },
                });
              }}
              className="w-full px-3 py-2 bg-scout-surface text-scout-ink border border-scout-border rounded focus:ring-2 focus:ring-scout-focus focus:border-scout-brand placeholder:text-scout-subtle"
              placeholder="AKIA... or R2 access key"
            />
          </div>
          <div>
            <label
              htmlFor="aws-secret-access-key"
              className="block text-sm font-medium text-scout-ink mb-1"
            >
              Secret Access Key
            </label>
            <input
              id="aws-secret-access-key"
              type="password"
              value={config.api.awsSecretAccessKey ?? ""}
              onChange={(e) => {
                onChange({
                  ...config,
                  api: {
                    ...config.api,
                    awsSecretAccessKey: e.target.value || undefined,
                  },
                });
              }}
              className="w-full px-3 py-2 bg-scout-surface text-scout-ink border border-scout-border rounded focus:ring-2 focus:ring-scout-focus focus:border-scout-brand placeholder:text-scout-subtle"
              placeholder="••••••••"
            />
          </div>
          <div>
            <label
              htmlFor="s3-endpoint"
              className="block text-sm font-medium text-scout-ink mb-1"
            >
              Endpoint URL (for Cloudflare R2)
            </label>
            <input
              id="s3-endpoint"
              type="text"
              value={config.api.s3Endpoint ?? ""}
              onChange={(e) => {
                onChange({
                  ...config,
                  api: {
                    ...config.api,
                    s3Endpoint: e.target.value || undefined,
                  },
                });
              }}
              className="w-full px-3 py-2 bg-scout-surface text-scout-ink border border-scout-border rounded focus:ring-2 focus:ring-scout-focus focus:border-scout-brand placeholder:text-scout-subtle"
              placeholder="https://<account-id>.r2.cloudflarestorage.com"
            />
            <p className="mt-1 text-xs text-scout-subtle">
              Leave empty for AWS S3. For R2, use your account endpoint.
            </p>
          </div>
          <div>
            <label
              htmlFor="aws-region"
              className="block text-sm font-medium text-scout-ink mb-1"
            >
              Region
            </label>
            <input
              id="aws-region"
              type="text"
              value={config.api.awsRegion}
              onChange={(e) => {
                onChange({
                  ...config,
                  api: { ...config.api, awsRegion: e.target.value },
                });
              }}
              className="w-full px-3 py-2 bg-scout-surface text-scout-ink border border-scout-border rounded focus:ring-2 focus:ring-scout-focus focus:border-scout-brand placeholder:text-scout-subtle"
              placeholder="us-east-1 or auto for R2"
            />
            <p className="mt-1 text-xs text-scout-subtle">
              For R2, use &quot;auto&quot; or &quot;us-east-1&quot;
            </p>
          </div>
        </div>
      </div>

      {/* Import/Export */}
      <div className="pt-4 border-t border-scout-border">
        <h3 className="text-sm font-semibold text-scout-ink mb-3">
          Share API Config
        </h3>

        {showImportExport ? (
          <div className="space-y-2">
            <textarea
              value={importInput}
              onChange={(e) => {
                setImportInput(e.target.value);
              }}
              placeholder="Paste config blob here..."
              rows={3}
              className="w-full px-3 py-2 bg-scout-surface text-scout-ink border border-scout-border rounded focus:ring-2 focus:ring-scout-focus focus:border-scout-success font-mono text-xs placeholder:text-scout-subtle"
            />
            <div className="flex gap-2">
              <button
                onClick={handleImport}
                disabled={!importInput.trim()}
                className="flex-1 px-3 py-2 bg-scout-success text-scout-success-ink rounded hover:bg-scout-success transition-colors text-sm disabled:bg-scout-canvas disabled:cursor-not-allowed"
              >
                Import
              </button>
              <button
                onClick={() => {
                  setShowImportExport(false);
                  setImportInput("");
                }}
                className="flex-1 px-3 py-2 bg-scout-canvas text-scout-ink rounded hover:bg-scout-canvas transition-colors text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={handleExport}
              className="flex-1 px-3 py-2 bg-scout-brand text-scout-brand-ink rounded hover:bg-scout-brand transition-colors text-sm font-medium"
            >
              📋 Export (Copy to Clipboard)
            </button>
            <button
              onClick={() => {
                setShowImportExport(true);
              }}
              className="flex-1 px-3 py-2 bg-scout-success text-scout-success-ink rounded hover:bg-scout-success transition-colors text-sm"
            >
              📥 Import
            </button>
          </div>
        )}

        <p className="text-xs text-scout-subtle mt-2">
          Export creates a base64-encoded blob with API keys. Only share with
          trusted users.
        </p>
      </div>

      <div className="text-xs text-scout-warning bg-scout-warning border border-scout-warning rounded p-3">
        ⚠️ API keys are stored in browser IndexedDB.
      </div>
    </div>
  );
}
