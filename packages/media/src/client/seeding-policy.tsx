import { useState } from "react";
import {
  ProviderSeedingPolicySchema,
  type ProviderStatus,
} from "#shared/admin.ts";
type Policy = ProviderStatus["seedingPolicy"];
type PrivatePolicy = Extract<Policy, { kind: "private" }>;

function value(form: FormData, name: string): string {
  const field = form.get(name);
  if (typeof field !== "string") throw new TypeError(`Missing ${name}`);
  return field.trim();
}
function optionalNumber(form: FormData, name: string): number | null {
  const field = value(form, name);
  return field === "" ? null : Number(field);
}
export function readSeedingPolicy(form: FormData) {
  const kind = value(form, "policyKind");
  if (kind === "unknown" || kind === "public")
    return ProviderSeedingPolicySchema.parse({ kind });
  const common = {
    kind,
    verified: form.get("policyVerified") === "on",
    evidence: value(form, "policyEvidence"),
    ratio: optionalNumber(form, "policyRatio"),
  };
  if (kind === "privatehd") return ProviderSeedingPolicySchema.parse(common);
  return ProviderSeedingPolicySchema.parse({
    ...common,
    minimumSeconds: optionalNumber(form, "policySeconds"),
    combination: value(form, "policyCombination"),
    sizeRule:
      form.get("policySizeRule") === "on"
        ? {
            secondsPerGiB: Number(value(form, "policySecondsPerGiB")),
            minimumSeconds: Number(value(form, "policySizeMinimum")),
            maximumSeconds: optionalNumber(form, "policySizeMaximum"),
          }
        : null,
  });
}

function SizePolicyFields({ rule }: { rule: PrivatePolicy["sizeRule"] }) {
  return (
    <>
      <label>
        Seconds per GiB
        <input
          name="policySecondsPerGiB"
          type="number"
          min="0.001"
          step="any"
          required
          defaultValue={rule?.secondsPerGiB ?? ""}
        />
      </label>
      <label>
        Size-rule minimum (seconds)
        <input
          name="policySizeMinimum"
          type="number"
          min="0"
          step="1"
          required
          defaultValue={rule?.minimumSeconds ?? 0}
        />
      </label>
      <label>
        Size-rule maximum (seconds; blank for no cap)
        <input
          name="policySizeMaximum"
          type="number"
          min="1"
          step="1"
          defaultValue={rule?.maximumSeconds ?? ""}
        />
      </label>
      <small>
        The larger of the fixed minimum and size-based duration applies.
      </small>
    </>
  );
}
function CustomPolicyFields({ policy }: { policy: PrivatePolicy | null }) {
  const [sizeRule, setSizeRule] = useState(policy?.sizeRule != null);
  return (
    <>
      <label>
        Minimum seeding time (seconds; blank for no fixed minimum)
        <input
          name="policySeconds"
          type="number"
          min="1"
          step="1"
          defaultValue={policy?.minimumSeconds ?? ""}
        />
      </label>
      <label>
        When both ratio and time apply
        <select
          name="policyCombination"
          defaultValue={policy?.combination ?? "all"}
        >
          <option value="all">Meet every requirement</option>
          <option value="any">Meet either requirement</option>
        </select>
      </label>
      <label>
        <input
          name="policySizeRule"
          type="checkbox"
          checked={sizeRule}
          onChange={(event) => {
            setSizeRule(event.target.checked);
          }}
        />{" "}
        Add a size-based duration
      </label>
      {sizeRule && <SizePolicyFields rule={policy?.sizeRule ?? null} />}
    </>
  );
}
function PrivatePolicyFields({
  kind,
  policy,
}: {
  kind: string;
  policy: Policy;
}) {
  const privatePolicy =
    policy.kind === "private" || policy.kind === "privatehd" ? policy : null;
  return (
    <>
      <label>
        Required ratio (leave blank for time only)
        <input
          name="policyRatio"
          type="number"
          min="0.001"
          step="any"
          defaultValue={privatePolicy?.ratio ?? ""}
        />
      </label>
      {kind === "privatehd" && (
        <p>
          The existing PrivateHD formula uses decimal GB: 72 hours up to 1 GB;
          72 + 2 × GB hours below 50 GB; otherwise 100 × ln(GB) − 219.2023
          hours. Time rounds up to whole minutes. A configured ratio is an
          alternative to this duration.
        </p>
      )}
      {kind === "private" && (
        <CustomPolicyFields
          policy={policy.kind === "private" ? policy : null}
        />
      )}
      <label>
        Rule source and verification evidence
        <textarea
          name="policyEvidence"
          rows={3}
          minLength={10}
          maxLength={2000}
          required
          defaultValue={privatePolicy?.evidence ?? ""}
          placeholder="Tracker rule URL or quoted rule, account tier, and date checked"
        />
      </label>
      <label>
        <input
          name="policyVerified"
          type="checkbox"
          defaultChecked={privatePolicy?.verified ?? false}
        />{" "}
        I verified these rules apply to this tracker and account.
      </label>
      <small>
        Unchecked policies keep seeding. Rule changes apply to new acquisitions;
        existing torrents retain their recorded obligations.
      </small>
    </>
  );
}
export function SeedingPolicyEditor({
  provider,
}: {
  provider: ProviderStatus;
}) {
  const [kind, setKind] = useState<string>(provider.seedingPolicy.kind);
  const isPrivate = ["privatehd", "avistaz", "animez"].includes(provider.id);
  return (
    <fieldset className="stack-form">
      <legend>Seeding policy</legend>
      <label>
        Tracker rules
        <select
          name="policyKind"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value);
          }}
        >
          <option value="unknown">Unknown — keep seeding</option>
          {!isPrivate && (
            <option value="public">Public — ratio 1 or 7 days</option>
          )}
          {provider.id === "privatehd" && (
            <option value="privatehd">PrivateHD size formula</option>
          )}
          {isPrivate && (
            <option value="private">Custom private tracker rules</option>
          )}
        </select>
      </label>
      {kind === "unknown" && (
        <p>
          Source files stay in qBittorrent until the tracker rules are recorded
          and verified.
        </p>
      )}
      {kind === "public" && (
        <p>
          Eligible after ratio 1 or 7 days of actual seeding, once all import
          dependencies are complete.
        </p>
      )}
      {(kind === "private" || kind === "privatehd") && (
        <PrivatePolicyFields kind={kind} policy={provider.seedingPolicy} />
      )}
    </fieldset>
  );
}
