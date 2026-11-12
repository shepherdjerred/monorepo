import { createHash } from "node:crypto";
import type { Construct } from "constructs";
import { DataResource, Token } from "cdktn";
import { mailPolicyText } from "homelab/src/domain-registry.ts";
import type { MailPolicy } from "homelab/src/domain-registry.ts";
import { CtAlerting } from "#generated/providers/cloudflare/ct-alerting/index.ts";
import { DnsRecord } from "#generated/providers/cloudflare/dns-record/index.ts";
import { ZoneDnssec } from "#generated/providers/cloudflare/zone-dnssec/index.ts";
import { ZoneSetting } from "#generated/providers/cloudflare/zone-setting/index.ts";
import { DataHttp } from "#generated/providers/http/data-http/index.ts";
import { FlattenedModule } from "#src/flattened-module.ts";

export type DomainBaselineProps = {
  /** Apex domain served by Fastmail. */
  domain: string;
  /** The existing Cloudflare zone; the baseline never creates or replaces one. */
  zoneId: string;
  /** Prefix of every resource name: the zone's own resource name. */
  resourcePrefix: string;
  /**
   * Account-side domain onboarding is confirmed: permit MX cutover and
   * outbound SPF only when ready.
   */
  fastmailReady: boolean;
  /**
   * Preserve Fastmail subdomain addressing. This does not authenticate
   * arbitrary subdomain senders.
   */
  wildcardMail: boolean;
  /** TLS 1.3 setting; `zrt` preserves existing 0-RTT without enabling it anew. */
  tls13: "on" | "zrt";
  /** Publish discovery only after HTTPS policy and SMTP STARTTLS acceptance checks. */
  mtaStsPublished: boolean;
  /**
   * Owned inbox for certificate alerts. `null` preserves the recipients
   * Cloudflare already holds, without exposing their addresses in source.
   */
  ctAlertRecipient: string | null;
  /** Language-neutral MTA-STS policy shared with Caddy. */
  mailPolicy: MailPolicy;
  /** What the policy host's record points at: the Cloudflare Tunnel. */
  tunnelTarget: string;
};

const CERTIFICATE_AUTHORITIES = {
  letsencrypt: "letsencrypt.org",
  google_trust_services: "pki.goog; cansignhttpexchanges=yes",
  sectigo: "sectigo.com",
  ssl_com: "ssl.com",
} as const;

const DKIM_SELECTORS = ["fm1", "fm2", "fm3"] as const;

const DOMAIN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/u;
const EMAIL = /^[^ @,]+@[^ @,.]+(?:\.[^ @,.]+)+$/u;

/**
 * The shared security and mail baseline of one zone: DNSSEC, Fastmail MX,
 * DKIM, SPF, DMARC, TLS reporting, the MTA-STS policy host and discovery
 * record, CAA, HTTPS/TLS/HSTS settings and certificate transparency alerts.
 *
 * It replaces the HCL module `modules/domain-baseline`: every resource is a
 * root resource named `<resourcePrefix>_baseline_<name>`, and `relocations`
 * maps each one from its `module.domain_baseline["<domain>"]` address. The
 * module's conditions are decided here, at synthesis.
 */
export class DomainBaseline extends FlattenedModule {
  readonly dnssec: ZoneDnssec;
  readonly minTlsVersion: ZoneSetting;
  readonly securityHeader: ZoneSetting;

  private readonly props: DomainBaselineProps;

