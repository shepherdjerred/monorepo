/**
 * Modal for API configuration settings
 */
import { useState } from "react";
import { z } from "zod";
import type { GlobalConfig } from "#src/lib/review-tool/config/schema.ts";
import { ApiSettingsPanel } from "./api-settings-panel.tsx";
import { resetToDefaults } from "#src/lib/review-tool/reset-defaults.ts";
import { ReviewToolModal } from "./review-tool-modal.tsx";

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
  const [preview] = useState({
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
    <>
      <ReviewToolModal
        title="API Configuration"
        subtitle="API keys and external service configuration"
        onClose={onClose}
        maxWidthClassName="max-w-2xl"
        footer={
          <div className="sticky bottom-0 bg-scout-raised border-t border-scout-border px-6 py-4 flex justify-between items-center">
            <button
              onClick={handleResetClick}
              className="px-4 py-2 bg-scout-danger text-scout-danger-ink rounded-lg hover:bg-scout-danger transition-colors flex items-center gap-2"
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
              className="px-4 py-2 bg-scout-brand text-scout-brand-ink rounded-lg hover:bg-scout-brand transition-colors"
            >
              Done
            </button>
          </div>
        }
      >
        {/* Content */}
        <div className="p-6">
          <ApiSettingsPanel config={globalConfig} onChange={onGlobalChange} />
        </div>
      </ReviewToolModal>

      {/* Reset Confirmation Dialog */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-[60] overflow-y-auto">
          <div
            role="button"
            tabIndex={0}
            className="fixed inset-0 bg-scout-overlay backdrop-blur-sm"
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
              className="relative bg-scout-surface rounded-lg shadow-xl max-w-md w-full"
            >
              <div className="p-6">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    <svg
                      className="w-10 h-10 text-scout-danger"
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
                    <h3 className="text-lg font-semibold text-scout-ink mb-2">
                      Reset to Defaults?
                    </h3>
                    <p className="text-sm text-scout-subtle mb-3">
                      This will clear the following data:
                    </p>
                    <ul className="text-sm text-scout-subtle space-y-1 mb-3 list-disc list-inside">
                      {preview.configs > 0 && (
                        <li>
                          {preview.configs} saved configuration
                          {preview.configs === 1 ? "" : "s"}
                        </li>
                      )}
                      {preview.historyEntries > 0 && (
                        <li>
                          {preview.historyEntries} history entr
                          {preview.historyEntries === 1 ? "y" : "ies"}
                        </li>
                      )}
                      {preview.customPersonalities > 0 && (
                        <li>
                          {preview.customPersonalities} custom personalit
                          {preview.customPersonalities === 1 ? "y" : "ies"}
                        </li>
                      )}
                      {preview.customArtStyles > 0 && (
                        <li>
                          {preview.customArtStyles} custom art style
                          {preview.customArtStyles === 1 ? "" : "s"}
                        </li>
                      )}

                      {!hasDataToReset && (
                        <li className="text-scout-subtle italic">
                          No custom data found
                        </li>
                      )}
                    </ul>
                    <p className="text-sm text-scout-success bg-scout-success border border-scout-success rounded p-2 mb-3">
                      ✓ API keys, cache, and cost data will be preserved
                    </p>
                    <p className="text-sm text-scout-subtle font-medium">
                      This cannot be undone. Continue?
                    </p>
                  </div>
                </div>
              </div>
              <div className="bg-scout-raised px-6 py-4 flex justify-end gap-3 rounded-b-lg">
                <button
                  onClick={handleResetCancel}
                  className="px-4 py-2 bg-scout-canvas text-scout-ink rounded-lg hover:bg-scout-canvas transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    void handleResetConfirm();
                  }}
                  className="px-4 py-2 bg-scout-danger text-scout-danger-ink rounded-lg hover:bg-scout-danger transition-colors"
                >
                  Reset to Defaults
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
