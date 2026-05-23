type BlackboxHttpModule = {
  prober: "http";
  timeout: string;
  http: {
    valid_http_versions: string[];
    valid_status_codes?: number[];
    follow_redirects: boolean;
    preferred_ip_protocol: "ip4";
    fail_if_body_not_matches_regexp?: string[];
  };
};

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

export const BLACKBOX_MODULES = {
  http_2xx: HTTP_2XX_MODULE,
  rss_2xx: RSS_2XX_MODULE,
};
