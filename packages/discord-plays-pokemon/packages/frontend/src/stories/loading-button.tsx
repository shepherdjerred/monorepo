import { Button } from "./button.tsx";
import { LoadingSpinner } from "./loading-spinner.tsx";

export function LoadingButton() {
  return (
    <Button disabled>
      <LoadingSpinner width={20} height={20} border={1} />
    </Button>
  );
}
