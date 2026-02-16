import { Button } from "./Button";
import { LoadingSpinner } from "./LoadingSpinner";

export function LoadingButton() {
  return (
    <Button disabled>
      <LoadingSpinner width={20} height={20} border={1} />
    </Button>
  );
}
