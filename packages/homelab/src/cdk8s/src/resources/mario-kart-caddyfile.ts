/** Shared by the chart and the Caddy image's parser smoke check. */
export function marioKartCaddyfile(upstream: string): string {
  return `{
  admin off
  http_port 8080
  https_port 8443
  servers {
    protocols h1 h2
  }
}

(controller) {
  @metrics path /metrics /metrics/*
  respond @metrics 404
  reverse_proxy ${upstream} {
    flush_interval -1
  }
}

# The existing tunnel can still serve the app and bootstrap HTTP-01 issuance
# before DNS moves to the home address. This listener stays cluster-only.
http://:8082 {
  handle /healthz {
    respond "ok" 200
  }
  handle {
    import controller
  }
}

https://mariokart.sjer.red {
  tls {
    issuer acme {
      disable_tlsalpn_challenge
    }
  }
  import controller
}
`;
}
