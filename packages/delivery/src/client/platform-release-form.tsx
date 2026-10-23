import { useState, type SubmitEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { delivery } from "./api.ts";
import type {
  Environment,
  Overview,
  Principal,
  CreatePlatformDeployment,
} from "#shared/contract.ts";
import { ErrorNotice } from "#client/components/notices.tsx";
import { TofuStackSchema } from "@shepherdjerred/ops-model/platform-policy.ts";

type Props = {
  environment: Environment;
  overview: Overview;
  principal: Principal;
  onDeployment: (id: string) => Promise<void>;
};

export function PlatformReleaseForm(props: Props) {
  if (props.environment.id === "gitops/root")
    return (
      <section className="panel" aria-label="Platform release request">
        <h2>Root release</h2>
        <p className="notice">
          The root release is retired. Each service&apos;s environment owns its
          Applications, and ordering is a prerequisite edge.
        </p>
      </section>
    );
  return <TofuReleaseForm {...props} />;
}

function TofuReleaseForm({
  environment,
  overview,
  principal,
  onDeployment,
}: Props) {
  const stack = TofuStackSchema.parse(
    environment.id.slice("gitops/tofu:".length),
  );
  const [action, setAction] = useState<"tofu-plan" | "tofu-apply">("tofu-plan");
  const [selected, setSelected] = useState("");
  const queryClient = useQueryClient();
  const request = useMutation({
    mutationFn: (input: CreatePlatformDeployment) =>
      delivery.createPlatformDeployment(input),
    onSuccess: async (deployment) => {
      await queryClient.invalidateQueries();
      await onDeployment(deployment.id);
    },
  });
  const sources = overview.builds.filter(
    (build) =>
      build.serviceId === "gitops" &&
      build.status === "verified" &&
      build.platformChanges?.tofuStacks.includes(stack) === true,
  );
  const plans = overview.deployments.filter(
    (deployment) =>
      deployment.environmentId === environment.id &&
      deployment.kind === "tofu-plan" &&
      deployment.status === "succeeded",
  );
  function submit(event: SubmitEvent) {
    event.preventDefault();
    const common = {
      requestId: crypto.randomUUID(),
      environmentId: environment.id,
      expectedGeneration: environment.generation,
    };
    request.mutate(
      action === "tofu-plan"
        ? { ...common, kind: action, sourceBuildId: selected }
        : { ...common, kind: action, planDeploymentId: selected },
    );
  }
  return (
    <section className="panel" aria-label="Platform release request">
      <h2>OpenTofu · {stack}</h2>
      <p>
        Request immutable source and original artifacts. Saved-plan application
        uses the existing native state lock, exact state identity and plan
        digest; it never replans.
      </p>
      {request.error !== null && <ErrorNotice error={request.error} />}
      <form onSubmit={submit}>
        <label>
          Operation
          <select
            value={action}
            onChange={(event) => {
              setAction(
                event.target.value === "tofu-apply"
                  ? "tofu-apply"
                  : "tofu-plan",
              );
              setSelected("");
            }}
          >
            <option value="tofu-plan">Prepare read-only plan</option>
            <option value="tofu-apply">Apply exact successful plan</option>
          </select>
        </label>
        <label>
          {action === "tofu-apply"
            ? "Successful plan deployment"
            : "Qualified source build"}
          <select
            required
            value={selected}
            onChange={(event) => {
              setSelected(event.target.value);
            }}
          >
            <option value="">Choose exact input</option>
            {action === "tofu-apply"
              ? plans.map((plan) => (
                  <option key={plan.id} value={plan.id}>
                    {plan.id}
                  </option>
                ))
              : sources.map((build) => (
                  <option key={build.id} value={build.id}>
                    {build.sourceRevision.slice(0, 12)} · {build.id}
                  </option>
                ))}
          </select>
        </label>
        {!principal.scopes.includes("deploy") && (
          <p className="notice">
            Deployment access is required to request platform operations.
          </p>
        )}
        <button
          className="primary-button"
          disabled={
            request.isPending ||
            selected === "" ||
            !principal.scopes.includes("deploy")
          }
        >
          Request exact operation
        </button>
      </form>
    </section>
  );
}
