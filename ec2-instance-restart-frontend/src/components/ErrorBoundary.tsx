import React from "react";

export interface ErrorBoundaryProps {
  children: React.ReactElement;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static getDerivedStateFromError(error: ErrorBoundaryState): ErrorBoundaryState {
    return { hasError: true };
  }

  render(): React.ReactElement {
    if (this.state.hasError) {
      return (
        <>
          <h1 className="title">Something went wrong.</h1>
          <h2 className="subtitle">Reload the page and try again.</h2>
        </>
      );
    }

    return this.props.children;
  }
}
