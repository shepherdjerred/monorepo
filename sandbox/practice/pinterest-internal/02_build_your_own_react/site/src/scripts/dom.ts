export function required(element: ParentNode, selector: string): HTMLElement {
  const result = element.querySelector<HTMLElement>(selector);
  if (result === null) throw new Error(`Missing reader element: ${selector}`);
  return result;
}
