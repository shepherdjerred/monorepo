# Statically Typed

Minimal anchor page showing the Statically Typed name in Berkeley Mono.
Plain HTML and CSS are built with Bun and served through the homelab's shared
Caddy static-site service.

## Commands

Run from this package after the root workspace install:

```bash
bun run dev        # build and serve at http://127.0.0.1:4326
bun run build      # HTML, CSS, and font → dist/
bun run preview    # serve the existing dist/
bun run typecheck
bun run lint
bun run test
bun run deploy     # authenticated repository static-site deployment
```

Rebuild and refresh after changing the page; the preview does not watch files.

## Font input

The build reuses Berkeley Mono Regular WOFF2 from Scout's existing
`design-system/assets/fonts/BerkeleyMono/` directory. It validates the font
before copying it into ignored `dist/fonts/`; no additional font binary is
tracked in this package. Turbo and CI selectors include that input so font
changes rebuild the site. The page serves the font from its own origin.

## Deployment

The deploy catalog builds this package and syncs `dist/` to the
`statically-typed` SeaweedFS bucket with `no-cache` headers. OpenTofu owns the
bucket and apex DNS record; the shared static-site chart owns Caddy routing,
the Cloudflare Tunnel binding, and availability probes. The `ci-sites`
identity needs scoped bucket access as described in the repository's
static-site release procedure.
