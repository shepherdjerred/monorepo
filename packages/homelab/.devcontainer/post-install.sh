#!/bin/bash

# Install velero and kubectl with homebrew
brew install velero kubectl

# Trust mise configuration
mise trust

# Configure AWS CLI for Cloudflare R2 (S3-compatible)
# Note: You'll need to set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from 1Password
export AWS_S3_ENDPOINT=https://48948ed6cd40d73e34d27f0cc10e595f.r2.cloudflarestorage.com
export AWS_DEFAULT_REGION=auto

# Create velero CLI config directory
mkdir -p ~/.config/velero

cat > ~/.config/velero/config.json <<EOF
{
  "backupStorageLocation": {
    "bucket": "homelab",
    "prefix": "torvalds/backups/",
    "provider": "aws",
    "config": {
      "region": "auto",
      "s3Url": "https://48948ed6cd40d73e34d27f0cc10e595f.r2.cloudflarestorage.com"
    }
  }
}
EOF

bun install

echo "✓ Velero installed and S3 configured for Cloudflare R2"
echo "Note: Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY from 1Password to use velero CLI"
