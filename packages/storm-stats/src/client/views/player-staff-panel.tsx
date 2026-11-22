import { ExternalLink, ShieldAlert } from "lucide-react";
import {
  StaffPlayerOverlayResponseSchema,
  type StaffPlayerOverlayResponse,
} from "@shepherdjerred/storm-stats/shared/staff-contract.ts";
import {
  buildStaffPlayerApiUrl,
  buildStaffPlayerRawUrl,
  useApiQuery,
} from "@shepherdjerred/storm-stats/client/api.ts";
import {
  formatBounceCategory,
  formatDateTime,
  formatInt,
} from "@shepherdjerred/storm-stats/client/format.ts";
import {
  PlatformBadge,
  renderQueryGate,
} from "@shepherdjerred/storm-stats/client/components/brand.tsx";
import { ResponsiveTable } from "@shepherdjerred/storm-stats/client/components/sortable-table.tsx";

export function PlayerStaffInspectPanel({
  playerId,
}: {
  readonly playerId: string;
}) {
  const query = useApiQuery(
    buildStaffPlayerApiUrl(playerId),
    StaffPlayerOverlayResponseSchema,
  );

  return renderQueryGate(query, "Loading staff network overlay…", (overlay) => (
    <StaffOverlayDetails overlay={overlay} />
  ));
}

function StaffOverlayDetails({
  overlay,
}: {
  readonly overlay: StaffPlayerOverlayResponse;
}) {
  return (
    <div className="stack-lg">
      <div className="panel">
        <div className="panel-header">
          <div>
            <h2>
              <ShieldAlert
                size={17}
                aria-hidden="true"
                style={{ verticalAlign: "-3px" }}
              />{" "}
              Tailnet Staff Inspection
            </h2>
            <p className="panel-subtitle" style={{ margin: "0.2rem 0 0" }}>
              Sensitive connection metadata restricted to Tailscale staff
              viewers.
            </p>
          </div>
          <a
            href={buildStaffPlayerRawUrl(overlay.uuid)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn"
          >
            <span>Open Raw Player JSON</span>
            <ExternalLink size={15} aria-hidden="true" />
          </a>
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-header">
            <h3>Join Addresses</h3>
          </div>
          {overlay.joinAddresses.length === 0 ? (
            <p className="panel-subtitle">No join addresses recorded.</p>
          ) : (
            <ResponsiveTable caption="Player join address history" compact>
              <thead>
                <tr>
                  <th scope="col">Join Address</th>
                  <th scope="col" className="num-col">
                    Sessions
                  </th>
                  <th scope="col">Last Used</th>
                </tr>
              </thead>
              <tbody>
                {overlay.joinAddresses.map((entry) => (
                  <tr key={entry.joinAddress}>
                    <th scope="row" className="mono">
                      {entry.joinAddress}
                    </th>
                    <td data-label="Sessions" className="num-col">
                      {formatInt(entry.sessions)}
                    </td>
                    <td data-label="Last Used">
                      {formatDateTime(entry.lastUsedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveTable>
          )}
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Geolocation History</h3>
          </div>
          {overlay.geolocations.length === 0 ? (
            <p className="panel-subtitle">No geolocation records.</p>
          ) : (
            <ResponsiveTable caption="Player geolocation history" compact>
              <thead>
                <tr>
                  <th scope="col">Country</th>
                  <th scope="col" className="num-col">
                    Sessions
                  </th>
                  <th scope="col">Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {overlay.geolocations.map((geo) => (
                  <tr key={geo.countryCode}>
                    <th scope="row">
                      {geo.countryName}{" "}
                      <span className="mono panel-subtitle">
                        ({geo.countryCode})
                      </span>
                    </th>
                    <td data-label="Sessions" className="num-col">
                      {formatInt(geo.sessions)}
                    </td>
                    <td data-label="Last Seen">
                      {formatDateTime(geo.lastSeenAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveTable>
          )}
        </div>
      </div>

      <div className="grid-2">
        <div className="panel">
          <div className="panel-header">
            <h3>Client Brands &amp; Versions</h3>
          </div>
          {overlay.clientBrands.length === 0 ? (
            <p className="panel-subtitle">No client brand history.</p>
          ) : (
            <ResponsiveTable caption="Player client brand history" compact>
              <thead>
                <tr>
                  <th scope="col">Client Brand</th>
                  <th scope="col">Platform &amp; Version</th>
                  <th scope="col">Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {overlay.clientBrands.map((brand) => (
                  <tr
                    key={`${brand.brand}-${brand.platform}-${brand.clientVersion}`}
                  >
                    <th scope="row" className="mono">
                      {brand.brand}
                    </th>
                    <td data-label="Platform & Version">
                      <PlatformBadge
                        platform={brand.platform}
                        version={brand.clientVersion}
                      />
                    </td>
                    <td data-label="Last Seen">
                      {formatDateTime(brand.lastSeenAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveTable>
          )}
        </div>

        <div className="panel">
          <div className="panel-header">
            <h3>Connection Bounces</h3>
          </div>
          {overlay.bounces.length === 0 ? (
            <p className="panel-subtitle">No refused logins recorded.</p>
          ) : (
            <ResponsiveTable caption="Player connection bounce history" compact>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Category</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Address</th>
                </tr>
              </thead>
              <tbody>
                {overlay.bounces.map((bounce) => (
                  <tr key={bounce.eventId}>
                    <th scope="row">{formatDateTime(bounce.occurredAt)}</th>
                    <td data-label="Category">
                      <span className="pill pill-danger">
                        {formatBounceCategory(bounce.category)}
                      </span>
                    </td>
                    <td data-label="Reason">
                      {bounce.reason.length === 0 ? "—" : bounce.reason}
                    </td>
                    <td data-label="Address" className="mono">
                      {bounce.joinAddress ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveTable>
          )}
        </div>
      </div>
    </div>
  );
}
