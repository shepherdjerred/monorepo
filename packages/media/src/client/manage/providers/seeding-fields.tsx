import { useState } from "react";
import type { ProviderStatus } from "#shared/admin.ts";
import {
  CheckboxField,
  ChoiceField,
  FieldGroup,
  SelectField,
  TextAreaField,
  TextField,
} from "#client/ui/field.tsx";
import { classNames } from "#client/ui/class-names.ts";
import { DurationField } from "#client/ui/duration-field.tsx";
import { DURATION_RULES } from "./provider-input.ts";
import styles from "./providers.module.css";

const cx = classNames(styles);

type Policy = ProviderStatus["seedingPolicy"];
type PrivatePolicy = Extract<Policy, { kind: "private" }>;

/** The trackers whose rules are their own, not the public default. */
const PRIVATE_TRACKERS: ReadonlySet<string> = new Set([
  "privatehd",
  "avistaz",
  "animez",
]);

function SizeRuleFields({ rule }: { rule: PrivatePolicy["sizeRule"] }) {
  return (
    <>
      <DurationField
        label="Time for each GiB"
        name="policySecondsPerGiB"
        rules={DURATION_RULES.policySecondsPerGiB}
        requiredMessage="Enter the seeding time each GiB adds."
        defaultSeconds={rule?.secondsPerGiB ?? null}
      />
      <DurationField
        label="Shortest size-based time"
        name="policySizeMinimum"
        rules={DURATION_RULES.policySizeMinimum}
        requiredMessage="Enter the shortest time, or 0 for none."
        defaultSeconds={rule?.minimumSeconds ?? 0}
      />
      <DurationField
        label="Longest size-based time"
        description="Leave empty for no limit. The longer of the fixed minimum and the size-based time applies."
        optional
        name="policySizeMaximum"
        rules={DURATION_RULES.policySizeMaximum}
        defaultSeconds={rule?.maximumSeconds ?? null}
      />
    </>
  );
}

function CustomRuleFields({ policy }: { policy: PrivatePolicy | null }) {
  const [sizeRule, setSizeRule] = useState(policy?.sizeRule != null);
  return (
    <>
      <DurationField
        label="Minimum seeding time"
        description="Leave empty if the tracker sets no fixed time."
        optional
        name="policySeconds"
        rules={DURATION_RULES.policySeconds}
        defaultSeconds={policy?.minimumSeconds ?? null}
      />
      <ChoiceField
        legend="When the tracker asks for both a ratio and a time"
        name="policyCombination"
        defaultValue={policy?.combination ?? "all"}
        options={[
          { value: "all", label: "Meet every requirement" },
          { value: "any", label: "Meet either requirement" },
        ]}
      />
      <CheckboxField
        label="Add a time that grows with the download’s size"
        name="policySizeRule"
        checked={sizeRule}
        onChange={(event) => {
          setSizeRule(event.target.checked);
        }}
      />
      {sizeRule && <SizeRuleFields rule={policy?.sizeRule ?? null} />}
    </>
  );
}

function PrivateRuleFields({ kind, policy }: { kind: string; policy: Policy }) {
  const recorded =
    policy.kind === "private" || policy.kind === "privatehd" ? policy : null;
  return (
    <>
      <TextField
        label="Required ratio"
        description="Leave empty if the tracker only asks for time."
        optional
        name="policyRatio"
        type="number"
        min="0.001"
        step="any"
        defaultValue={recorded?.ratio ?? ""}
      />
      {kind === "privatehd" && (
        <p className={cx("note")}>
          PrivateHD’s own formula works in decimal GB: 72 hours up to 1 GB, 72 +
          2 × GB hours below 50 GB, and 100 × ln(GB) − 219.2023 hours above
          that, rounded up to whole minutes. A ratio entered here is an
          alternative to that time.
        </p>
      )}
      {kind === "private" && (
        <CustomRuleFields policy={policy.kind === "private" ? policy : null} />
      )}
      <TextAreaField
        label="Where these rules come from"
        description="The tracker’s rule page or the rule quoted, your account tier, and the date you checked."
        name="policyEvidence"
        rows={3}
        minLength={10}
        maxLength={2000}
        required
        requiredMessage="Say where these rules come from."
        defaultValue={recorded?.evidence ?? ""}
      />
      <CheckboxField
        label="I checked that these rules apply to this tracker and my account"
        description="Until this is ticked, downloads from this tracker keep seeding. A change applies to new downloads; ones already seeding keep the rules they started with."
        name="policyVerified"
        defaultChecked={recorded?.verified ?? false}
      />
    </>
  );
}

/** How long a tracker's downloads must keep seeding before they may be removed. */
export function SeedingFields({ provider }: { provider: ProviderStatus }) {
  const [kind, setKind] = useState<string>(provider.seedingPolicy.kind);
  const ownRules = PRIVATE_TRACKERS.has(provider.id);
  return (
    <FieldGroup legend="Seeding rules">
      <SelectField
        label="This tracker’s rules"
        name="policyKind"
        value={kind}
        onChange={(event) => {
          setKind(event.target.value);
        }}
        width="medium"
      >
        <option value="unknown">Not recorded yet</option>
        {!ownRules && <option value="public">Public tracker</option>}
        {provider.id === "privatehd" && (
          <option value="privatehd">PrivateHD’s size formula</option>
        )}
        {ownRules && <option value="private">Rules I enter here</option>}
      </SelectField>
      {kind === "unknown" && (
        <p className={cx("note")}>
          Downloads stay in qBittorrent and keep seeding until this tracker’s
          rules are recorded and checked.
        </p>
      )}
      {kind === "public" && (
        <p className={cx("note")}>
          A download may stop seeding at ratio 1 or after 7 days of seeding,
          once everything that needs its files has been imported.
        </p>
      )}
      {(kind === "private" || kind === "privatehd") && (
        <PrivateRuleFields kind={kind} policy={provider.seedingPolicy} />
      )}
    </FieldGroup>
  );
}
