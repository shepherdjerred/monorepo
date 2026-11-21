import { PageHeading } from "./page-heading.tsx";

/** A page whose feature is off in this server: its heading and one plain sentence saying so. */
export function DisabledPage(props: { title: string; reason: string }) {
  return (
    <div className="page">
      <PageHeading title={props.title} />
      <p className="empty-note">{props.reason}</p>
    </div>
  );
}
