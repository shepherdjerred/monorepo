type DocumentPageModule = {
  default: () => React.JSX.Element;
};

export async function loadDocumentPage(): Promise<DocumentPageModule> {
  const module = await import("./document-page.tsx");
  return { default: module.DocumentPage };
}
