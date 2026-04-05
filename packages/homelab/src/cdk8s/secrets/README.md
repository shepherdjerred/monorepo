# Overview

These are the only native/plaintext secrets that the Kubernetes cluster needs.
Everything else is stored in my 1Password vault named `Kubernetes`.

- Be sure not to commit any changes to these files so that secrets don't
  leak.
- These should be the only credentials that are manually set. Everything else
  can be retrieved from 1Password.
- The credential in `1password-secret.yaml` must be the **raw JSON** from
  `1password-credentials.json` (do NOT base64-encode it — `stringData` handles
  encoding automatically). Chart v2.3.0+ mounts the secret as a file, not an
  env var, so double-encoding will break it.

```bash
kubectl create namespace 1password
kubectl apply -f secrets/1password-secret.yaml
kubectl apply -f secrets/1password-token.yaml
```
