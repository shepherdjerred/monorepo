# Fix `https://sjer.red/rss.xml` reported as "page not found" — proper s3proxy patch

## Status

In Progress

## Context

A subscriber (Farzad) reports their RSS reader cannot reach `https://sjer.red/rss.xml`, showing "page not found." Diagnostics show the feed itself is healthy (GET → 200, 190 KB of valid RSS XML), but **every path on every static site** behind `s3-static-sites` returns **HTTP 405 on HEAD**:

```text
GET  https://sjer.red/rss.xml  → 200  application/xml  190,470 bytes
HEAD https://sjer.red/rss.xml  → 405  Method Not Allowed
```

Many RSS readers issue a HEAD against the feed URL to validate it and check `ETag` / `Last-Modified` before downloading; on 405 they fall back to a "feed does not exist" error.

Root cause is in [`github.com/lindenlab/caddy-s3-proxy`](https://github.com/lindenlab/caddy-s3-proxy) (the upstream Go plugin baked into the custom Caddy binary built at [.dagger/src/image.ts:441-450](.dagger/src/image.ts:441)). Its `ServeHTTP` only routes `GET`/`PUT`/`DELETE`; everything else returns 405:

```go
// s3proxy.go ServeHTTP, lines 370–379 upstream
switch r.Method {
case http.MethodGet:    err = p.GetHandler(w, r, fullPath)
case http.MethodPut:    err = p.PutHandler(w, r, fullPath)
case http.MethodDelete: err = p.DeleteHandler(w, r, fullPath)
default:                err = caddyhttp.Error(http.StatusMethodNotAllowed, errors.New("method not allowed"))
}
```

A second, related bug ([upstream #63](https://github.com/lindenlab/caddy-s3-proxy/issues/63)): conditional GET on a directory index path (e.g. `GET /`) fails with 403 instead of returning 304. The current Caddyfile (line 69 of [s3-static-site.ts](packages/homelab/src/cdk8s/src/misc/s3-static-site.ts:67)) works around this by **stripping `If-Modified-Since` and `If-None-Match` from every incoming request**, forcing readers to re-download the full 190 KB feed on every poll. We'll fix that properly in this PR.

Affected sites (all listed in [packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts](packages/homelab/src/cdk8s/src/resources/s3-static-sites/sites.ts)): `sjer.red`, `webring.sjer.red`, `resume.sjer.red`, `discord-plays-pokemon.com`, `scout-for-lol.com`, `better-skill-capped.com`, `clauderon.com`, `ts-mc.net`, `cook.sjer.red`.

## Approach — fork upstream, patch the plugin, swap via xcaddy

1. **Fork** `lindenlab/caddy-s3-proxy` → `github.com/shepherdjerred/caddy-s3-proxy` (does not currently exist).
2. **Patch the Go source** to:
   - Add native `HEAD` support using `s3.HeadObject` (cheap — no body transfer).
   - Fix the 304 bug from upstream issue #63: when index lookup returns `NotModified`, return 304 directly instead of falling through and re-fetching the directory.
3. **Point the Dagger build** at the fork via `xcaddy`'s module replacement syntax (`--with module=replacement@ref`). Keeps import path the same; just swaps the source.
4. **Remove the Caddyfile workaround** that strips conditional headers.
5. **Bump the image version** in `versions.ts` (manually — entry is marked "not managed by renovate").
6. **Open an upstream PR** from the fork back to `lindenlab/caddy-s3-proxy` for HEAD + #63. Independent of the deploy.

## Files and the exact changes

### A. Fork: `github.com/shepherdjerred/caddy-s3-proxy` (new repo)

Source-of-truth patch lives in the fork. Branch: `feat/head-and-304`.

#### `s3proxy.go` — add HEAD handling

```go
// In ServeHTTP, extend the method switch:
switch r.Method {
case http.MethodGet:    err = p.GetHandler(w, r, fullPath)
case http.MethodHead:   err = p.HeadHandler(w, r, fullPath)
case http.MethodPut:    err = p.PutHandler(w, r, fullPath)
case http.MethodDelete: err = p.DeleteHandler(w, r, fullPath)
default:
    err = caddyhttp.Error(http.StatusMethodNotAllowed, errors.New("method not allowed"))
}
```

```go
// New: HeadHandler mirrors GetHandler but uses HeadObject (no body fetched).
func (p S3Proxy) HeadHandler(w http.ResponseWriter, r *http.Request, fullPath string) error {
    if fileHidden(fullPath, p.Hide) {
        return caddyhttp.Error(http.StatusNotFound, nil)
    }
    isDir := strings.HasSuffix(fullPath, "/")
    var head *s3.HeadObjectOutput
    var err error

    if isDir && len(p.IndexNames) > 0 {
        for _, indexPage := range p.IndexNames {
            indexPath := path.Join(fullPath, indexPage)
            head, err = p.headS3Object(p.Bucket, indexPath, r.Header)
            caddyErr := convertToCaddyError(err)
            if err == nil { isDir = false; break }
            if caddyErr.StatusCode == http.StatusNotModified { return caddyErr }
            // log non-NoSuchKey errors like GetHandler does
        }
    }
    if isDir {
        return caddyhttp.Error(http.StatusForbidden, errors.New("can not view a directory"))
    }
    if head == nil {
        head, err = p.headS3Object(p.Bucket, fullPath, r.Header)
        if err != nil { return convertToCaddyError(err) }
    }
    return p.writeResponseFromHeadObject(w, head)
}

func (p S3Proxy) headS3Object(bucket, key string, headers http.Header) (*s3.HeadObjectOutput, error) {
    in := &s3.HeadObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)}
    if v := headers.Get("If-Match");           v != "" { in.IfMatch = aws.String(v) }
    if v := headers.Get("If-None-Match");      v != "" { in.IfNoneMatch = aws.String(v) }
    if v := headers.Get("If-Modified-Since");  v != "" {
        if t, err := time.Parse(http.TimeFormat, v); err == nil { in.IfModifiedSince = aws.Time(t) }
    }
    if v := headers.Get("If-Unmodified-Since"); v != "" {
        if t, err := time.Parse(http.TimeFormat, v); err == nil { in.IfUnmodifiedSince = aws.Time(t) }
    }
    return p.client.HeadObject(in)
}

func (p S3Proxy) writeResponseFromHeadObject(w http.ResponseWriter, obj *s3.HeadObjectOutput) error {
    setStrHeader(w, "Cache-Control", obj.CacheControl)
    setStrHeader(w, "Content-Disposition", obj.ContentDisposition)
    setStrHeader(w, "Content-Encoding", obj.ContentEncoding)
    setStrHeader(w, "Content-Language", obj.ContentLanguage)
    setStrHeader(w, "Content-Type", obj.ContentType)
    setStrHeader(w, "ETag", obj.ETag)
    setStrHeader(w, "Expires", obj.Expires)
    setTimeHeader(w, "Last-Modified", obj.LastModified)
    if obj.ContentLength != nil {
        w.Header().Set("Content-Length", strconv.FormatInt(*obj.ContentLength, 10))
    }
    for k, v := range obj.Metadata { setStrHeader(w, k, v) }
    return nil
}
```

#### `s3proxy.go` — fix the 304-on-index bug (upstream #63)

In `GetHandler`, change the existing index-lookup loop so a 304 from the index returns immediately instead of falling through to re-fetch:

```go
// Was:
if err == nil || caddyErr.StatusCode == 304 {
    isDir = false
    break
}

// Becomes:
if err == nil { isDir = false; break }
if caddyErr.StatusCode == http.StatusNotModified {
    return caddyErr
}
```

#### `s3proxy_test.go` — new tests

- `TestHeadHandler_File` — HEAD on a known key → 200, headers populated, **zero-byte body**.
- `TestHeadHandler_NotModified` — HEAD with matching `If-None-Match` → 304, no body.
- `TestHeadHandler_NotFound` — HEAD on missing key → 404.
- `TestGetHandler_IndexNotModified` — GET `/` with matching `If-None-Match` for `index.html` → 304 (regression for #63).

### B. This monorepo

#### `.dagger/src/image.ts` (around line 441-450)

Change:

```ts
.withExec([
  "xcaddy",
  "build",
  "--with",
  "github.com/lindenlab/caddy-s3-proxy",
])
```

to point at the fork via xcaddy module replacement:

```ts
.withExec([
  "xcaddy",
  "build",
  "--with",
  // import path stays the same; xcaddy resolves the source from the fork
  "github.com/lindenlab/caddy-s3-proxy=github.com/shepherdjerred/caddy-s3-proxy@<tagged-version>",
])
```

Pin to a tagged version (or commit SHA) of the fork — never `main` — so cache keys and reproducibility are stable.

#### `packages/homelab/src/cdk8s/src/misc/s3-static-site.ts`

Drop the conditional-header strip workaround (lines 67–70). Updated block:

```diff
 ${address} {
     # Redirect directory-style paths to include trailing slash
     @noTrailingSlash path_regexp ^/[^.]*[^/]$
     redir @noTrailingSlash {uri}/ 301
-
-    # Strip conditional headers to work around caddy-s3-proxy issue #63
-    # https://github.com/lindenlab/caddy-s3-proxy/issues/63
-    request_header -If-Modified-Since
-    request_header -If-None-Match

     s3proxy { ... }
 }
```

#### `packages/homelab/src/cdk8s/src/versions.ts:208`

Bump the pinned tag + digest to the newly built image:

```ts
"shepherdjerred/caddy-s3proxy":
  "<new-tag>@sha256:<new-digest>",
```

The CI pipeline (`scripts/ci/src/catalog.ts`) already builds `caddy-s3proxy` via `build-caddy-s-3-proxy-image` and pushes via `push-caddy-s-3-proxy-image`; no CI wiring changes needed.

#### New: `packages/homelab/src/cdk8s/src/misc/s3-static-site.test.ts`

Unit test for `generateCaddyfile()` asserting:

- `request_header -If-Modified-Since` / `-If-None-Match` are **not** present in the output.
- Existing directives (`redir @noTrailingSlash`, `s3proxy { bucket … }`) still are.

### C. Optional follow-up PR

Open an upstream PR from `shepherdjerred/caddy-s3-proxy:feat/head-and-304` → `lindenlab/caddy-s3-proxy:master`. Reference issue #63 in the description.

## Verification

| Step                               | Command / action                                                                                                                                                | Expected                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1. Fork builds                     | `go test ./...` in the fork                                                                                                                                     | All new + existing tests pass                    |
| 2. Image builds locally            | `cd .dagger && dagger call build-caddy-s-3-proxy-image --version dev --git-sha test export --path /tmp/caddy.tar`                                               | Image artefact produced                          |
| 3. Smoke test                      | `dagger call smoke-test-caddy-s-3-proxy` (already wired in `scripts/ci/src/steps/images.ts`)                                                                    | Passes                                           |
| 4. Local run against test bucket   | `docker run -p 8080:80 -e AWS_ACCESS_KEY_ID=… -e AWS_SECRET_ACCESS_KEY=… caddy-s3proxy:dev` with a test Caddyfile, then `curl -I http://localhost:8080/foo.txt` | HTTP/2 200, headers set, **zero-byte body**      |
| 5. Conditional GET                 | `curl -i -H 'If-None-Match: <etag>' http://localhost:8080/foo.txt`                                                                                              | 304 Not Modified                                 |
| 6. cdk8s synth                     | `cd packages/homelab/src/cdk8s && bun run synth`                                                                                                                | ConfigMap omits the `request_header -If-…` lines |
| 7. Repo tests                      | `cd packages/homelab && bun test src/cdk8s/src/misc/s3-static-site.test.ts`                                                                                     | Passes                                           |
| 8. Post-deploy (after ArgoCD sync) | `curl -sI https://sjer.red/rss.xml`; then `curl -i -H 'If-None-Match: <etag>' https://sjer.red/rss.xml`                                                         | `200` on HEAD, `304` on cached fetch             |
| 9. End-to-end                      | Subscribe to the feed in a HEAD-using reader (e.g. NetNewsWire, FreshRSS)                                                                                       | Loads cleanly                                    |
| 10. Reply to Farzad                | —                                                                                                                                                               | Confirm fix and thank them                       |
