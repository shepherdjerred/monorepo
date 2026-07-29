import { useEffect } from "react";

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = `${title} | Scout Review Evals`;
  }, [title]);
}
