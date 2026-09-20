import { useMutation, useQuery } from "@tanstack/react-query";
import { useParams } from "react-router";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@scout-for-lol/design-system/components/card";
import {
  ErrorState,
  LoadingState,
} from "@scout-for-lol/design-system/domain/states";
import { useTRPC } from "#src/lib/query/trpc.ts";

type PairingSummary = {
  readonly deviceName: string;
  readonly platform: string;
  readonly architecture: string;
  readonly appVersion: string;
  readonly state: "PENDING" | "APPROVED" | "EXCHANGED" | "EXPIRED";
};

export function ScoutClientPairingCard(props: {
  readonly pairing: PairingSummary;
  readonly approvalState: "idle" | "pending" | "error";
  readonly onApprove: () => void;
}) {
  const mayApprove = props.pairing.state === "PENDING";
  const approved =
    props.pairing.state === "APPROVED" || props.pairing.state === "EXCHANGED";

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <Card>
        <CardHeader>
          <h1 className="scout-card__title">Pair Scout Client</h1>
          <CardDescription>
            Approve only if you started this request on your own computer.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-scout-subtle">Device</dt>
            <dd>{props.pairing.deviceName}</dd>
            <dt className="text-scout-subtle">Platform</dt>
            <dd>
              {props.pairing.platform} · {props.pairing.architecture}
            </dd>
            <dt className="text-scout-subtle">Client</dt>
            <dd>{props.pairing.appVersion}</dd>
          </dl>
          {props.approvalState === "error" && (
            <p className="text-sm text-scout-danger">
              Pairing could not be approved. Start a new request from Scout
              Client.
            </p>
          )}
          {approved ? (
            <p className="text-sm">
              Approved. You can return to Scout Client; it will finish pairing
              automatically.
            </p>
          ) : mayApprove ? (
            <Button
              className="w-full"
              disabled={props.approvalState === "pending"}
              onClick={props.onApprove}
            >
              {props.approvalState === "pending"
                ? "Approving…"
                : "Approve this device"}
            </Button>
          ) : (
            <p className="text-sm text-scout-danger">
              This pairing request has expired. Start a new request from Scout
              Client.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function ScoutClientPairing() {
  const { pairingId } = useParams();
  const trpc = useTRPC();
  const pairing = useQuery(
    trpc.scoutClient.pairing.queryOptions(
      { pairingId: pairingId ?? "" },
      { enabled: pairingId !== undefined, retry: false },
    ),
  );
  const approve = useMutation(
    trpc.scoutClient.approve.mutationOptions({
      onSuccess: async () => await pairing.refetch(),
    }),
  );

  if (pairingId === undefined) {
    return (
      <ErrorState message="The Scout Client pairing link is incomplete." />
    );
  }
  if (pairing.isPending) return <LoadingState label="Checking pairing…" />;
  if (pairing.isError) {
    return (
      <ErrorState message="This pairing link is invalid, expired, or unavailable." />
    );
  }

  return (
    <ScoutClientPairingCard
      pairing={pairing.data}
      approvalState={
        approve.isError ? "error" : approve.isPending ? "pending" : "idle"
      }
      onApprove={() => {
        approve.mutate({ pairingId });
      }}
    />
  );
}
