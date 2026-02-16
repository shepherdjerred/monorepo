#!/usr/bin/env bash
set -euo pipefail

ENDPOINT="${SEAWEEDFS_ENDPOINT:-https://seaweedfs.sjer.red}"
BUCKET="sccache"
EXPIRE_DAYS=30

echo "Setting up sccache bucket at ${ENDPOINT}"

# Create bucket (ignore error if already exists)
if aws s3 mb "s3://${BUCKET}" --endpoint-url="${ENDPOINT}" 2>/dev/null; then
  echo "Created bucket: ${BUCKET}"
else
  echo "Bucket ${BUCKET} already exists"
fi

# Apply lifecycle policy for automatic expiration
aws s3api put-bucket-lifecycle-configuration \
  --bucket "${BUCKET}" \
  --endpoint-url="${ENDPOINT}" \
  --lifecycle-configuration '{
    "Rules": [{
      "ID": "expire-cache-objects",
      "Status": "Enabled",
      "Filter": {"Prefix": ""},
      "Expiration": {"Days": '"${EXPIRE_DAYS}"'}
    }]
  }'

echo "Applied ${EXPIRE_DAYS}-day expiration lifecycle policy"

# Verify
echo ""
echo "Bucket lifecycle configuration:"
aws s3api get-bucket-lifecycle-configuration \
  --bucket "${BUCKET}" \
  --endpoint-url="${ENDPOINT}"
