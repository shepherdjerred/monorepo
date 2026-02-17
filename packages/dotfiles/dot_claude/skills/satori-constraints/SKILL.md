---
name: satori-constraints
description: |
  Satori library constraints for JSX-to-SVG rendering and OG image generation.
  Use when working with report package, image generation, satori, resvg,
  CSS styling for images, or font loading.
---

# Satori Constraints Reference

Comprehensive reference for Satori's limitations and best practices when generating images from JSX.

## Overview

Satori is Vercel's library that converts HTML/CSS (or JSX) to SVG. It's used for generating OG images, social cards, and report images. This project uses Satori in the `@scout-for-lol/report` package with `@resvg/resvg-js` for SVG-to-PNG conversion.

---

## Layout Engine

### Flexbox-Based (Yoga)

Satori uses **Yoga** (the same layout engine as React Native), not browser CSS:

- **Only flexbox layout is supported** - no CSS Grid, no `float`, no `position: absolute` outside flex containers
- Every element with children must use `display: flex` explicitly
- Default flex direction is `row` (like React Native, unlike CSS default of `block`)

### Key Differences from Browser CSS

| Feature                | Satori                  | Browser CSS                     |
| ---------------------- | ----------------------- | ------------------------------- |
| Default display        | `flex`                  | `block`                         |
| Default flex-direction | `row`                   | `row`                           |
| `position: absolute`   | Relative to flex parent | Relative to positioned ancestor |
| `z-index`              | Not supported           | Supported                       |
| 3D transforms          | Not supported           | Supported                       |

---

## Supported CSS Properties

### Layout Properties

- `display` (only `flex` and `none`)
- `position` (`relative`, `absolute`)
- `top`, `right`, `bottom`, `left`
- `margin`, `padding` (all variants)
- `width`, `height`, `min-*`, `max-*`
- `flex`, `flex-grow`, `flex-shrink`, `flex-basis`
- `flex-direction`, `flex-wrap`
- `align-items`, `align-self`, `align-content`
- `justify-content`
- `gap`
- `overflow` (`hidden`, `visible`)

### Visual Properties

- `color`
- `background`, `background-color`, `background-image`
- `border`, `border-radius`
- `box-shadow`
- `opacity`

### Typography

- `font-family`, `font-size`, `font-weight`, `font-style`
- `line-height`
- `letter-spacing`
- `text-align`
- `text-decoration`
- `text-transform`
- `white-space`
- `word-break`
- `text-overflow`

### NOT Supported

- `z-index` - elements render in DOM order
- `transform` with 3D functions (`rotateX`, `translateZ`, etc.)
- `animation`, `transition`
- `cursor`
- `filter` (partial support)
- Advanced typography (kerning, ligatures, OpenType features)
- RTL text direction
- CSS Grid
- `float`
- `::before`, `::after` pseudo-elements
- Media queries
- CSS variables

---

## Font Requirements

### Supported Formats

| Format | Supported | Notes                                  |
| ------ | --------- | -------------------------------------- |
| TTF    | Yes       | Recommended for server-side            |
| OTF    | Yes       | Recommended for server-side            |
| WOFF   | Yes       | Good balance of size/speed             |
| WOFF2  | **No**    | Not supported (opentype.js limitation) |

### Loading Fonts

Fonts must be passed as `ArrayBuffer` (browser) or `Buffer` (Node.js):

```typescript
import satori from 'satori';

const fontData = await Bun.file('./fonts/Inter-Regular.ttf').arrayBuffer();

const svg = await satori(
  <div style={{ fontFamily: 'Inter' }}>Hello</div>,
  {
    width: 1200,
    height: 630,
    fonts: [
      {
        name: 'Inter',
        data: fontData,
        weight: 400,
        style: 'normal',
      },
    ],
  }
);
```

### Best Practices

1. **Define fonts globally** - don't create new font objects per render
2. **Use TTF/OTF on server** - faster to parse than WOFF
3. **Multiple weights** - pass each weight as separate font entry
4. **Fallback fonts** - provide fallbacks for missing characters

---

## Image Handling

### Image Requirements

```tsx
// REQUIRED: width and height for external URLs
<img
  src="https://example.com/image.png"
  width={100}
  height={100}
/>

// RECOMMENDED: base64 for best performance
<img
  src="data:image/png;base64,iVBORw0KGgoAAAANS..."
  width={100}
  height={100}
/>
```

### Image Best Practices

1. **Use base64** - avoids extra network requests during rendering
2. **Always set dimensions** - `width` and `height` are required for external URLs
3. **Fetch and convert** - for dynamic images, fetch then convert to base64:

```typescript
async function imageToBase64(url: string): Promise<string> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const mimeType = response.headers.get("content-type") || "image/png";
  return `data:${mimeType};base64,${base64}`;
}
```

### Background Images

```tsx
<div
  style={{
    backgroundImage: "url(data:image/png;base64,...)",
    backgroundSize: "cover",
    backgroundPosition: "center",
  }}
/>
```