  constructor(scope: Construct, props: DomainBaselineProps) {
    super(scope, props.domain, `module.domain_baseline["${props.domain}"]`);
    if (!DOMAIN.test(props.domain))
      throw new Error(`${props.domain} must be a lowercase DNS name.`);
    if (props.ctAlertRecipient !== null && !EMAIL.test(props.ctAlertRecipient))
      throw new Error(
        "Use a single email address, or null to preserve existing recipients.",
      );
    if (props.mtaStsPublished && !props.fastmailReady)
      throw new Error(
        `${props.domain}: confirm the domain in Fastmail before advertising transport enforcement.`,
      );
    this.props = props;

    this.dnssec = this.place(
      new ZoneDnssec(this, "dnssec", {
        zoneId: props.zoneId,
        status: "active",
      }),
      this.named("dnssec"),
      "dnssec",
    );
    this.mail();
    this.mailPolicyHost();
    this.certificateAuthorities();
    this.setting("https", "always_use_https", "on").importFrom(
      `${props.zoneId}/always_use_https`,
    );
    this.setting("ssl", "ssl", "strict").importFrom(`${props.zoneId}/ssl`);
    this.minTlsVersion = this.setting(
      "min_tls_version",
      "min_tls_version",
      "1.2",
    );
    this.setting("tls_1_3", "tls_1_3", props.tls13).importFrom(
      `${props.zoneId}/tls_1_3`,
    );
    this.securityHeader = this.setting("security_header", "security_header", {
      strict_transport_security: {
        enabled: true,
        max_age: 86_400,
        include_subdomains: true,
        nosniff: true,
        preload: false,
      },
    });
    this.certificateAlerts();
  }

  private named(name: string): string {
    return `${this.props.resourcePrefix}_baseline_${name}`;
  }

  /** A record of the zone, at `cloudflare_dns_record.<nameInModule>` in the module. */
  private record(
    name: string,
    nameInModule: string,
    record: Omit<ConstructorParameters<typeof DnsRecord>[2], "zoneId" | "ttl">,
  ): DnsRecord {
    return this.place(
      new DnsRecord(this, name, {
        zoneId: this.props.zoneId,
        ttl: 1,
        ...record,
      }),
      this.named(name),
      nameInModule,
    );
  }

  private setting(
    name: string,
    settingId: string,
    value: string | Record<string, unknown>,
  ): ZoneSetting {
    return this.place(
      new ZoneSetting(this, name, {
        zoneId: this.props.zoneId,
        settingId,
        value: Token.asAny(value),
      }),
      this.named(name),
      name,
    );
  }

  private mail(): void {
    const { domain, fastmailReady, wildcardMail, mailPolicy } = this.props;
    const exchanges = {
      primary: { host: mailPolicy.mx[0], priority: 10 },
      secondary: { host: mailPolicy.mx[1], priority: 20 },
    } as const;
    // Unregistered domains advertise no mail routing.
    const routed: [string, string][] = [];
    if (fastmailReady) routed.push(["mx", domain]);
    if (fastmailReady && wildcardMail) routed.push(["wildcard_mx", "*"]);
    for (const [resource, name] of routed)
      for (const [key, exchange] of Object.entries(exchanges))
        this.record(`${resource}_${key}`, `${resource}["${key}"]`, {
          name,
          type: "MX",
          content: exchange.host,
          priority: exchange.priority,
        });

    for (const selector of DKIM_SELECTORS)
      this.record(`dkim_${selector}`, `dkim["${selector}"]`, {
        name: `${selector}._domainkey`,
        type: "CNAME",
        content: `${selector}.${domain}.dkim.fmhosted.com`,
        proxied: false,
      });
    this.record("spf", "spf", {
      name: domain,
      type: "TXT",
      // Only a confirmed domain authorizes outbound mail.
      content: fastmailReady
        ? "v=spf1 include:spf.messagingengine.com -all"
        : "v=spf1 -all",
    });
    this.record("dmarc", "dmarc", {
      name: "_dmarc",
      type: "TXT",
      content:
        "v=DMARC1; p=reject; sp=reject; adkim=r; aspf=r; rua=mailto:dmarc@sjer.red",
    });
    this.record("tlsrpt", "tlsrpt", {
      name: "_smtp._tls",
      type: "TXT",
      content: "v=TLSRPTv1; rua=mailto:dmarc@sjer.red",
    });
  }

