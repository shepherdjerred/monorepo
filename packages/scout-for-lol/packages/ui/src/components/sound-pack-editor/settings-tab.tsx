import { useSoundPackEditor } from "@scout-for-lol/ui/hooks/use-sound-pack-editor.tsx";
import { VolumeSlider } from "./volume-slider.tsx";

export function SettingsTab() {
  const editor = useSoundPackEditor();

  return (
    <div className="max-w-md space-y-6">
      {/* Master Volume */}
      <div className="bg-white border rounded-lg p-4">
        <h3 className="font-medium mb-3">Volume</h3>
        <VolumeSlider
          value={editor.soundPack.settings.masterVolume}
          onChange={(volume) => {
            editor.setMasterVolume(volume);
          }}
          label="Master Volume"
        />
        <p className="text-xs text-gray-500 mt-2">
          Multiplied with each sound&apos;s individual volume. Set to 200% to
          make all sounds louder.
        </p>
      </div>

      {/* Normalization */}
      <div className="bg-white border rounded-lg p-4">
        <h3 className="font-medium mb-3">Audio Normalization</h3>
        <label htmlFor="normalization" className="flex items-center gap-2">
          <input
            id="normalization"
            type="checkbox"
            checked={editor.soundPack.settings.normalization}
            onChange={(e) => {
              editor.setNormalization(e.currentTarget.checked);
            }}
            className="rounded"
          />
          <span className="text-sm">Normalize audio levels</span>
        </label>
        <p className="text-xs text-gray-500 mt-2">
          When enabled, all sounds are analyzed and adjusted to have consistent
          volume levels before the per-sound volume is applied.
        </p>
      </div>

      {/* Pack Info */}
      <div className="bg-white border rounded-lg p-4">
        <h3 className="font-medium mb-3">Pack Information</h3>
        <div className="space-y-3">
          <div>
            <label
              htmlFor="version"
              className="block text-sm text-gray-600 mb-1"
            >
              Version
            </label>
            <input
              id="version"
              type="text"
              value={editor.soundPack.version}
              onChange={(e) => {
                editor.updatePack({ version: e.currentTarget.value });
              }}
              className="w-full px-3 py-2 border rounded text-sm"
              placeholder="1.0.0"
            />
          </div>
          <div>
            <label
              htmlFor="author"
              className="block text-sm text-gray-600 mb-1"
            >
              Author
            </label>
            <input
              id="author"
              type="text"
              value={editor.soundPack.author ?? ""}
              onChange={(e) => {
                editor.updatePack({
                  author: e.currentTarget.value || undefined,
                });
              }}
              className="w-full px-3 py-2 border rounded text-sm"
              placeholder="Your name"
            />
          </div>
          <div>
            <label
              htmlFor="description"
              className="block text-sm text-gray-600 mb-1"
            >
              Description
            </label>
            <textarea
              id="description"
              value={editor.soundPack.description ?? ""}
              onChange={(e) => {
                editor.updatePack({
                  description: e.currentTarget.value || undefined,
                });
              }}
              className="w-full px-3 py-2 border rounded text-sm"
              rows={3}
              placeholder="Describe your sound pack..."
            />
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="bg-white border border-red-200 rounded-lg p-4">
        <h3 className="font-medium text-red-600 mb-3">Danger Zone</h3>
        <button
          type="button"
          onClick={() => {
            editor.resetPack();
          }}
          className="px-3 py-1.5 text-sm border border-red-300 text-red-600 rounded hover:bg-red-50"
        >
          Reset to Empty Pack
        </button>
        <p className="text-xs text-gray-500 mt-2">
          This will clear all defaults and rules. This action cannot be undone.
        </p>
      </div>
    </div>
  );
}
