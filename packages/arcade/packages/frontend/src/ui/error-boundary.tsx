import { Component, type ErrorInfo, type ReactNode } from "react";

export class GameErrorBoundary extends Component<
  { readonly children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Arcade panel failed", error, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.failed ? (
      <main className="catalog">
        <h1>This game panel could not load.</h1>
        <p role="alert">
          Arcade received game data it could not display. Your game and save
          continue on the server.
        </p>
        <button
          onClick={() => {
            globalThis.location.reload();
          }}
        >
          Reload the panel
        </button>
        <a href="/">Back to Arcade</a>
      </main>
    ) : (
      this.props.children
    );
  }
}
