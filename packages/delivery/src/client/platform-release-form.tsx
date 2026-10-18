import { useState, type SubmitEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { DeliveryClient } from "#shared/client.ts";
import type {
  Environment,
  Overview,
  Principal,
  CreatePlatformDeployment,
} from "#shared/contract.ts";
import { ErrorNotice } from "./components.tsx";
import { TofuStackSchema } from "@shepherdjerred/ops-model/platform-policy.ts";

export function PlatformReleaseForm({
  environment,
  overview,
  principal,
  client,
  onDeployment,
  onClose,
}: {
  environment: Environment;
  overview: Overview;
  principal: Principal;
  client: DeliveryClient;
  onDeployment: (id: string) => void;
  onClose: () => void;
}) {
  const root = environment.id === "gitops/root";
  const stack = root
    ? null
    : TofuStackSchema.parse(environment.id.slice("gitops/tofu:".length));
  const [action, setAction] = useState<"tofu-plan" | "tofu-apply">("tofu-plan");
  const [selected, setSelected] = useState("");
  const queryClient = useQueryClient();
  const request = useMutation({
    mutationFn: (input: CreatePlatformDeployment) =>
      client.createPlatformDeployment(input),
    onSuccess: async (deployment) => {
      await queryClient.invalidateQueries();
      onDeployment(deployment.id);
    },
  });
  const sources = overview.builds.filter(
    (build) =>
      build.serviceId === "gitops" &&
      build.status === "verified" &&
      (root
        ? build.platformChanges?.root === true
        : stack !== null &&
          build.platformChanges?.tofuStacks.includes(stack) === true),
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
      root
        ? { ...common, kind: "root-release", sourceBuildId: selected }
        : action === "tofu-plan"
          ? { ...common, kind: action, sourceBuildId: selected }
          : { ...common, kind: action, planDeploymentId: selected },
    );
  }
  return (
    <section className="panel" aria-label="Platform release request">
      <div className="section-heading">
        <h2>{root ? "Root release" : <>OpenTofu · {stack}</>}</h2>
        <button
          className="icon-button"
          aria-label="Close platform request"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p>
        Request immutable source and original artifacts. Saved-plan application
        uses the existing native state lock, exact state identity and plan
        digest; it never replans.
      </p>
      {request.error !== null && <ErrorNotice error={request.error} />}
      <form onSubmit={submit}>
        {!root && (
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
        )}
        <label>
          {!root && action === "tofu-apply"
            ? "Successful plan deployment"
            : "Qualified source build"}
          <select
            value={selected}
            onChange={(event) => {
              setSelected(event.target.value);
            }}
          >
            <option value="">Choose exact input</option>
            {!root && action === "tofu-apply"
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
