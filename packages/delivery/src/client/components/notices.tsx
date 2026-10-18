import { DeliveryClientError } from "#shared/client.ts";

export function errorMessage(error: unknown) {
  if (error instanceof DeliveryClientError)
    return `${error.message} (${error.code})`;
  return error instanceof Error ? error.message : String(error);
}

export function ErrorNotice({ error }: { error: unknown }) {
  return (
    <div className="notice error" role="alert">
      {errorMessage(error)}
    </div>
  );
}

export function Empty({ children }: { children: string }) {
  return <p className="empty">{children}</p>;
}
