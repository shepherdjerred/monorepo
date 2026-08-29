import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { formatInteger } from "@scout-for-lol/data";
import { docsHref } from "#src/lib/surface-origins.ts";

function Stat(props: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-scout-subtle text-sm">{props.label}</dt>
      <dd className="text-2xl font-semibold">{props.value}</dd>
    </div>
  );
}

/**
 * The caller's own wallet. Numbers only — the fee/window rules live in the
 * docs, which this card links to instead of restating.
 */
export function BucksWalletCard(props: {
  wallet: {
    balance: number;
    totalAtRisk: number;
    pendingPositionCount: number;
  } | null;
  /** A tracked player who hasn't bet yet vs. someone who never can. */
  eligible: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Bryan Bucks</CardTitle>
        <CardDescription>
          <a
            className="underline"
            href={docsHref("/docs/reference/bryan-bucks-rules/")}
          >
            How Bryan Bucks works
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {props.wallet === null ? (
          <p className="text-scout-subtle">
            {props.eligible
              ? "No wallet yet — bet on a live game below and you'll get a starting balance."
              : "Only players tracked in this server can hold a Bryan Bucks wallet."}
          </p>
        ) : (
          <dl className="flex flex-wrap gap-8">
            <Stat
              label="Balance"
              value={`${formatInteger(props.wallet.balance)} BB`}
            />
            <Stat
              label="At risk"
              value={`${formatInteger(props.wallet.totalAtRisk)} BB`}
            />
            <Stat
              label="Pending positions"
              value={formatInteger(props.wallet.pendingPositionCount)}
            />
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
