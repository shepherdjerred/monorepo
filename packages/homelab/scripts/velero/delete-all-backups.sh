#!/bin/bash
# Script to delete ALL Velero backups from both the cluster and S3/R2 storage
# WARNING: This is destructive and cannot be undone!
# Uses velero CLI for cluster backups and AWS CLI for S3/R2 cleanup

set -e

# S3/R2 Configuration (matching cleanup-r2-bucket.sh)
BUCKET="homelab"
PREFIX_BACKUPS="torvalds/backups/"
PREFIX_ZFS="zfspv-incr/"
ENDPOINT="https://48948ed6cd40d73e34d27f0cc10e595f.r2.cloudflarestorage.com"
REGION="auto"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Velero Complete Backup Deletion Tool${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${RED}⚠️  WARNING: This will DELETE ALL Velero backups!${NC}"
echo -e "${RED}⚠️  This operation CANNOT be undone!${NC}"
echo ""

# Check if required tools are installed
echo -e "${CYAN}🔍 Checking required tools...${NC}"
for cmd in velero kubectl aws; do
  if ! command -v $cmd &> /dev/null; then
    echo -e "${RED}✗ Error: $cmd is not installed${NC}"
    exit 1
  fi
  echo -e "${GREEN}✓${NC} $cmd found"
done
echo ""

# Validate S3/R2 credentials
echo -e "${CYAN}🔐 Validating S3/R2 credentials...${NC}"
if ! aws s3 ls "s3://${BUCKET}/" \
  --endpoint-url "${ENDPOINT}" \
  --region "${REGION}" > /dev/null 2>&1; then
  echo -e "${RED}✗ Error: Failed to access S3/R2 bucket '${BUCKET}'${NC}"
  echo -e "${RED}  Check that AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are set correctly${NC}"
  echo -e "${YELLOW}  Hint: Get credentials from Velero secret:${NC}"
  echo -e "${YELLOW}    kubectl get secret -n velero cloud-credentials -o jsonpath='{.data.cloud}' | base64 -d${NC}"
  exit 1
fi
echo -e "${GREEN}✓${NC} S3/R2 credentials valid"
echo ""

# Get list of backups from cluster
echo -e "${CYAN}📋 Fetching list of backups from cluster...${NC}"
BACKUP_COUNT=$(velero backup get --output json 2>/dev/null | jq -r '.items | length' || echo "0")

if [ "$BACKUP_COUNT" -eq 0 ]; then
  echo -e "${YELLOW}⚠️  No backups found in cluster${NC}"
else
  echo -e "${GREEN}Found ${BACKUP_COUNT} backup(s) in cluster:${NC}"
  velero backup get
fi
echo ""

# Get list of files in S3/R2
echo -e "${CYAN}📋 Checking S3/R2 storage...${NC}"
BACKUP_FILES_COUNT=$(aws s3 ls "s3://${BUCKET}/${PREFIX_BACKUPS}" \
  --recursive \
  --endpoint-url "${ENDPOINT}" \
  --region "${REGION}" \
  2>/dev/null | wc -l || echo "0")

ZFS_FILES_COUNT=$(aws s3 ls "s3://${BUCKET}/${PREFIX_ZFS}" \
  --recursive \
  --endpoint-url "${ENDPOINT}" \
  --region "${REGION}" \
  2>/dev/null | wc -l || echo "0")

echo -e "${GREEN}Found ${BACKUP_FILES_COUNT} backup file(s) in S3${NC}"
echo -e "${GREEN}Found ${ZFS_FILES_COUNT} ZFS snapshot file(s) in S3${NC}"
echo ""

# Show what will be deleted
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}  DELETION SUMMARY${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo -e "${YELLOW}Will delete from cluster:${NC}"
echo -e "  • ${BACKUP_COUNT} Velero backup(s)"
echo ""
echo -e "${YELLOW}Will delete from S3/R2:${NC}"
echo -e "  • ${BACKUP_FILES_COUNT} backup file(s) in ${PREFIX_BACKUPS}"
echo -e "  • ${ZFS_FILES_COUNT} ZFS snapshot file(s) in ${PREFIX_ZFS}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Final confirmation
echo -e "${RED}⚠️  Type 'DELETE ALL BACKUPS' (exactly) to proceed:${NC}"
read -r confirmation

if [ "$confirmation" != "DELETE ALL BACKUPS" ]; then
  echo -e "${YELLOW}❌ Deletion cancelled${NC}"
  exit 0
fi

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Starting deletion process...${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Step 1: Delete backups from cluster using velero CLI
if [ "$BACKUP_COUNT" -gt 0 ]; then
  echo -e "${CYAN}🗑️  Step 1/3: Deleting backups from cluster...${NC}"

  # Get list of all backup names
  BACKUP_NAMES=$(velero backup get --output json 2>/dev/null | jq -r '.items[].metadata.name')

  if [ -n "$BACKUP_NAMES" ]; then
    echo -e "${YELLOW}Deleting backups one by one:${NC}"
    while IFS= read -r backup_name; do
      if [ -n "$backup_name" ]; then
        echo -e "  • Deleting ${backup_name}..."
        velero backup delete "$backup_name" --confirm
      fi
    done <<< "$BACKUP_NAMES"
    echo -e "${GREEN}✓ All cluster backups deleted${NC}"
  fi
else
  echo -e "${YELLOW}⊘ Step 1/3: No backups to delete from cluster${NC}"
fi
echo ""

# Step 2: Delete backup files from S3/R2
if [ "$BACKUP_FILES_COUNT" -gt 0 ]; then
  echo -e "${CYAN}🗑️  Step 2/3: Deleting backup files from S3/R2...${NC}"
  aws s3 rm "s3://${BUCKET}/${PREFIX_BACKUPS}" \
    --recursive \
    --endpoint-url "${ENDPOINT}" \
    --region "${REGION}"
  echo -e "${GREEN}✓ Backup files deleted from S3${NC}"
else
  echo -e "${YELLOW}⊘ Step 2/3: No backup files to delete from S3${NC}"
fi
echo ""

# Step 3: Delete ZFS snapshot files from S3/R2
if [ "$ZFS_FILES_COUNT" -gt 0 ]; then
  echo -e "${CYAN}🗑️  Step 3/3: Deleting ZFS snapshot files from S3/R2...${NC}"
  aws s3 rm "s3://${BUCKET}/${PREFIX_ZFS}" \
    --recursive \
    --endpoint-url "${ENDPOINT}" \
    --region "${REGION}"
  echo -e "${GREEN}✓ ZFS snapshot files deleted from S3${NC}"
else
  echo -e "${YELLOW}⊘ Step 3/3: No ZFS snapshot files to delete from S3${NC}"
fi
echo ""

# Verification
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}  Verifying deletion...${NC}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════${NC}"
echo ""

# Check cluster
echo -e "${CYAN}📊 Remaining backups in cluster:${NC}"
REMAINING_BACKUPS=$(velero backup get --output json 2>/dev/null | jq -r '.items | length' || echo "0")
if [ "$REMAINING_BACKUPS" -eq 0 ]; then
  echo -e "${GREEN}✓ No backups remaining in cluster${NC}"
else
  echo -e "${YELLOW}⚠️  Warning: ${REMAINING_BACKUPS} backup(s) still in cluster${NC}"
  velero backup get
fi
echo ""

# Check S3/R2
echo -e "${CYAN}📊 Remaining files in S3/R2:${NC}"
REMAINING_BACKUP_FILES=$(aws s3 ls "s3://${BUCKET}/${PREFIX_BACKUPS}" \
  --recursive \
  --endpoint-url "${ENDPOINT}" \
  --region "${REGION}" \
  2>/dev/null | wc -l || echo "0")

REMAINING_ZFS_FILES=$(aws s3 ls "s3://${BUCKET}/${PREFIX_ZFS}" \
  --recursive \
  --endpoint-url "${ENDPOINT}" \
  --region "${REGION}" \
  2>/dev/null | wc -l || echo "0")

if [ "$REMAINING_BACKUP_FILES" -eq 0 ]; then
  echo -e "${GREEN}✓ No backup files remaining in S3${NC}"
else
  echo -e "${YELLOW}⚠️  Warning: ${REMAINING_BACKUP_FILES} backup file(s) still in S3${NC}"
fi

if [ "$REMAINING_ZFS_FILES" -eq 0 ]; then
  echo -e "${GREEN}✓ No ZFS snapshot files remaining in S3${NC}"
else
  echo -e "${YELLOW}⚠️  Warning: ${REMAINING_ZFS_FILES} ZFS snapshot file(s) still in S3${NC}"
fi
echo ""

# Summary
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  ✅ Deletion Complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${GREEN}Deleted:${NC}"
echo -e "  • ${BACKUP_COUNT} cluster backup(s)"
echo -e "  • ${BACKUP_FILES_COUNT} S3 backup file(s)"
echo -e "  • ${ZFS_FILES_COUNT} S3 ZFS snapshot file(s)"
echo ""
echo -e "${CYAN}Note: Velero schedules are still active and will create new backups.${NC}"
echo -e "${CYAN}To stop future backups, delete or pause the schedules with:${NC}"
echo -e "${CYAN}  velero schedule get${NC}"
echo -e "${CYAN}  velero schedule delete <schedule-name>${NC}"
echo ""
