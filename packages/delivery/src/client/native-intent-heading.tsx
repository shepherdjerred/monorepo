import { Status } from "./components.tsx";

export function NativeIntentHeading({
  intent,
}: {
  intent: {
    id: string;
    status: string;
    reason: string;
    message: string | null;
  };
}) {
  return (
    <>
      <div className="section-heading">
        <strong className="mono">{intent.id}</strong>
        <Status value={intent.status} />
      </div>
      <p>{intent.reason}</p>
      {intent.message !== null && <p>{intent.message}</p>}
    </>
  );
}
