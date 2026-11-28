/** Small readers over a pending response, so tests never chain off `await`. */
export async function statusOf(pending: Promise<Response>): Promise<number> {
  const response = await pending;
  return response.status;
}

export async function textOf(pending: Promise<Response>): Promise<string> {
  const response = await pending;
  return response.text();
}

export async function jsonOf(pending: Promise<Response>): Promise<unknown> {
  const response = await pending;
  return response.json();
}

export async function headerOf(
  pending: Promise<Response>,
  name: string,
): Promise<string | null> {
  const response = await pending;
  return response.headers.get(name);
}
