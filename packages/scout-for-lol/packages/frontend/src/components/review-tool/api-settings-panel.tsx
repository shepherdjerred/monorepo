/**
 * Global API settings panel (for modal)
 */
import { useState } from "react";
import { z } from "zod";
import type { GlobalConfig } from "@scout-for-lol/frontend/lib/review-tool/config/schema";
import {
  exportGlobalConfigAsBlob,
  importGlobalConfigFromBlob,
} from "@scout-for-lol/frontend/lib/review-tool/config-manager";

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
        <h3 className="text-sm font-semibold text-surface-700 mb-3">
          API Keys
        </h3>
        <div className="space-y-4">
          <div>
            <label
              htmlFor="openai-api-key"
              className="block text-sm font-medium text-surface-700 mb-1"
            >
              OpenAI API Key
            </label>
            <input
              id="openai-api-key"
              type="password"
              value={config.api.openaiApiKey ?? ""}
              onChange={(e) => {
                onChange({
                  ...config,
                  api: {
                    ...config.api,
                    openaiApiKey: e.target.value || undefined,
                  },
                });
              }}
              className="w-full px-3 py-2 bg-white text-surface-900 border border-surface-300 rounded focus:ring-2 focus:ring-brand-500 focus:border-brand-500 placeholder:text-surface-400"
              placeholder="sk-..."
            />
          </div>
          <div>
            <label
              htmlFor="gemini-api-key"
              className="block text-sm font-medium text-surface-700 mb-1"
            >
              Gemini API Key
            </label>
            <input
              id="gemini-api-key"
              type="password"
              value={config.api.geminiApiKey ?? ""}
              onChange={(e) => {
                onChange({
                  ...config,
                  api: {
                    ...config.api,
                    geminiApiKey: e.target.value || undefined,
                  },
                });
              }}
              className="w-full px-3 py-2 bg-white text-surface-900 border border-surface-300 rounded focus:ring-2 focus:ring-brand-500 focus:border-brand-500 placeholder:text-surface-400"
              placeholder="AI..."
            />
          </div>
        </div>
      </div>

      {/* S3/R2 Configuration */}
      <div className="pt-4 border-t border-surface-200">
        <h3 className="text-sm font-semibold text-surface-700 mb-3">
          S3 / R2 Configuration (Optional)
        </h3>
        <div className="space-y-4">
          <div>
            <label
              htmlFor="s3-bucket-name"
              className="block text-sm font-medium text-surface-700 mb-1"
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
              className="w-full px-3 py-2 bg-white text-surface-900 border border-surface-300 rounded focus:ring-2 focus:ring-brand-500 focus:border-brand-500 placeholder:text-surface-400"
              placeholder="my-bucket-name"
            />
          </div>
          <div>
            <label
              htmlFor="aws-access-key-id"
              className="block text-sm font-medium text-surface-700 mb-1"
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
              className="w-full px-3 py-2 bg-white text-surface-900 border border-surface-300 rounded focus:ring-2 focus:ring-brand-500 focus:border-brand-500 placeholder:text-surface-400"
              placeholder="AKIA... or R2 access key"
            />
          </div>
          <div>
            <label
              htmlFor="aws-secret-access-key"
              className="block text-sm font-medium text-surface-700 mb-1"
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
              className="w-full px-3 py-2 bg-white text-surface-900 border border-surface-300 rounded focus:ring-2 focus:ring-brand-500 focus:border-brand-500 placeholder:text-surface-400"
              placeholder="••••••••"
            />
          </div>
          <div>
            <label
              htmlFor="s3-endpoint"
              className="block text-sm font-medium text-surface-700 mb-1"
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
              className="w-full px-3 py-2 bg-white text-surface-900 border border-surface-300 rounded focus:ring-2 focus:ring-brand-500 focus:border-brand-500 placeholder:text-surface-400"
              placeholder="https://<account-id>.r2.cloudflarestorage.com"
            />
            <p className="mt-1 text-xs text-surface-500">
              Leave empty for AWS S3. For R2, use your account endpoint.
            </p>
          </div>
          <div>
            <label
              htmlFor="aws-region"
              className="block text-sm font-medium text-surface-700 mb-1"
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
              className="w-full px-3 py-2 bg-white text-surface-900 border border-surface-300 rounded focus:ring-2 focus:ring-brand-500 focus:border-brand-500 placeholder:text-surface-400"
              placeholder="us-east-1 or auto for R2"
            />
            <p className="mt-1 text-xs text-surface-500">
              For R2, use &quot;auto&quot; or &quot;us-east-1&quot;
            </p>
          </div>
        </div>
      </div>

      {/* Import/Export */}
      <div className="pt-4 border-t border-surface-200">
        <h3 className="text-sm font-semibold text-surface-700 mb-3">
          Share API Config
        </h3>

        {!showImportExport ? (
          <div className="flex gap-2">
            <button
              onClick={handleExport}
              className="flex-1 px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              📋 Export (Copy to Clipboard)
            </button>
            <button
              onClick={() => {
                setShowImportExport(true);
              }}
              className="flex-1 px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors text-sm"
            >
              📥 Import
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <textarea
              value={importInput}
              onChange={(e) => {
                setImportInput(e.target.value);
              }}
              placeholder="Paste config blob here..."
              rows={3}
              className="w-full px-3 py-2 bg-white text-surface-900 border border-surface-300 rounded focus:ring-2 focus:ring-green-500 focus:border-green-500 font-mono text-xs placeholder:text-surface-400"
            />
            <div className="flex gap-2">
              <button
                onClick={handleImport}
                disabled={!importInput.trim()}
                className="flex-1 px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700 transition-colors text-sm disabled:bg-surface-300 disabled:cursor-not-allowed"
              >
                Import
              </button>
              <button
                onClick={() => {
                  setShowImportExport(false);
                  setImportInput("");
                }}
                className="flex-1 px-3 py-2 bg-surface-300 text-surface-700 rounded hover:bg-surface-400 transition-colors text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <p className="text-xs text-surface-500 mt-2">
          Export creates a base64-encoded blob with API keys. Only share with
          trusted users.
        </p>
      </div>

      <div className="text-xs text-yellow-700 bg-yellow-50 border border-yellow-200 rounded p-3">
        ⚠️ API keys are stored in browser IndexedDB.
      </div>
    </div>
  );
}
