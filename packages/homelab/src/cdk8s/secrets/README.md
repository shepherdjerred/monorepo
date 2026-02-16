# Overview

These are the only native/plaintext secrets that the Kubernetes cluster needs.
Everything else is stored in my 1Password vault named `Kubernetes`.

- Be sure not to commit any changes to these files so that secrets don't
  leak.
- These should be the only credentials that are manually set. Everything else
  can be retrieved from 1Password.
- Annoyingly, the credential in `1password-secret.yaml` _must_ be base64
  encoded.

```bash
cat 1password-credentials.json | base64 -w 0
```

```bash
kubectl create namespace 1password
kubectl apply -f secrets/1password-secret.yaml
kubectl apply -f secrets/1password-token.yaml
```
