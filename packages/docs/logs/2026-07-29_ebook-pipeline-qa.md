---
id: log-2026-07-29-ebook-pipeline-qa
type: log
status: complete
board: false
---

# Ebook pipeline Q&A

Summarized the intended path from requesting a book in Bindery to reading it
on a Kindle, using the current ebook-stack guide and the latest first-boot
configuration log.

## Pipeline

1. Add or monitor a book in Bindery.
2. Bindery searches Prowlarr-backed torrent indexers and ShelfBridge. ShelfBridge
   supplies the LibGen, Anna's Archive, and Z-Library webseed path used especially
   for Chinese-language books.
3. Bindery sends the selected release to qBittorrent. For ShelfBridge results,
   qBittorrent fetches the HTTP webseed through ShelfBridge while running in
   Gluetun's network namespace.
4. When the download finishes, Bindery performs an External handoff into
   `/ingest` on the shared ebook PVC.
5. CWA watches that directory at `/cwa-book-ingest`, imports the book, repairs
   and converts it to EPUB, fetches metadata, and writes the managed library at
   `/calibre-library`.
6. CWA Auto-Send submits the EPUB over SMTP to Postal.
7. Postal sends it to the device's `@kindle.com` address. Amazon accepts the
   message only after the Postal sender is added to the Kindle account's
   approved Personal Document senders.
8. The Kindle downloads the Personal Document over Wi-Fi, where it can be
   opened like any other book.

Bindery and the acquisition handoff were already configured. CWA SMTP,
EPUB processing, the Kindle destination, and Auto-Send were configured and
verified live on 2026-07-29. The user confirmed that the CWA sender is approved
in Amazon. Only the full end-to-end smoke tests remain.

## Current TODO checklist

The CWA admin password, Kindle destination, Postal credential, SMTP settings,
EPUB processing, Auto-Send, and Amazon approved sender are complete. The
remaining work is:

1. Run a standard end-to-end smoke test: request a known book in Bindery,
   observe qBittorrent completion and CWA ingest, then confirm it arrives and
   opens on the Kindle.
2. Run the Chinese-content smoke test through ShelfBridge, such as
   `原子习惯`, and verify the webseed download, CWA ingest, and Kindle delivery.

## Finding the Send-to-Kindle address

The Amazon account owner can find it on the web under:

`Manage Your Content and Devices` → `Preferences` →
`Personal Document Settings` → `Send to Kindle Email Settings`

Select the physical Kindle from the listed devices and copy its `@kindle.com`
address. The address can also be read directly on a registered Kindle under:

`Settings` → `Your Account` → `Send-to-Kindle Email`

Because this Kindle is registered to someone else's Amazon account, either use
the physical-device route or ask that account owner to retrieve the address.
The owner will also need to add the complete CWA sender address under
`Approved Personal Document Email List` on the same Amazon page.

## Postal SMTP credential mapping

The Kindle destination and a Postal SMTP credential have now been supplied
out-of-band. Their values are deliberately not recorded here.

Postal's SMTP `LOGIN` and `PLAIN` authentication accept any non-empty username;
the generated credential key is used as the SMTP password. For CWA, use a
descriptive username such as `cwa` and put the generated key only in the
password field.

## Live CWA configuration

Configured through the live CWA UI on 2026-07-29:

- Standard SMTP account:
  `postal-postal-smtp-service.postal:25`, no encryption
- SMTP login label: `cwa`
- Sender: `CWA <cwa@sjer.red>`
- Kindle destination: configured but redacted from this document
- Per-user Auto-Send: enabled
- Auto-Send delay: five minutes
- Auto-convert: enabled, target `epub`
- Kindle EPUB Fixer: enabled
- Aggressive EPUB Fixer: left disabled
- Automatic metadata replacement: left disabled

Verification from the running CWA pod proved DNS/network connectivity, SMTP
authentication, and acceptance of the `cwa@sjer.red` envelope sender. The
session reset the SMTP transaction before adding a recipient, so this check
sent no email.

## First delivery result

The first end-to-end delivery succeeded through Bindery, qBittorrent, CWA,
Postal, and Kindle. The delivered file contained Traditional rather than
Simplified Chinese. The pipeline does not transliterate a book's contents, so
this indicates that the acquired release was a Traditional edition.

Bindery's current metadata profile allows the ISO language codes `chi` and
`zho`. Those identify Chinese generally and do not distinguish Simplified
`zh-Hans` from Traditional `zh-Hant`, so the edition must be selected using
the release title, region/publisher, or preferably an ISBN.

For _Atomic Habits_, `原子習慣` is the Taiwan Traditional edition. The Mainland
Simplified edition is `掌控习惯`; ISBN `9787559632265` identifies its original
Mainland release. Use that title or ISBN for the Simplified-specific retry.

## Session Log — 2026-07-29

### Done

- Explained the intended Bindery → qBittorrent/ShelfBridge → CWA → Postal →
  Kindle pipeline.
- Cross-checked the architecture guide and the latest first-boot configuration
  log.
- Converted the recorded gaps into a dependency-ordered operator checklist.
- Documented the web and on-device paths for retrieving the Send-to-Kindle
  address.
- Confirmed the Postal key-to-SMTP-field mapping without persisting either
  supplied secret value.
- Configured CWA SMTP, the Kindle destination, and Auto-Send in the live UI.
- Verified the existing EPUB conversion/fixer settings.
- Verified SMTP authentication and sender-envelope acceptance from the running
  CWA pod without sending a message.
- Recorded the user's confirmation that `cwa@sjer.red` is approved in the
  Kindle account's Personal Document settings.
- Confirmed the first real book completed the full acquisition-to-Kindle
  pipeline.
- Identified the Traditional result as an edition-selection issue, not a CWA or
  Kindle conversion issue.

### Remaining

- Acquire a known Simplified edition, preferably by Mainland ISBN, and confirm
  the text remains Simplified through delivery.

### Caveats

- The active Postal credential was pasted into the chat and included in a
  screenshot. Rotate it after setup if conversation exposure is unacceptable;
  rotating requires updating the CWA SMTP password.
- Bindery's `chi`/`zho` language filter does not distinguish Simplified and
  Traditional Chinese scripts.
