import {
  ArtworkFileSchema,
  ArtworkSizeSchema,
  artworkContentType,
  hasArtworkSignature,
  type ArtworkContentType,
  type ArtworkSize,
} from "#shared/artwork/proxy.ts";
import {
  boundedBytes,
  endpoint,
  IntegrationError,
  request,
  type FetchTransport,
} from "./http.ts";

const SERVICE = "tmdb-images";
/** Posters and backdrops at the served widths are tens to hundreds of KB. */
const MAXIMUM_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * The headers can arrive and the connection still drop, or the deadline pass,
 * while the image downloads. That is the CDN failing, like a refused request.
 */
async function body(response: Response): Promise<Uint8Array<ArrayBuffer>> {
  try {
    return await boundedBytes(response, MAXIMUM_IMAGE_BYTES, SERVICE);
  } catch (error) {
    if (error instanceof IntegrationError) throw error;
    throw new IntegrationError(SERVICE, "unavailable");
  }
}

export type TmdbImage =
  | {
      status: "found";
      bytes: Uint8Array<ArrayBuffer>;
      contentType: ArtworkContentType;
    }
  | { status: "missing" };

/**
 * The TMDB image CDN. The origin is fixed and the path is built only from an
 * allow-listed width and a validated file name, no credential is attached, and
 * a redirect is a failure, so a caller cannot steer the request elsewhere.
 */
export class TmdbImageClient {
  constructor(private readonly transport: FetchTransport = fetch) {}

  async image(size: ArtworkSize, file: string): Promise<TmdbImage> {
    const path = `${ArtworkSizeSchema.parse(size)}/${ArtworkFileSchema.parse(file)}`;
    const expected = artworkContentType(file);
    const response = await request(
      this.transport,
      SERVICE,
      endpoint("https://image.tmdb.org/t/p", path),
      { headers: { Accept: expected }, acceptedStatuses: [404] },
    );
    if (response.status === 404) {
      await response.body?.cancel();
      return { status: "missing" };
    }
    const declared = response.headers
      .get("content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    if (declared !== expected || response.status !== 200) {
      await response.body?.cancel();
      throw new IntegrationError(SERVICE, "invalid-response", response.status);
    }
    const bytes = await body(response);
    if (!hasArtworkSignature(expected, bytes))
      throw new IntegrationError(SERVICE, "invalid-response", response.status);
    return { status: "found", bytes, contentType: expected };
  }
}
