/**
 * Volume Slider Component
 *
 * A slider for adjusting volume levels from 0% to 200%.
 */

type VolumeSliderProps = {
  /** Current volume value (0.0 - 2.0) */
  value: number;
  /** Called when value changes */
  onChange: (value: number) => void;
  /** Label for the slider */
  label?: string;
  /** Additional CSS classes */
  className?: string;
  /** Whether the slider is disabled */
  disabled?: boolean;
};

export function VolumeSlider({ value, onChange, label, className = "", disabled = false }: VolumeSliderProps) {
  const percentage = Math.round(value * 100);

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {label && <label className="text-sm font-medium text-gray-700">{label}</label>}
      <div className="flex items-center gap-3">
        <input
          type="range"
          min="0"
          max="200"
          value={percentage}
          onChange={(e) => {
            onChange(Number(e.currentTarget.value) / 100);
          }}
          disabled={disabled}
          className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <span className="w-12 text-sm text-gray-600 tabular-nums text-right">{percentage}%</span>
      </div>
    </div>
  );
}
