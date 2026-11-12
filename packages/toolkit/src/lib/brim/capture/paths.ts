import os from "node:os";
import path from "node:path";

/**
 * Local files owned by `brim capture`, all under `~/.toolkit/brim-capture/`
 * (0700). The CA key and the spool are 0600. Ingested captures live in the
 * history directory (`captures.sqlite`), not here.
 */
export type BrimCapturePaths = {
  readonly home: string;
  readonly root: string;
  /** The capture CA certificate the CLIs trust. */
  readonly caCert: string;
  readonly caKey: string;
  /** System roots plus the capture CA, for `SSL_CERT_FILE`. */
  readonly bundle: string;
  /** mitmproxy's confdir: `mitmproxy-ca.pem` is the key and certificate. */
  readonly confDir: string;
  /** The addon, written from the copy embedded in the binary. */
  readonly addon: string;
  readonly spoolDir: string;
  readonly logsDir: string;
  readonly launchAgent: string;
};

export function defaultBrimCapturePaths(home = os.homedir()): BrimCapturePaths {
  const root = path.join(home, ".toolkit", "brim-capture");
  return {
    home,
    root,
    caCert: path.join(root, "ca", "capture-ca.pem"),
    caKey: path.join(root, "ca", "capture-ca.key"),
    bundle: path.join(root, "ca", "bundle.pem"),
    confDir: path.join(root, "mitmproxy"),
    addon: path.join(root, "brim_capture.py"),
    spoolDir: path.join(root, "spool"),
    logsDir: path.join(root, "logs"),
    launchAgent: path.join(
      home,
      "Library",
      "LaunchAgents",
      "com.jerred.brim-capture.plist",
    ),
  };
}
