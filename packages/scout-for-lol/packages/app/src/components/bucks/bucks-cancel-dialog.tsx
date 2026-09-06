import { formatInteger } from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@scout-for-lol/design-system/components/dialog";
import {
  FormPendingStatus,
  ServerFormError,
  handleFormSubmit,
} from "#src/components/semantic-form.tsx";
import { docsHref } from "#src/lib/analytics/surface-origins.ts";

/**
 * Cancel confirmation as a small semantic form. It shows the server-computed
 * return and fee as numbers with a docs link — never the fee rule itself,
 * which is stated only in `/bb rules` and the docs.
 */
export function BucksCancelDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  position: { offeredStake: number; cancellationFee: number } | null;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
}) {
  const position = props.position;
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            handleFormSubmit(event, () => {
              props.onConfirm();
              return Promise.resolve();
            });
          }}
        >
          <DialogHeader>
            <DialogTitle>Cancel this bet?</DialogTitle>
            <DialogDescription>
              {position === null
                ? "No open position."
                : `You'll get ${formatInteger(
                    position.offeredStake - position.cancellationFee,
                  )} BB back from your ${formatInteger(
                    position.offeredStake,
                  )} BB offer; ${formatInteger(
                    position.cancellationFee,
                  )} BB goes to the house.`}{" "}
              <a
                className="underline"
                href={docsHref("/docs/reference/bryan-bucks-rules/")}
              >
                See the rules
              </a>
              .
            </DialogDescription>
          </DialogHeader>
          <fieldset disabled={props.pending}>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  props.onOpenChange(false);
                }}
              >
                Keep bet
              </Button>
              <Button type="submit" variant="destructive">
                {props.pending ? "Cancelling…" : "Cancel bet"}
              </Button>
            </DialogFooter>
          </fieldset>
          <FormPendingStatus pending={props.pending}>
            Cancelling bet…
          </FormPendingStatus>
          <ServerFormError error={props.error} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
