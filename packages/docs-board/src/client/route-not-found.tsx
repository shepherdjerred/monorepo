import { useNavigate } from "react-router-dom";

import { Button } from "#components/ui/button";

export function RouteNotFound(): React.JSX.Element {
  const navigate = useNavigate();
  return (
    <main className="grid min-h-svh place-items-center p-6 text-center">
      <div>
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="mt-2 text-2xl font-semibold">Page not found</h1>
        <Button className="mt-5" onClick={() => void navigate("/")}>
          Return to the board
        </Button>
      </div>
    </main>
  );
}
