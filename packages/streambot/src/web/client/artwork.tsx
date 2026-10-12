import { useState } from "react";

/** Decorative artwork has a stable footprint; missing external images keep the title readable. */
export function Artwork({
  url,
  className = "",
}: {
  url?: string;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  return (
    <span className={"media-artwork " + className} aria-hidden="true">
      <span>▷</span>
      {url !== undefined && failedUrl !== url && (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => {
            setFailedUrl(url);
          }}
        />
      )}
    </span>
  );
}
