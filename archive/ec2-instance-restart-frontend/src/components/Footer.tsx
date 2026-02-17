import React from "react";
import "./footer.css";

export default function Footer(): React.ReactElement {
  return (
    <footer className="footer">
      <div className="content has-text-centered">
        <p>
          EC2 Instance Control by <a href="https://shepherdjerred.com/">Jerred Shepherd</a>. Source available on{" "}
          <a href="https://github.com/shepherdjerred/ec2-instance-restart-frontend">GitHub</a>. Licensed under the{" "}
          <a href="https://www.gnu.org/licenses/gpl-3.0.en.html">GNU GPLv3</a>.
        </p>
      </div>
    </footer>
  );
}
