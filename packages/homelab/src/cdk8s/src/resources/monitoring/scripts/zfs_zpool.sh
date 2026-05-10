#!/usr/bin/env bash
#
# Script to give information about zpools and zfs datasets
# Author: Brian Candler <b.candler@pobox.com>
#
# NOTE: zpool metrics requires zpool list -p
# (zfsonlinux 0.7.5 OK, 0.6.5.6 not OK)

set -eu

# which dataset types to show
DATASET_TYPES="filesystem,volume"
# metric name prefixes
ZPOOL="zfs_zpool"
DATASET="zfs_dataset"
# label names
ZPOOL_NAME="zpool_name"
DATASET_NAME="dataset_name"
DATASET_TYPE="dataset_type"

IFS=$'\t'

### zpool metadata ###

echo "# HELP ${ZPOOL} Constant metric with metadata about the zpool"
echo "# TYPE ${ZPOOL} gauge"
zpool list -H -o name,health,version,readonly,ashift,autoreplace,failmode |
while read -r name health version readonly ashift autoreplace failmode; do
  echo "${ZPOOL}{${ZPOOL_NAME}=\"$name\",health=\"$health\",version=\"$version\",readonly=\"$readonly\",ashift=\"$ashift\",autoreplace=\"$autoreplace\",failmode=\"$failmode\"} 1"
done

### zpool metrics ###

zpool_info="$(zpool list -Hp -o name,size,free,freeing,dedupratio,fragmentation 2>/dev/null)" &&
[ -n "$zpool_info" ] &&
while read -r col metric help; do
  echo "# HELP ${ZPOOL}_${metric} ${help}"
  echo "# TYPE ${ZPOOL}_${metric} gauge"
  while read -r -a line; do
    echo "${ZPOOL}_${metric}{${ZPOOL_NAME}=\"${line[0]}\"} ${line[$col]/%-/0}"
  done <<<"$zpool_info"
done <<<$'1\tsize_bytes\tTotal size of the storage pool
2\tfree_bytes\tThe amount of free space available in the pool
3\tfreeing_bytes\tThe amount of space waiting to be reclaimed from destroyed filesystems or snapshots
4\tdedupratio\tThe deduplication ratio
5\tfragmentation\tThe amount of fragmentation in the pool'

### zpool scan / scrub metrics ###

# Month name to zero-padded number lookup. Using a function instead of
# `declare -A` because (a) associative-array subscripts crash under `set -u`
# when the key is empty, and (b) arrays don't survive pipe subshells.
month_to_num() {
  case "${1:-}" in
    Jan) echo 01 ;; Feb) echo 02 ;; Mar) echo 03 ;; Apr) echo 04 ;;
    May) echo 05 ;; Jun) echo 06 ;; Jul) echo 07 ;; Aug) echo 08 ;;
    Sep) echo 09 ;; Oct) echo 10 ;; Nov) echo 11 ;; Dec) echo 12 ;;
    *) echo 01 ;;
  esac
}

echo "# HELP ${ZPOOL}_scan_state Current scan state: 0=idle/none, 1=scrub in progress, 2=resilver in progress"
echo "# TYPE ${ZPOOL}_scan_state gauge"
echo "# HELP ${ZPOOL}_last_scrub_completion_timestamp Unix timestamp of the last completed scrub (0 if never)"
echo "# TYPE ${ZPOOL}_last_scrub_completion_timestamp gauge"

