import { describe, it, expect } from "bun:test";

describe("smartmon.sh script", () => {
  const scriptPath = `${import.meta.dir}/smartmon.sh`;

  const nvmeOutput = `
SMART/Health Information (NVMe Log 0x02, NSID 0xffffffff)
Critical Warning:                   0x00
Temperature:                        46 Celsius
Available Spare:                    100%
Available Spare Threshold:          10%
Percentage Used:                    10%
Data Units Read:                    40,053,375 [20.5 TB]
Data Units Written:                 157,573,734 [80.6 TB]
Host Read Commands:                 989,363,207
Host Write Commands:                3,825,304,428
Controller Busy Time:               25,137
Power Cycles:                       67
Power On Hours:                     9,888
Unsafe Shutdowns:                   35
Media and Data Integrity Errors:    0
Error Information Log Entries:      0
Warning  Comp. Temperature Time:    0
Critical Comp. Temperature Time:    0
Temperature Sensor 1:               46 Celsius
Temperature Sensor 2:               57 Celsius
  `;

  const satOutput = `
ID# ATTRIBUTE_NAME          FLAG     VALUE WORST THRESH TYPE      UPDATED  WHEN_FAILED RAW_VALUE
  1 Raw_Read_Error_Rate     0x000f   078   055   006    Pre-fail  Always       -       64166384
  9 Power_On_Hours          0x0032   031   031   000    Old_age   Always       -       61290
 12 Power_Cycle_Count       0x0032   100   100   020    Old_age   Always       -       376
194 Temperature_Celsius     0x0022   038   047   000    Old_age   Always       -       38
  `;

  it("should correctly parse NVMe drive attributes", async () => {
    // We need to call the specific parsing function.
    // This requires refactoring the script to allow calling functions directly
    // or sourcing it and calling the functions. For now, let's prepare the test case.
    const command = `bash -c "source ${scriptPath}; parse_smartctl_nvme_attributes /dev/nvme0 nvme"`;
    const proc = Bun.spawn(["bash", "-c", command], {
      stdout: "pipe",
      stdin: "pipe",
    });
    proc.stdin.write(nvmeOutput);
    await proc.stdin.end();
    const result = await new Response(proc.stdout).text();

    expect(result).toContain('temperature_celsius_value{disk="/dev/nvme0",type="nvme",smart_id="194"} 46');
    expect(result).toContain('percentage_used_raw_value{disk="/dev/nvme0",type="nvme",smart_id="N/A"} 10');
    expect(result).toContain('power_cycle_count_raw_value{disk="/dev/nvme0",type="nvme",smart_id="12"} 67');
    expect(result).toContain('power_on_hours_raw_value{disk="/dev/nvme0",type="nvme",smart_id="9"} 9888');
    expect(result).toContain('unsafe_shutdown_count_raw_value{disk="/dev/nvme0",type="nvme",smart_id="174"} 35');
    expect(result).toContain('offline_uncorrectable_raw_value{disk="/dev/nvme0",type="nvme",smart_id="198"} 0');
  });

  it("should correctly parse SATA drive attributes", async () => {
    const command = `bash -c "source ${scriptPath}; parse_smartctl_attributes /dev/sda sat"`;
    const proc = Bun.spawn(["bash", "-c", command], {
      stdout: "pipe",
      stdin: "pipe",
    });
    proc.stdin.write(satOutput);
    await proc.stdin.end();
    const result = await new Response(proc.stdout).text();

    expect(result).toContain('raw_read_error_rate_raw_value{disk="/dev/sda",type="sat",smart_id="1"} 6.416638e+07');
    expect(result).toContain('power_on_hours_raw_value{disk="/dev/sda",type="sat",smart_id="9"} 6.129000e+04');
    expect(result).toContain('power_cycle_count_raw_value{disk="/dev/sda",type="sat",smart_id="12"} 3.760000e+02');
    expect(result).toContain('temperature_celsius_raw_value{disk="/dev/sda",type="sat",smart_id="194"} 3.800000e+01');
  });
});
