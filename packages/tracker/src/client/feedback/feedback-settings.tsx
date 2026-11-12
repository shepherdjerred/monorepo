import { Switch } from "@base-ui/react/switch";
import { Volume2 } from "lucide-react";
import { canVibrate } from "./haptics.ts";
import {
  feedbackPreferences,
  playSample,
  useFeedbackPreference,
} from "./index.ts";
import { useReducedMotion } from "./motion.ts";
import type { Channel } from "./policy.ts";

function FeedbackSwitch({
  channel,
  title,
  detail,
}: {
  channel: Channel;
  title: string;
  detail: string;
}) {
  const on = useFeedbackPreference(channel);
  const id = `feedback-${channel}`;
  return (
    <div className="switch-field">
      <Switch.Root
        id={id}
        className="switch"
        checked={on}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-detail`}
        onCheckedChange={(checked) => {
          feedbackPreferences.write(channel, checked);
        }}
      >
        <Switch.Thumb className="switch-thumb" />
      </Switch.Root>
      <span className="switch-copy">
        <label id={`${id}-title`} htmlFor={id}>
          {title}
        </label>
        <span id={`${id}-detail`} className="muted">
          {detail}
        </span>
      </span>
    </div>
  );
}

/** Settings → Feedback: the per-device Sounds and Haptics switches. */
export function FeedbackSettings() {
  const sound = useFeedbackPreference("sound");
  const reduced = useReducedMotion();
  return (
    <section aria-labelledby="feedback-heading">
      <h2 id="feedback-heading">Feedback</h2>
      <p className="muted">
        Short sounds and vibrations confirm what you just did. They are set for
        this device.
      </p>
      <div className="feedback-options">
        <div className="feedback-row">
          <FeedbackSwitch
            channel="sound"
            title="Sounds"
            detail="Creating, completing, dropping a card, commenting, undoing and errors."
          />
          <button
            type="button"
            className="toolbar-button"
            disabled={!sound || reduced}
            onClick={() => {
              playSample();
            }}
          >
            <Volume2 size={14} aria-hidden="true" />
            Play sample
          </button>
        </div>
        <div className="feedback-row">
          <FeedbackSwitch
            channel="haptics"
            title="Haptics"
            detail={
              canVibrate
                ? "Taps for selections, a firmer one for picking up and dropping cards, a pattern for errors."
                : "This browser cannot vibrate. Android browsers can; iOS Safari offers no vibration to websites."
            }
          />
        </div>
      </div>
      <p className="muted feedback-note">
        {reduced
          ? "Your system asks for reduced motion, so sounds and haptics are silent."
          : "Both stay silent whenever your system asks for reduced motion."}
      </p>
    </section>
  );
}
