# Backblaze backup buckets

This operator-only stack creates the private backup buckets and a key scoped
to each one. The master application key is `B2_APPLICATION_KEY_ID` and
`B2_APPLICATION_KEY`. Create the Backblaze account in `us-west-004`. CI can
validate this stack. The wrapper rejects every live operation from CI.

Scoped keys are written into 1Password items in the homelab vault. The
1Password provider uses the desktop app for the account named by `OP_ACCOUNT`.
State and plans are encrypted with `TOFU_STATE_ENCRYPTION_PASSPHRASE`.

Velero and the SeaweedFS backup worker are not pointed at these buckets by
this stack. They move after the buckets exist and the existing backup objects
have been copied.

```sh
bun packages/homelab/scripts/tofu/tofu-stack.ts backblaze validate
```