# Read the pool list into a temp file and iterate from there. We avoid both
# `done < <(...)` (process substitution needs /dev/fd/N which isn't available
# in this Alpine container) and `zpool list | while` (the associative array
# MONTH_NUM doesn't survive the pipe subshell, so `${MONTH_NUM[$month]:-01}`
# crashes with "bad array subscript" under set -eu).
POOL_LIST_FILE=$(mktemp)
zpool list -H -o name >"$POOL_LIST_FILE"
while IFS= read -r pool; do
  scan_line=$(zpool status "$pool" 2>/dev/null | grep -E "^\s+scan:" | head -1)

  if echo "$scan_line" | grep -q "scrub in progress"; then
    state=1
  elif echo "$scan_line" | grep -q "resilver in progress"; then
    state=2
  else
    state=0
  fi
  echo "${ZPOOL}_scan_state{${ZPOOL_NAME}=\"$pool\"} $state"

  # Parse completed scrub timestamp from lines like:
  #   scan: scrub repaired 0B in 01:27:52 with 0 errors on Sun Apr 21 03:29:00 2024
  ts=0
  if echo "$scan_line" | grep -qE "errors on [A-Z][a-z]{2} [A-Z][a-z]{2}"; then
    date_part=$(echo "$scan_line" | grep -oE "[A-Z][a-z]{2} [A-Z][a-z]{2} +[0-9]+ [0-9]{2}:[0-9]{2}:[0-9]{2} [0-9]{4}")
    if [ -n "$date_part" ]; then
      # Override the script-wide IFS=$'\t' for this read so we split the
      # date string on whitespace into 5 fields (day-of-week, month, day,
      # time, year) instead of treating the whole thing as a single tab-
      # separated field.
      IFS=' ' read -r _ month day time year <<<"$date_part"
      mon=$(month_to_num "$month")
      day=$(printf "%02d" "$day")
      ts=$(date -d "${year}-${mon}-${day} ${time}" +%s 2>/dev/null || echo 0)
    fi
  fi
  echo "${ZPOOL}_last_scrub_completion_timestamp{${ZPOOL_NAME}=\"$pool\"} $ts"
done <"$POOL_LIST_FILE"
rm -f "$POOL_LIST_FILE"

### dataset metadata ###

echo "# HELP ${DATASET} Constant metric with metadata about the zfs dataset"
echo "# TYPE ${DATASET} gauge"
zfs list -Hp -t $DATASET_TYPES -o name,type,creation,mounted,mountpoint,checksum,compression,readonly,version,dedup,volblocksize |
while read -r name type creation mounted mountpoint checksum compression readonly version dedup volblocksize; do
  echo "${DATASET}{$DATASET_NAME=\"$name\",$DATASET_TYPE=\"$type\",creation=\"$creation\",mounted=\"$mounted\",mountpoint=\"$mountpoint\",checksum=\"$checksum\",compression=\"$compression\",readonly=\"$readonly\",version=\"$version\",dedup=\"$dedup\",volblocksize=\"$volblocksize\"} 1"
done

### dataset metrics ###

dataset_info="$(zfs list -Hp -t $DATASET_TYPES -o name,used,available,referenced,compressratio,reservation,refreservation,volsize)" &&
[ -n "$dataset_info" ] &&
while read -r col metric help; do
  echo "# HELP ${DATASET}_${metric} ${help}"
  echo "# TYPE ${DATASET}_${metric} gauge"
  while read -r -a line; do
    # change "-" to "0", and "1.43x" to "1.430"
    echo "${DATASET}_${metric}{${DATASET_NAME}=\"${line[0]}\"} ${line[$col]/%[x-]/0}"
  done <<<"$dataset_info"
done <<<$'1\tused_bytes\tThe amount of space consumed by this dataset and all its descendents
2\tavailable_bytes\tThe amount of space available to the dataset and all its children
3\treferenced_bytes\tThe amount of data that is accessible by this dataset, which may or may not be shared with other datasets in the pool
4\tcompressratio\tFor non-snapshots, the compression ratio achieved for the used space of this dataset, expressed as a multiplier
5\treservation_bytes\tThe minimum amount of space guaranteed to a dataset and its descendants
6\trefreservation_bytes\tThe minimum amount of space guaranteed to a dataset, not including its descendents
7\tvolsize_bytes\tFor volumes, specifies the logical size of the volume'
