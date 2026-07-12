type BlackboxHttpModule = {
  prober: "http";
  timeout: string;
  http: {
    valid_http_versions: string[];
    valid_status_codes?: number[];
    follow_redirects: boolean;
    preferred_ip_protocol: "ip4";
    fail_if_body_not_matches_regexp?: string[];
    tls_config?: { insecure_skip_verify: boolean };
  };
};

type BlackboxTcpModule = {
  prober: "tcp";
  timeout: string;
};

// valid_status_codes narrows acceptance to 200, 301, 302 only — a deliberate
// tightening from the standalone blackbox-exporter default (which previously
// omitted valid_status_codes and so accepted any 2xx response, including
// 204/206/etc.). Probes for the static-site fleet only ever serve 200 or a
// redirect, so unexpected 2xx codes should surface as failures rather than
// silently passing. This also keeps both blackbox deployments in lockstep.
export const HTTP_2XX_MODULE: BlackboxHttpModule = {
  prober: "http",
  timeout: "10s",
  http: {
    valid_http_versions: ["HTTP/1.1", "HTTP/2.0"],
    valid_status_codes: [200, 301, 302],
    follow_redirects: true,
    preferred_ip_protocol: "ip4",
  },
};

export const RSS_2XX_MODULE: BlackboxHttpModule = {
  prober: "http",
  timeout: "10s",
  http: {
    valid_http_versions: ["HTTP/1.1", "HTTP/2.0"],
    valid_status_codes: [200],
    follow_redirects: true,
    preferred_ip_protocol: "ip4",
    fail_if_body_not_matches_regexp: ["<rss", "<channel>"],
  },
};

// For in-cluster backend probes whose certs are self-signed (e.g.
// argocd-server) — the Cloudflare-fronted public hostname for the same
// service gets a validly-issued edge cert, so its probe uses HTTP_2XX_MODULE
// instead.
export const HTTPS_2XX_INSECURE_MODULE: BlackboxHttpModule = {
  prober: "http",
  timeout: "10s",
  http: {
    valid_http_versions: ["HTTP/1.1", "HTTP/2.0"],
    valid_status_codes: [200, 301, 302],
    follow_redirects: true,
    preferred_ip_protocol: "ip4",
    tls_config: { insecure_skip_verify: true },
  },
};

// Plain TCP-connect check, no HTTP semantics — for gRPC/webhook-only
// endpoints where an HTTP GET can't reliably distinguish healthy from
// unhealthy (e.g. Temporal's gRPC frontend, POST-only webhook receivers).
export const TCP_CONNECT_MODULE: BlackboxTcpModule = {
  prober: "tcp",
  timeout: "10s",
};

export const BLACKBOX_MODULES = {
  http_2xx: HTTP_2XX_MODULE,
  rss_2xx: RSS_2XX_MODULE,
  https_2xx_insecure: HTTPS_2XX_INSECURE_MODULE,
  tcp_connect: TCP_CONNECT_MODULE,
};

export type ProbeModule = keyof typeof BLACKBOX_MODULES;
