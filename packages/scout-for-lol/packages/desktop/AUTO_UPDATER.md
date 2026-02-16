# Auto-Updater Configuration

The desktop application includes Tauri's built-in auto-updater for seamless updates.

## Setup for Production

### 1. Generate Update Keys

First, generate a keypair for signing updates:

```bash
bunx tauri signer generate -w ~/.tauri/scout-for-lol.key
```

This creates:

- **Private key**: `~/.tauri/scout-for-lol.key` (keep secret!)
- **Public key**: Printed to console (add to `tauri.conf.json`)

### 2. Configure Public Key

Update `src-tauri/tauri.conf.json`:

```json
{
  "plugins": {
    "updater": {
      "active": true,
      "dialog": true,
      "pubkey": "YOUR_PUBLIC_KEY_HERE",
      "endpoints": ["https://releases.myserver.com/{{target}}/{{current_version}}"]
    }
  }
}
```

### 3. Build Signed Releases

When building for release:

```bash
# Set the private key path
export TAURI_SIGNING_PRIVATE_KEY=$(cat ~/.tauri/scout-for-lol.key)
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""  # If you set a password

# Build with signing
bun run build
```

This generates:

- Application installer (`.msi`, `.dmg`, `.AppImage`)
- Update manifest (`.json`)
- Signature file (`.sig`)

### 4. Host Update Files

Upload these files to your update server:

```text
https://releases.myserver.com/
├── windows-x86_64/
│   ├── 0.1.0/
│   │   ├── scout-for-lol_0.1.0_x64_en-US.msi
│   │   ├── scout-for-lol_0.1.0_x64_en-US.msi.json
│   │   └── scout-for-lol_0.1.0_x64_en-US.msi.sig
│   └── 0.2.0/
│       └── ...
├── darwin-x86_64/
│   └── ...
└── linux-x86_64/
    └── ...
```

### 5. Update Manifest Format

The `.json` file should contain:

```json
{
  "version": "0.2.0",
  "notes": "- New features\n- Bug fixes",
  "pub_date": "2024-01-15T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "BASE64_SIGNATURE",
      "url": "https://releases.myserver.com/windows-x86_64/0.2.0/scout-for-lol_0.2.0_x64_en-US.msi"
    },
    "darwin-x86_64": {
      "signature": "BASE64_SIGNATURE",
      "url": "https://releases.myserver.com/darwin-x86_64/0.2.0/scout-for-lol_0.2.0_x64.dmg"
    }
  }
}
```

## How It Works

1. **On Launch**: App checks the update endpoint for new versions
2. **If Available**: Shows a dialog to the user
3. **User Accepts**: Downloads and verifies the update (signature check)
4. **Install**: Prompts to restart and install

## Development

During development, the updater is disabled by default. To test:

1. Build a signed release
2. Host it on a local server
3. Update `endpoints` in `tauri.conf.json` to point to your local server
4. Run the app

## Security

- **Private key**: Never commit or share your private key
- **HTTPS only**: Always serve updates over HTTPS
- **Signature verification**: Tauri verifies all updates before installing
- **Code signing**: Sign your installers for Windows/macOS trust

## Environment Variables

```bash
# Required for signing
TAURI_SIGNING_PRIVATE_KEY=<base64-encoded-private-key>
TAURI_SIGNING_PRIVATE_KEY_PASSWORD=<optional-password>

# Optional: Custom update server
TAURI_UPDATER_ENDPOINT=https://custom-server.com/updates
```

## GitHub Releases (Alternative)

For simpler setup, use GitHub Releases:

```json
{
  "plugins": {
    "updater": {
      "endpoints": ["https://github.com/shepherdjerred/scout-for-lol/releases/latest/download/latest.json"]
    }
  }
}
```

Upload your `.json`, `.sig`, and installer files to GitHub Releases.

## Troubleshooting

### Update Not Found

- Check endpoint URL is correct
- Verify files are accessible via HTTPS
- Check version number formatting

### Signature Verification Failed

- Ensure public key in `tauri.conf.json` matches private key
- Verify `.sig` file was generated correctly
- Check file wasn't corrupted during upload

### Update Dialog Not Showing

- Check `dialog: true` in config
- Verify `active: true` in config
- Check logs for errors

## References

- [Tauri Updater Documentation](https://v2.tauri.app/plugin/updater/)
- [Tauri Signing Guide](https://v2.tauri.app/distribute/sign/)
- [Update Server Setup](https://v2.tauri.app/plugin/updater/#update-server)
