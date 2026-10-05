/**
 * Partitioned COPY otherwise buffers 524,288 rows per thread and keeps up to
 * 100 output files open. Wide raw documents can exhaust the query budget
 * before those buffers flush. Flush at one DuckDB vector and bound the open
 * writers; these instance settings affect COPY, not report SELECT queries.
 */
export const PARQUET_WRITE_SETTINGS = {
  partitioned_write_flush_threshold: "2048",
  partitioned_write_max_open_files: "4",
};

/** Row-count limits alone cannot bound Parquet buffers for wide JSON rows. */
export const PARQUET_COPY_OPTIONS =
  "FORMAT PARQUET, ROW_GROUP_SIZE_BYTES '8MB'";
