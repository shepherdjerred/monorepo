import React from "react";

const linkClass = "underline underline-offset-2 hover:text-foreground";

export function Footer(): React.ReactElement {
  return (
    <footer className="mt-12 border-t bg-muted/40 py-8">
      <div className="mx-auto max-w-6xl px-4 text-center text-sm text-muted-foreground">
        <p>
          Better Skill Capped by{" "}
          <a className={linkClass} href="https://shepherdjerred.com/">
            Jerred Shepherd
          </a>
          . Have a problem? Open an issue on{" "}
          <a
            className={linkClass}
            href="https://github.com/shepherdjerred/monorepo/issues/new"
          >
            GitHub
          </a>
          .
        </p>
        <p className="mt-2">
          All content is property of{" "}
          <a className={linkClass} href="https://www.skill-capped.com/">
            Skill Capped
          </a>
          . This project is in no way endorsed or affiliated with Skill Capped.
        </p>
        <p className="mt-2">
          Source available on{" "}
          <a
            className={linkClass}
            href="https://github.com/shepherdjerred/monorepo/tree/main/packages/better-skill-capped"
          >
            GitHub
          </a>
          . Licensed under the{" "}
          <a
            className={linkClass}
            href="https://www.gnu.org/licenses/gpl-3.0.en.html"
          >
            GNU GPLv3
          </a>
          .
        </p>
      </div>
    </footer>
  );
}
