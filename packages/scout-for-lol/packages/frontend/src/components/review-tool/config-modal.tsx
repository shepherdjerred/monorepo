/**
 * Modal for API configuration settings
 */
import { useState } from "react";
import { z } from "zod";
import type { GlobalConfig } from "@scout-for-lol/frontend/lib/review-tool/config/schema";
import { ApiSettingsPanel } from "./api-settings-panel.tsx";
import type { getResetPreview } from "@scout-for-lol/frontend/lib/review-tool/reset-defaults";
import { resetToDefaults } from "@scout-for-lol/frontend/lib/review-tool/reset-defaults";

const ErrorSchema = z.object({ message: z.string() });

type ConfigModalProps = {
  isOpen: boolean;
  onClose: () => void;
  globalConfig: GlobalConfig;
  onGlobalChange: (config: GlobalConfig) => void;
};

export function ConfigModal({
  isOpen,
  onClose,
  globalConfig,
  onGlobalChange,
}: ConfigModalProps) {
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [preview] = useState<Awaited<ReturnType<typeof getResetPreview>>>({
    configs: 0,
    historyEntries: 0,
    customPersonalities: 0,
    customArtStyles: 0,
  });

  if (!isOpen) {
    return null;
  }

  const handleResetClick = () => {
    setShowResetConfirm(true);
  };

  const handleResetConfirm = async () => {
    try {
      await resetToDefaults();
      setShowResetConfirm(false);
      alert(
        "Settings reset to defaults! API keys, cache, and cost data were preserved.\n\nPlease refresh the page to see changes.",
      );
    } catch (error) {
      const errorResult = ErrorSchema.safeParse(error);
      alert(
        `Failed to reset settings: ${errorResult.success ? errorResult.data.message : String(error)}`,
      );
    }
  };

  const handleResetCancel = () => {
    setShowResetConfirm(false);
  };

  const hasDataToReset = Object.values(preview).some((count) => count > 0);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        role="button"
        tabIndex={0}
        className="fixed inset-0 bg-black/30 backdrop-blur-sm transition-all"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onClose();
          }
        }}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          role="dialog"
          aria-modal="true"
          className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-surface-200 px-6 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-surface-900">
                API Configuration
              </h2>
              <p className="text-sm text-surface-500 mt-1">
                API keys and external service configuration
              </p>
            </div>
            <button
              onClick={onClose}
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
          <div className="p-6">
            <ApiSettingsPanel config={globalConfig} onChange={onGlobalChange} />
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 bg-surface-50 border-t border-surface-200 px-6 py-4 flex justify-between items-center">
            <button
              onClick={handleResetClick}
              className="px-4 py-2 bg-defeat-600 text-white rounded-lg hover:bg-defeat-700 transition-colors flex items-center gap-2"
              title="Reset all settings except API keys, cache, and cost data"
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
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Reset to Defaults
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
            >
              Done
            </button>
          </div>
        </div>
      </div>

      {/* Reset Confirmation Dialog */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-[60] overflow-y-auto">
          <div
            role="button"
            tabIndex={0}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={handleResetCancel}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleResetCancel();
              }
            }}
          />
          <div className="flex min-h-full items-center justify-center p-4">
            <div
              role="dialog"
              aria-modal="true"
              className="relative bg-white rounded-lg shadow-xl max-w-md w-full"
            >
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <svg
                      className="w-10 h-10 text-defeat-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-surface-900 mb-2">
                      Reset to Defaults?
                    </h3>
                    <p className="text-sm text-surface-600 mb-3">
                      This will clear the following data:
                    </p>
                    <ul className="text-sm text-surface-600 space-y-1 mb-3 list-disc list-inside">
                      {preview.configs > 0 && (
                        <li>
                          {preview.configs} saved configuration
                          {preview.configs !== 1 ? "s" : ""}
                        </li>
                      )}
                      {preview.historyEntries > 0 && (
                        <li>
                          {preview.historyEntries} history entr
                          {preview.historyEntries !== 1 ? "ies" : "y"}
                        </li>
                      )}
                      {preview.customPersonalities > 0 && (
                        <li>
                          {preview.customPersonalities} custom personalit
                          {preview.customPersonalities !== 1 ? "ies" : "y"}
                        </li>
                      )}
                      {preview.customArtStyles > 0 && (
                        <li>
                          {preview.customArtStyles} custom art style
                          {preview.customArtStyles !== 1 ? "s" : ""}
                        </li>
                      )}

                      {!hasDataToReset && (
                        <li className="text-surface-400 italic">
                          No custom data found
                        </li>
                      )}
                    </ul>
                    <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded p-2 mb-3">
                      ✓ API keys, cache, and cost data will be preserved
                    </p>
                    <p className="text-sm text-surface-600 font-medium">
                      This cannot be undone. Continue?
                    </p>
                  </div>
                </div>
              </div>
              <div className="bg-surface-50 px-6 py-4 flex justify-end gap-3 rounded-b-lg">
                <button
                  onClick={handleResetCancel}
                  className="px-4 py-2 bg-surface-300 text-surface-700 rounded-lg hover:bg-surface-400 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    void handleResetConfirm();
                  }}
                  className="px-4 py-2 bg-defeat-600 text-white rounded-lg hover:bg-defeat-700 transition-colors"
                >
                  Reset to Defaults
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
