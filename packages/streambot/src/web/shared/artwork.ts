export const ARTWORK_HOSTS: readonly string[] = [
  "image.tmdb.org",
  "i.ytimg.com",
  "img.youtube.com",
];

/** Only public image CDNs supported by our metadata producers may reach the browser. */
export function isRemoteArtworkUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      ARTWORK_HOSTS.includes(url.hostname)
    );
  } catch {
    return false;
  }
}