  /**
   * The policy host is always provisioned. The discovery record is published
   * only once the exact policy is served over HTTPS as plain text; its
   * revision is derived from that policy, including its final LF.
   */
  private mailPolicyHost(): void {
    const { domain, mtaStsPublished, mailPolicy, tunnelTarget } = this.props;
    this.record("mta_sts_host", "mta_sts_host", {
      name: "mta-sts",
      type: "CNAME",
      content: tunnelTarget,
      proxied: true,
    });
    if (!mtaStsPublished) return;

    const policy = mailPolicyText(mailPolicy);
    const served = this.place(
      new DataHttp(this, "mail_policy", {
        url: `https://mta-sts.${domain}/.well-known/mta-sts.txt`,
        requestTimeoutMs: 10_000,
      }),
      this.named("mail_policy"),
      "mail_policy[0]",
    );
    const response = `data.${served.terraformResourceType}.${this.named("mail_policy")}`;
    const revision = createHash("sha256")
      .update(policy)
      .digest("hex")
      .slice(0, 16);
    this.record("mta_sts", "mta_sts[0]", {
      name: "_mta-sts",
      type: "TXT",
      content: `v=STSv1; id=${revision}`,
      lifecycle: {
        precondition: [
          {
            // JSON string syntax is an HCL string literal for this text.
            condition: `\${${response}.status_code == 200 && ${response}.response_body == ${JSON.stringify(policy)} && startswith(lookup(${response}.response_headers, "Content-Type", ""), "text/plain")}`,
            errorMessage:
              "Serve the exact HTTPS Fastmail policy as plain text before publishing MTA-STS discovery.",
          },
        ],
      },
    });
  }

  private certificateAuthorities(): void {
    const { domain } = this.props;
    // Cloudflare Universal SSL uses wildcard certificates for Tunnel
    // hostnames, so each authority may issue both.
    for (const tag of ["issue", "issuewild"] as const)
      for (const [authority, value] of Object.entries(CERTIFICATE_AUTHORITIES))
        this.record(`caa_${tag}_${authority}`, `caa_${tag}["${authority}"]`, {
          name: domain,
          type: "CAA",
          data: { flags: Token.asAny(0), tag, value },
        });
    this.record("caa_iodef", "caa_iodef", {
      name: domain,
      type: "CAA",
      data: {
        flags: Token.asAny(0),
        tag: "iodef",
        value: "mailto:dmarc@sjer.red",
      },
    });
  }

  private certificateAlerts(): void {
    const { zoneId, ctAlertRecipient } = this.props;
    if (ctAlertRecipient === null) {
      // Retain previously configured recipients.
      this.place(
        new CtAlerting(this, "ct_existing", {
          zoneId,
          enabled: true,
          lifecycle: { ignoreChanges: ["emails"] },
        }),
        this.named("ct_existing"),
        "ct_existing[0]",
      ).importFrom(zoneId);
      return;
    }
    const recipient = this.place(
      new DataResource(this, "ct_recipient", {
        triggersReplace: Token.asAny(ctAlertRecipient),
      }),
      this.named("ct_recipient"),
      "ct_recipient[0]",
    );
    // Provider 5.27 sends only changed fields on Update, but the API requires
    // `enabled` even for an email-only update. Create sends the complete
    // payload; this provider's Delete is a no-op, so replacement never
    // disables alerts.
    this.place(
      new CtAlerting(this, "ct", {
        zoneId,
        enabled: true,
        emails: [ctAlertRecipient],
        lifecycle: {
          createBeforeDestroy: true,
          // By address: a resource object is written as "${...}", which
          // OpenTofu rejects here in JSON syntax.
          replaceTriggeredBy: [
            `${recipient.terraformResourceType}.${this.named("ct_recipient")}`,
          ],
        },
      }),
      this.named("ct"),
      "ct[0]",
    ).importFrom(zoneId);
  }
}
