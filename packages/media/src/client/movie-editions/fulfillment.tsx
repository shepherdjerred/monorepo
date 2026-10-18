import type { MediaVisibility } from "#shared/visibility/detail.ts";
import { movieEditionDisplayLabel } from "#shared/movie-editions/registry.ts";
import { movieFulfillmentLabel } from "./presentation.ts";

export function MovieFulfillment({
  requests,
}: {
  requests: MediaVisibility["movieRequests"];
}) {
  if (requests.length === 0) return null;
  return (
    <section className="panel" aria-labelledby="movie-fulfillment-heading">
      <h2 id="movie-fulfillment-heading">Your movie edition requests</h2>
      <p>
        A playable copy may be available to your household while your own
        edition request is still pending.
      </p>
      {requests.map((request) => (
        <div className="list-row" key={request.requestId}>
          <div>
            <strong>
              {request.fulfillment.status === "pending_choice"
                ? "Edition not selected"
                : movieEditionDisplayLabel(request.edition)}
            </strong>
            <p role="status">{movieFulfillmentLabel(request.fulfillment)}</p>
          </div>
        </div>
      ))}
    </section>
  );
}