---

## Emoji Support

Satori supports emoji through dynamic loading:

### Using `graphemeImages`

```typescript
const svg = await satori(
  <div>Hello World! </div>,
  {
    width: 600,
    height: 400,
    fonts: [...],
    graphemeImages: {
      '': 'https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/svg/1f44b.svg',
    },
  }
);
```

### Using `loadAdditionalAsset`

```typescript
const svg = await satori(element, {
  width: 1200,
  height: 630,
  fonts: [...],
  loadAdditionalAsset: async (code, segment) => {
    if (code === 'emoji') {
      // Fetch Twemoji SVG and return as data URL
      const emojiCode = getEmojiCodePoint(segment);
      const response = await fetch(
        `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/${emojiCode}.svg`
      );
      const svg = await response.text();
      return `data:image/svg+xml;base64,${btoa(svg)}`;
    }
    return null;
  },
});
```

---

## Known Issues & Workarounds

### Transparent Gradients Render as Black

**Bug:** `linear-gradient(transparent, white)` renders as dark gray to white.

**Workaround:** Use `rgba(255, 255, 255, 0)` instead of `transparent`:

```tsx
backgroundImage: "linear-gradient(rgba(255, 255, 255, 0), white)";
```

### No z-index Support

**Issue:** Elements render in DOM order, no z-index control.

**Workaround:** Order elements correctly in JSX (later elements render on top).

### Text Overflow

**Issue:** Long text may overflow containers unexpectedly.

**Workaround:** Always set `overflow: hidden` and use `text-overflow: ellipsis`:

```tsx
<div
  style={{
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maxWidth: 400,
  }}
>
  Long text that might overflow...
</div>
```

### Inconsistent Font Metrics

**Issue:** Text positioning may differ slightly from browser rendering.

**Workaround:** Test with actual fonts, add padding for safety margins.

---

## SVG to PNG Conversion

### Using @resvg/resvg-js

```typescript
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";

// Generate SVG with Satori
const svg = await satori(element, options);

// Convert to PNG
const resvg = new Resvg(svg, {
  fitTo: {
    mode: "width",
    value: 1200,
  },
});
const pngData = resvg.render();
const pngBuffer = pngData.asPng();
```

### Performance Tips

1. **Lazy load** - import satori and resvg only when needed
2. **Cache fonts** - load fonts once at startup
3. **Reuse Resvg instances** - when generating many images
4. **Set appropriate dimensions** - larger images = longer render time

---

## Common Patterns

### OG Image Template

```tsx
const OGImage = ({ title, description }: Props) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 60,
      backgroundColor: "#1a1a2e",
      color: "white",
      fontFamily: "Inter",
    }}
  >
    <div
      style={{
        display: "flex",
        fontSize: 64,
        fontWeight: 700,
        marginBottom: 20,
      }}
    >
      {title}
    </div>
    <div
      style={{
        display: "flex",
        fontSize: 32,
        color: "#a0a0a0",
      }}
    >
      {description}
    </div>
  </div>
);

const svg = await satori(<OGImage title="Hello" description="World" />, {
  width: 1200,
  height: 630,
  fonts: [{ name: "Inter", data: fontData, weight: 400, style: "normal" }],
});
```

### Debugging Layout

When layout isn't working as expected:

1. Add `border: '1px solid red'` to containers
2. Check that all containers have `display: 'flex'`
3. Verify flex direction (default is `row`)
4. Check for missing dimensions on images

---

## Sources

- [Satori GitHub Repository](https://github.com/vercel/satori)
- [Satori README](https://github.com/vercel/satori/blob/main/README.md)
- [Vercel OG Image Generation Docs](https://vercel.com/docs/og-image-generation)
- [Vercel Blog - Introducing OG Image Generation](https://vercel.com/blog/introducing-vercel-og-image-generation-fast-dynamic-social-card-images)
- [Satori NPM Package](https://www.npmjs.com/package/satori)
- [Satori DeepWiki](https://deepwiki.com/vercel/satori)
- [Next.js ImageResponse](https://nextjs.org/docs/app/api-reference/functions/image-response)
- [WOFF2 Support Discussion](https://github.com/vercel/satori/discussions/157)
- [Image Handling Issue](https://github.com/vercel/satori/issues/87)
- [Emoji Support Issue](https://github.com/vercel/satori/issues/1)
- [Gradient Bug](https://github.com/vercel/satori/issues/594)
- [Resvg-js GitHub](https://github.com/thx/resvg-js)
- [Generate Images with Satori and Resvg](https://dev.to/anasrin/generate-image-from-html-using-satori-and-resvg-46j6)
- [Implement Emojis in Satori](https://dev.to/opensauced/how-to-implement-emojis-in-vercelsatori-2no5)
- [Satori Fit Text](https://alan.norbauer.com/articles/satori-fit-text/)
