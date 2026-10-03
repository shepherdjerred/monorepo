# Vault compatibility fixtures

`upstream/field-mapping.json` is the unmodified 139-case field-mapping corpus
from [TaskNotes specification commit 4c619bf](https://github.com/callumalpass/tasknotes-spec/tree/4c619bf130330e1ca7df2c773800857f731ca8c6).
Its SHA-256 is
`d2e28bd321a17ce94f41681e564883ab83eba22a633999fd0439344141f6ee48`.
The specification package declares MIT licensing. Preserve upstream cases;
an implementation disagreement is a finding, not a reason to edit the oracle.

`upstream/obsidian-crypto.json` records output produced by the official
[Obsidian headless client at commit 0d0ec43](https://github.com/obsidianmd/obsidian-headless/tree/0d0ec4364bfde6c715c539cf3555ff8272bb7a58).
The file records the exact reference URL, source SHA-256, public synthetic
inputs, derived key, and encryption outputs for versions 0, 2, and 3. These
inputs are test vectors, never account credentials or a real vault key.

Regenerate only through `packages/tasknotes-core/ci/obsidian-reference.ts`.
That explicit maintenance harness downloads and hash-checks the reference,
then evaluates its extracted crypto functions. It does not evaluate CLI
startup, account authentication, storage, or network operations. No official
client JavaScript is committed or bundled in the native applications.
