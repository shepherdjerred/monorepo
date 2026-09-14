# MailMate CodeFill

MailMate CodeFill connects a MailMate mailbox rule to macOS native one-time
code AutoFill. It is a single direct-distribution product containing:

- `MailMateCodeFill.app`, a small setup window;
- `MailMateCodeFillProvider.appex`, an AuthenticationServices credential
  provider that advertises `ProvidesOneTimeCodes`; and
- the signed `MailMateCodeFillHelper` executable invoked by the MailMate
  bundle.

The MailMate bundle receives canonical decoded message text from MailMate. The
helper detects a contextual 4–8 character code and stores only that code,
minimal metadata, and a three-minute expiry in the App Group container. No
email body is written and no MailMate database or Accessibility permission is
used.

## Build

The shared parser/store and helper can be tested with Swift Package Manager:

```sh
swift test
```

Generate and build the macOS app and extension with XcodeGen/Xcode:

```sh
xcodegen generate
xcodebuild -project MailMateCodeFill.xcodeproj \
  -scheme MailMateCodeFill \
  -configuration Debug \
  -derivedDataPath .build/xcode \
  CODE_SIGNING_ALLOWED=NO build
```

The checked-in project is configured for the development team used during
local validation. A production build must use the matching Developer ID
certificate, provision the App Group for the app, helper, and extension, sign
all nested code, and notarize the resulting app before direct distribution.
The local Debug build is not a distributable release.

## Open in Xcode and configure signing

The checked-in `MailMateCodeFill.xcodeproj` is the Xcode handoff project. Open
it directly:

```sh
open MailMateCodeFill.xcodeproj
```

In the project editor, select the `MailMateCodeFill` project and verify
**Automatically manage signing** and your **Team** for each of these targets:

| Target                   | Bundle ID                               | Required capabilities                                 |
| ------------------------ | --------------------------------------- | ----------------------------------------------------- |
| MailMateCodeFill         | `com.sjerred.MailMateCodeFill`          | AutoFill Credential Provider, App Groups              |
| MailMateCodeFillProvider | `com.sjerred.MailMateCodeFill.Provider` | AutoFill Credential Provider, App Groups, App Sandbox |
| MailMateCodeFillHelper   | `com.sjerred.MailMateCodeFillHelper`    | App Groups, App Sandbox                               |

All three targets must use the same App Group:
`63ZAG7X889.com.sjerred.MailMateCodeFill`. If Xcode shows a different Team
ID for your account, replace the team prefix in `project.yml`, the three
entitlement files, and `AppConfiguration.swift` before rebuilding. Keep those
files as the source of truth because `xcodegen generate` regenerates the
project settings.

For a configured Developer ID machine, run the complete release flow with:

```sh
DEVELOPMENT_TEAM=63ZAG7X889 \
NOTARY_PROFILE=mailmate-codefill \
scripts/release.sh
```

The release script uses the Xcode project exactly as configured by default, so
it will not overwrite signing choices made in Xcode. Set
`REGENERATE_PROJECT=1` only when you intentionally want to regenerate the
project from `project.yml` first.

`NOTARY_PROFILE` is a local `xcrun notarytool` keychain profile name. Apple
credentials remain in Keychain and are never written to this repository. The
script refuses to overwrite an existing release zip.

## Install and configure

1. Install the notarized `MailMateCodeFill.app`.
2. Open the app and use **Open verification-code settings**, then enable
   MailMate CodeFill as a credential provider.
3. Use **Install / update bundle** in the app. This copies the bundled
   `MailMateCodeFill.mmBundle` into:

   `~/Library/Application Support/MailMate/Bundles/`

4. Reload MailMate bundles from MailMate’s Command menu.
5. Add an Inbox mailbox rule with the action:

   `Run Command → MailMate CodeFill → Copy Verification Code`

6. Send a test verification email. Focus an OTP field in Safari, Chrome, or a
   native macOS text field and select MailMate CodeFill from the native AutoFill
   menu.

The bundle command also appears in MailMate's Command menu for selected-message
resync. Its local shortcut is Shift-Command-E and can be changed in MailMate.

For a nonstandard app location, set `MAILMATE_CODEFILL_APP` in the bundle
command environment to the installed app path.

## Observability and diagnostics

MailMate CodeFill uses macOS Unified Logging locally; it does not send
telemetry to a remote service. Every component emits structured events under
the `com.sjerred.MailMateCodeFill` subsystem:

```sh
/usr/bin/log stream --level info --style compact \
  --predicate 'subsystem == "com.sjerred.MailMateCodeFill" OR (process == "logger" AND eventMessage CONTAINS "event=bundle_helper")'
```

The app, MailMate bundle, helper, parser, App Group store, credential provider,
demo server, and release script report lifecycle, success/error outcomes,
record counts, and durations. The shell bundle uses the system `logger`
process, while native components use the CodeFill subsystem. Message IDs,
sender addresses, services, and other correlation values are hashed; email
bodies and subjects are never logged or persisted; short-lived OTP records are
stored in the App Group until use or expiry. The setup window includes **Open
Console logs** and **Copy diagnostics** actions for support reports.

## Local AutoFill test page

The offline demo page has an OTP field configured for native AutoFill. Start
it with Bun:

```sh
cd demo
bun run server.ts
```

Open `http://127.0.0.1:8788`, run the MailMate command on a selected
verification email, then focus the verification-code field and choose MailMate
CodeFill from AutoFill.
