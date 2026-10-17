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

(public-tls) {
  tls {
    issuer acme {
      disable_tlsalpn_challenge
    }
  }
}

# Keep tunnel recovery and HTTP-01 issuance independent of the public TLS listener.
# Health and challenge requests must be handled before legacy-host redirects.
http://:8082 {
  handle /healthz {
    respond "ok" 200
  }
  handle /.well-known/acme-challenge/* {
    reverse_proxy 127.0.0.1:8080
  }
  @legacy not host arcade.sjer.red
  handle @legacy {
    header Cache-Control "no-store"
    redir https://arcade.sjer.red{uri} 307
  }
  handle {
    import controller
  }
}

https://arcade.sjer.red {
  import public-tls
  import controller
}

https://mariokart.sjer.red {
  import public-tls
  header Cache-Control "no-store"
  redir https://arcade.sjer.red{uri} 307
}
`;
}
