# Backblaze backup buckets

Velero's scheduled backups, which write to Cloudflare R2, are the only
backup, and nothing ever wrote to these buckets. This operator-only stack now
only retires them: its `removed` blocks make the next apply forget the three
buckets without destroying them, and it revokes the scoped keys and deletes
their 1Password items. Delete the buckets out-of-band afterwards. The master
application key is `B2_APPLICATION_KEY_ID` and `B2_APPLICATION_KEY`. CI can
validate this stack. The wrapper rejects every live operation from CI. State
and plans are encrypted with `TOFU_STATE_ENCRYPTION_PASSPHRASE`.

```sh
bun packages/homelab/scripts/tofu/tofu-stack.ts backblaze validate
```
