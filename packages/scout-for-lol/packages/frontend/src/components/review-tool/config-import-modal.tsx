/**
 * Modal for importing config bundles
 */
import { useState } from "react";
import { z } from "zod";
import type { ConfigBundle } from "@scout-for-lol/frontend/lib/review-tool/config-export";
import type { TabConfig } from "@scout-for-lol/frontend/lib/review-tool/config/schema";
import {
  importAllConfigFromJSON,
  applyConfigBundle,
  getConfigBundleSummary,
} from "@scout-for-lol/frontend/lib/review-tool/config-export";

const ErrorSchema = z.object({ message: z.string() });

type ConfigImportModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onImportSuccess: (tabConfig?: TabConfig) => void;
};

export function ConfigImportModal({
  isOpen,
  onClose,
  onImportSuccess,
}: ConfigImportModalProps) {
  const [jsonInput, setJsonInput] = useState("");
  const [parsedBundle, setParsedBundle] = useState<ConfigBundle | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [importTabConfig, setImportTabConfig] = useState(true);
  const [importPersonalities, setImportPersonalities] = useState(true);
  const [importArtStyles, setImportArtStyles] = useState(true);
  const [mergeWithExisting, setMergeWithExisting] = useState(true);

  if (!isOpen) {
    return null;
  }

  const handleParseJSON = () => {
    try {
      const bundle = importAllConfigFromJSON(jsonInput);
      setParsedBundle(bundle);
      setParseError(null);
    } catch (error) {
      const errorResult = ErrorSchema.safeParse(error);
      setParseError(
        errorResult.success ? errorResult.data.message : String(error),
      );
      setParsedBundle(null);
    }
  };

  const handleImport = () => {
    if (!parsedBundle) {
      return;
    }

    void (async () => {
      try {
        const importedTabConfig = await applyConfigBundle(parsedBundle, {
          importTabConfig,
          importPersonalities,
          importArtStyles,
          mergeWithExisting,
        });

        alert("Config imported successfully!");
        onImportSuccess(importedTabConfig);
        handleClose();
      } catch (error) {
        const errorResult = ErrorSchema.safeParse(error);
        alert(
          `Failed to import config: ${errorResult.success ? errorResult.data.message : String(error)}`,
        );
      }
    })();
  };

  const handleFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const content = await file.text();
    setJsonInput(content);
    try {
      const bundle = importAllConfigFromJSON(content);
      setParsedBundle(bundle);
      setParseError(null);
    } catch (error) {
      const errorResult = ErrorSchema.safeParse(error);
      setParseError(
        errorResult.success ? errorResult.data.message : String(error),
      );
      setParsedBundle(null);
    }
  };

  const handleClose = () => {
    setJsonInput("");
    setParsedBundle(null);
    setParseError(null);
    setImportTabConfig(true);
    setImportPersonalities(true);
    setImportArtStyles(true);
    setMergeWithExisting(true);
    onClose();
  };

  const summary = parsedBundle ? getConfigBundleSummary(parsedBundle) : null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        role="button"
        tabIndex={0}
        className="fixed inset-0 bg-black/30 backdrop-blur-sm transition-all"
        onClick={handleClose}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleClose();
          }
        }}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          className="relative bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-surface-200 px-6 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-surface-900">
                Import Configuration
              </h2>
              <p className="text-sm text-surface-500 mt-1">
                Import shared config from JSON
              </p>
            </div>
            <button
              onClick={handleClose}
              className="text-surface-400 hover:text-surface-600 transition-colors"
              title="Close"
            >
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            {/* File Upload */}
            <div>
              <label
                htmlFor="upload-config-file"
                className="block text-sm font-medium text-surface-700 mb-2"
              >
                Upload Config File
              </label>
              <input
                id="upload-config-file"
                type="file"
                accept=".json"
                onChange={(e) => void handleFileUpload(e)}
                className="block w-full text-sm text-surface-500
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-lg file:border-0
                  file:text-sm file:font-semibold
                  file:bg-blue-50 file:text-blue-700
                  hover:file:bg-blue-100
                  cursor-pointer"
              />
            </div>

            {/* Or Paste JSON */}
            <div>
              <label
                htmlFor="or-paste-json"
                className="block text-sm font-medium text-surface-700 mb-2"
              >
                Or Paste JSON
              </label>
              <textarea
                id="or-paste-json"
                value={jsonInput}
                onChange={(e) => {
                  setJsonInput(e.target.value);
                }}
                placeholder="Paste your config JSON here..."
                className="w-full h-32 px-3 py-2 border border-surface-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono text-sm"
              />
              <button
                onClick={handleParseJSON}
                className="mt-2 px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!jsonInput.trim()}
              >
                Parse JSON
              </button>
            </div>

            {/* Parse Error */}
            {parseError !== null && parseError.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm text-red-800 font-medium">
                  Failed to parse JSON:
                </p>
                <p className="text-sm text-red-700 mt-1 font-mono">
                  {parseError}
                </p>
              </div>
            )}

            {/* Summary */}
            {summary && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm font-semibold text-blue-900 mb-2">
                  Config Bundle Summary:
                </p>
                <ul className="text-sm text-blue-800 space-y-1">
                  <li>
                    • Exported: {new Date(summary.exportedAt).toLocaleString()}
                  </li>
                  <li>
                    • Settings:{" "}
                    {summary.hasTabConfig ? "✓ Included" : "✗ Not included"}
                  </li>
                  <li>• Custom Personalities: {summary.personalitiesCount}</li>
                  <li>• Custom Art Styles: {summary.artStylesCount}</li>
                </ul>
              </div>
            )}

            {/* Import Options */}
            {parsedBundle && (
              <div className="space-y-3">
                <p className="text-sm font-medium text-surface-700">
                  Import Options:
                </p>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={importTabConfig}
                    onChange={(e) => {
                      setImportTabConfig(e.target.checked);
                    }}
                    className="w-4 h-4 text-brand-600 rounded focus:ring-2 focus:ring-brand-500"
                  />
                  <span className="text-sm text-surface-700">
                    Import Settings (text/image generation, prompts)
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={importPersonalities}
                    onChange={(e) => {
                      setImportPersonalities(e.target.checked);
                    }}
                    className="w-4 h-4 text-brand-600 rounded focus:ring-2 focus:ring-brand-500"
                  />
                  <span className="text-sm text-surface-700">
                    Import Custom Personalities (
                    {summary?.personalitiesCount ?? 0})
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={importArtStyles}
                    onChange={(e) => {
                      setImportArtStyles(e.target.checked);
                    }}
                    className="w-4 h-4 text-brand-600 rounded focus:ring-2 focus:ring-brand-500"
                  />
                  <span className="text-sm text-surface-700">
                    Import Custom Art Styles ({summary?.artStylesCount ?? 0})
                  </span>
                </label>

                <div className="pt-2 border-t border-surface-200">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={mergeWithExisting}
                      onChange={(e) => {
                        setMergeWithExisting(e.target.checked);
                      }}
                      className="w-4 h-4 text-brand-600 rounded focus:ring-2 focus:ring-brand-500"
                    />
                    <span className="text-sm text-surface-700 font-medium">
                      Merge with existing data (uncheck to replace)
                    </span>
                  </label>
                  <p className="text-xs text-surface-500 ml-6 mt-1">
                    {mergeWithExisting
                      ? "New items will be added, existing items will be kept"
                      : "All existing custom data will be replaced"}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 bg-surface-50 border-t border-surface-200 px-6 py-4 flex justify-end gap-3">
            <button
              onClick={handleClose}
              className="px-4 py-2 bg-surface-300 text-surface-700 rounded-lg hover:bg-surface-400 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleImport}
              className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              disabled={!parsedBundle}
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                />
              </svg>
              Import Configuration
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
