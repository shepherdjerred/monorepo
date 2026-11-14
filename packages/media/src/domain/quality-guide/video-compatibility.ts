type DolbyVisionRecord = {
  side_data_type?: string | undefined;
  dv_profile?: number | undefined;
  bl_present_flag?: number | undefined;
  dv_bl_signal_compatibility_id?: number | undefined;
};

/** A nonzero signaled compatible base layer is required for a non-DV display.
 * Unknown Dolby Vision signaling is protected rather than inferred from a title. */
export function videoCompatibility(
  records: readonly DolbyVisionRecord[],
): "compatible" | "incompatible" | "unknown" {
  const dolby = records.filter(
    (record) =>
      record.dv_profile !== undefined ||
      record.side_data_type === "DOVI configuration record",
  );
  if (dolby.length === 0) return "compatible";
  if (
    dolby.some(
      (record) =>
        record.dv_bl_signal_compatibility_id === 0 ||
        record.bl_present_flag === 0,
    )
  )
    return "incompatible";
  return dolby.every(
    (record) =>
      record.bl_present_flag === 1 &&
      record.dv_bl_signal_compatibility_id !== undefined &&
      record.dv_bl_signal_compatibility_id > 0,
  )
    ? "compatible"
    : "unknown";
}
