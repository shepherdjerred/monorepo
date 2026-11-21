import type { ReactNode } from "react";
import "@shepherdjerred/streambot/web/client/styles/home.css";

/** The one h1 of a page. The shell moves focus here when the route changes. */
export function PageHeading(props: { title: string; aside?: ReactNode }) {
  return (
    <div className="section-head">
      <h1 className="page-heading" id="page-heading" tabIndex={-1}>
        {props.title}
      </h1>
      {props.aside}
    </div>
  );
}
