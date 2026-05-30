import { findRegion, REGIONS, type RegionValue } from "#src/lib/regions.ts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#src/components/ui/select.tsx";

type Props = {
  id: string;
  value: RegionValue;
  onValueChange: (value: RegionValue) => void;
};

export function RegionSelect(props: Props) {
  return (
    <Select
      value={props.value}
      onValueChange={(next) => {
        const region = findRegion(next);
        if (region !== null) props.onValueChange(region);
      }}
      required
    >
      <SelectTrigger id={props.id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {REGIONS.map((region) => (
          <SelectItem key={region.value} value={region.value}>
            {region.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
