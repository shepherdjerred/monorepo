<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cdn.rawgit.com/shepherdjerred/astro-opengraph-images/main/assets/logo-dark.png">
    <source media="(prefers-color-scheme: light)" srcset="https://cdn.rawgit.com/shepherdjerred/astro-opengraph-images/main/assets/logo-light.png">
    <img alt="project logo" src="https://cdn.rawgit.com/shepherdjerred/astro-opengraph-images/main/assets/logo-light.png" height=75>
  </picture>

[![astro-opengraph-images](https://img.shields.io/npm/v/astro-opengraph-images.svg)](https://www.npmjs.com/package/astro-opengraph-images)

Generate Open Graph images for your Astro site.

This project is actively maintained. If you have a feature request or need help, please [create an issue](https://github.com/shepherdjerred/astro-opengraph-images/issues/new).

</div>

## What is Open Graph?

[Open Graph](https://ogp.me/) is a protocol created by Facebook. It allows pages on your site to be richly embedded into other sites and applications.

You've probably seen this in action when posting a link on Facebook, Twitter, Slack, iMessage, or Discord. Links posted in supported applications will display the Open Graph metadata which often includes an image. This library will generate those images for you.

## Features

> [!WARNING]
> This integration has only been tested with statically rendered sites. It is untested with server-side rendering.

- Written in TypeScript
- Generate Open Graph images for every page on your site.
- Use a preset renderer to get started quickly.
- Images are fully customizable using [Satori](https://github.com/vercel/satori).
- Use React/JSX + Tailwind syntax or vanilla JavaScript to define your own custom images.
- Supports both static pages and Astro content collections.
- Pages can be written in Markdown, MDX, HTML, or any other format.

## Quick Start

To better illustrate these steps, I've created a [video](https://www.loom.com/share/a66a65be8a4e48ec8612b78489db590d?sid=3e9f7cd6-68ec-49da-b942-75eb4608cb5e) following them to help others follow along.

1. Add this integration to your Astro config:

   - Option 1: use the `astro` command:

     ```bash
     npx astro add astro-opengraph-images
     ```

   - Option 2: install the package and add the integration to your Astro config:

     ```bash
     npm i astro-opengraph-images
     ```

     ```diff
     +import opengraphImages from "astro-opengraph-images";

     export default defineConfig({
       integrations: [
     +    opengraphImages()
       ],
     });
     ```

1. Install React. React is used by the presets, and can be used to easily author custom images. Note that React is only used for generating the images and will not be shipped to clients.

   ```bash
   npm i -D react
   ```

1. Install the fonts you want to use. Fonts must be explicitly declared to be used for images. System fonts are _not_ available. For this quick start guide, we'll install the [Roboto](https://fontsource.org/fonts/roboto) font:

   ```bash
   npm i @fontsource/roboto
   ```

   You can find more fonts on [Fontsource](https://fontsource.org/), or you can use any font file that you have. See [Satori's font documentation](https://github.com/vercel/satori?tab=readme-ov-file#fonts) for more information.

1. Configure the integration in your Astro config:

   ```diff
   -import opengraphImages from "astro-opengraph-images";
   +import opengraphImages, { presets } from "astro-opengraph-images";
   +import * as fs from "fs"; // The fs module is required to load fonts

   export default defineConfig({
     integrations: [
   -    opengraphImages()
   +    opengraphImages({
   +      options: {
   +        fonts: [
   +          {
   +            name: "Roboto",
   +            weight: 400,
   +            style: "normal",
   +            data: fs.readFileSync("node_modules/@fontsource/roboto/files/roboto-latin-400-normal.woff"),
   +          },
   +        ],
   +      },
   +      render: presets.blackAndWhite,
   +    }),
     ],
   });
   ```

1. Set the [`site`](https://docs.astro.build/en/reference/configuration-reference/#site) property in your Astro config:

   Open Graph requires URLs to be absolute, including the domain your site is hosted at. This integration uses the site defined in your Astro config to create the correct URLs for Open Graph which is `site` must be defined.

   ```diff
   export default defineConfig({
   +  site: "https://<your site>.com",
     integrations: [
       opengraphImages({
         options: {
           fonts: [
             {
               name: "Roboto",
               weight: 400,
               style: "normal",
               data: fs.readFileSync("node_modules/@fontsource/roboto/files/roboto-latin-400-normal.woff"),
             },
           ],
         },
         render: presets.blackAndWhite,
       }),
     ],
   });
   ```

1. Update your main Astro layout with the appropriate `meta` tags. The [Open Graph site](https://ogp.me/) has more information possible tags.

   The following `meta` tags must be defined:

   - `og:title`
     - This field may be used when generating images.
   - `og:type`
     - See the [Open Graph documentation](https://ogp.me/#types) for valid values.
   - `og:image`
     - Set this to the return value of `getImagePath` (example shown below).
     - If the value of `og:image` does not match what this integration expects then your site will fail to build. This will ensure your site is correctly configured to display Open Graph images.
   - `og:description`
     - Optional. This field may be used when generating images.

   Your site will fail to build if the tags above are not set.

   - Option 1: Use the [`astro-seo`](https://github.com/jonasmerlin/astro-seo) package:

     Install the `astro-seo` package:

     ```bash
     npm i astro-seo
     ```

     Update your Astro layout to use the `SEO` component:

     ```diff
     ---
     +import { SEO } from "astro-seo";
     +import { getImagePath } from "astro-opengraph-images";

     interface Props {
       title: string;
     }

     const { title } = Astro.props;
     +const { url, site } = Astro;
     +const openGraphImageUrl = getImagePath({ url, site });
     ---

     <!doctype html>
     <html lang="en">
       <head>
         <meta charset="UTF-8" />
         <meta name="description" content="Astro description" />
         <meta name="viewport" content="width=device-width" />
         <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
         <meta name="generator" content={Astro.generator} />
         <title>{title}</title>

     +    <SEO
     +      openGraph={
     +        {
     +          basic: {
     +            title: title,
     +            type: "website",
     +            image: openGraphImageUrl,
     +            url: url,
     +          },
     +          optional: {
     +            description: "My page description",
     +          },
     +        }
     +      }
     +    />
       </head>
       <body>
         <slot />
       </body>
     </html>
     ```

   - Option 2: Manually add the `meta` tags to your Astro layout.

1. Build your site. You should see a `.png` file next to each `.html` page in your `dist` folder. Double-check that the `og:image` proprety in your `.html` file matches the path to the `.png` file.

1. Deploy your site. You can verify that your images are correct by:

   - Sending a link to your site in an application that supports Open Graph like iMessage, Slack, Discord, etc.
   - Visit [opengraph.xyz](http://opengraph.xyz/) and test your site.

## Examples

There are example sites using this integration under [`examples/`](https://github.com/shepherdjerred/astro-opengraph-images/tree/main/examples).

### Sites Using This

If you're using this project, [open a PR](https://github.com/shepherdjerred/astro-opengraph-images/compare) to add your site to this list.

- [sjer.red](https://sjer.red) ([source](https://github.com/shepherdjerred/sjer.red))

## Custom Renderers

You can create your own custom images with a render function. Take a look at how [a preset](https://github.com/shepherdjerred/astro-opengraph-images/blob/main/src/presets/blackAndWhite.tsx) works.

Renderers have access to the page's DOM using [jsdom](https://github.com/jsdom/jsdom). You can use this to render your Open Graph image using any of the content from the associated HTML page. An example of this is shown in the [custom property preset](https://github.com/shepherdjerred/astro-opengraph-images/blob/main/src/presets/customProperty.tsx) which shows a preview of the page's body text in the Open Graph image.

This library uses [Satori](https://github.com/vercel/satori) to convert React components to SVG. The SVG is then converted to a PNG using [resvg-js](https://github.com/yisibl/resvg-js).

> [!TIP]
> Satori supports [a subset of CSS](https://github.com/vercel/satori?tab=readme-ov-file#css). Be sure to familiarize yourself with its limitations.
>
> You can use the [Satori playground](https://og-playground.vercel.app/) to work on your images.
>
> You can use Tailwind syntax with [tw-to-css](https://github.com/vinicoder/tw-to-css). An example is the [Tailwind preset](https://github.com/shepherdjerred/astro-opengraph-images/blob/main/src/presets/tailwind.tsx). You'll need to install this package yourself.

### Loading Local Images

You may receive an error when setting the source attribute on an `img` tag, claiming you need an absolute URL. When using a custom renderer, you can load local images to use in your final image using the following syntax in your `.tsx` file:

```javascript
const filePath = path.join(process.cwd(), "src", "assets", "my-image.png");
const imageBase64 = `data:image/png;base64,${fs.readFileSync(filePath).toString("base64")}`;
```

The code above will load the image at `src/assets/my-image.png` and convert it to a base64 string which can be passed to an image tag's `src` attribute. Be sure to update the `data:image/png;base64,` part of the string to match the image's type and that the image's file ath is correct.

```jsx
<img
  style={{
    ...twj("absolute inset-0 w-full h-full"),
    ...{ objectFit: "cover" },
  }}
  src={imageBase64}
/>
```

Here's a complete example of a custom renderer with a locally loaded image:

```tsx
import type { RenderFunctionInput } from "astro-opengraph-images";
const { twj } = await import("tw-to-css");

// Remember to import these modules
import path from "path";
import * as fs from "node:fs";

const filePath = path.join(
  process.cwd(),
  "src",
  "assets",
  "my-image.png",
);
const imageBase64 = `data:image/png;base64,${fs.readFileSync(filePath).toString("base64")}`;

// from https://fullstackheroes.com/resources/vercel-og-templates/simple/
export async function simpleBlog({ title, description }: RenderFunctionInput): Promise<React.ReactNode> {
  return Promise.resolve(
    <div style={twj("h-full w-full flex items-start justify-start border border-blue-500 border-[12px] bg-gray-50")}>
      <div style={twj("flex items-start justify-start h-full")}>
        <!-- Locally loaded Image Used Here -->
        <img
          style={{
            ...twj("absolute inset-0 w-full h-full"),
            ...{ objectFit: "cover" },
          }}
          src={imageBase64}
        />
        <div style={twj("flex flex-col justify-between w-full h-full")}>
          <h1 style={twj("text-[80px] p-20 font-black text-left")}>{title}</h1>
          <div style={twj("text-2xl pb-10 px-20 font-bold mb-0")}>{description}</div>
        </div>
      </div>
    </div>,
  );
}
```

## Emoji Support

By default, emojis in your page titles or descriptions will not render correctly because system fonts are disabled and standard fonts don't include emoji glyphs.

To enable emoji support, use the `loadAdditionalAsset` option to fetch emoji images from a CDN like [Twemoji](https://github.com/jdecked/twemoji):

```typescript
import opengraphImages, { presets } from "astro-opengraph-images";
import * as fs from "fs";

export default defineConfig({
  site: "https://example.com",
  integrations: [
    opengraphImages({
      options: {
        fonts: [
          {
            name: "Roboto",
            weight: 400,
            style: "normal",
            data: fs.readFileSync("node_modules/@fontsource/roboto/files/roboto-latin-400-normal.woff"),
          },
        ],
        loadAdditionalAsset: async (languageCode, segment) => {
          if (languageCode === "emoji") {
            // Fetch emoji SVG from Twemoji CDN
            return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/svg/${segment.codePointAt(0)?.toString(16)}.svg`;
          }
          // Return empty array for other assets (e.g., fallback fonts)
          return [];
        },
      },
      render: presets.blackAndWhite,
    }),
  ],
});
```

The `loadAdditionalAsset` callback is called by [Satori](https://github.com/vercel/satori) whenever it encounters a character that isn't covered by the provided fonts. For emojis, returning an SVG URL will render the emoji correctly in your Open Graph images.

## Presets

Presets are located in [`src/presets/`](https://github.com/shepherdjerred/astro-opengraph-images/tree/main/src/presets). [Open a pull request](https://github.com/shepherdjerred/astro-opengraph-images/compare) to contribute a preset you've created.

Note: some presets use the [`tw-to-css`](https://github.com/vinicoder/tw-to-css) library. You'll need to install this dependency separately when using one of these presets. You'll see an error if the library is not already installed.

```bash
npm i tw-to-css
```

### `backgroundImage`

```diff
import opengraphImages, { presets } from "astro-opengraph-images";

export default defineConfig({
  integrations: [
    opengraphImages({
+      render: presets.backgroundImage,
    }),
  ],
});
```

![](assets/presets/backgroundImage.png)

### `blackAndWhite`

```diff
import opengraphImages, { presets } from "astro-opengraph-images";

export default defineConfig({
  integrations: [
    opengraphImages({
+      render: presets.blackAndWhite,
    }),
  ],
});
```

![](assets/presets/blackAndWhite.png)

### `brandedLogo`

```diff
import opengraphImages, { presets } from "astro-opengraph-images";

export default defineConfig({
  integrations: [
    opengraphImages({
+      render: presets.brandedLogo,
    }),
  ],
});
```

![](assets/presets/brandedLogo.png)

### `customProperty`

```diff
import opengraphImages, { presets } from "astro-opengraph-images";

export default defineConfig({
  integrations: [
    opengraphImages({
+      render: presets.customProperty,
    }),
  ],
});
```

![](assets/presets/customProperty.png)

### `gradients`

```diff
import opengraphImages, { presets } from "astro-opengraph-images";

export default defineConfig({
  integrations: [
    opengraphImages({
+      render: presets.gradients,
    }),
  ],
});
```

![](assets/presets/gradients.png)

### `podcast`

```diff
import opengraphImages, { presets } from "astro-opengraph-images";

export default defineConfig({
  integrations: [
    opengraphImages({
+      render: presets.podcast,
    }),
  ],
});
```

![](assets/presets/podcast.png)

### `rauchg`

```diff
import opengraphImages, { presets } from "astro-opengraph-images";

export default defineConfig({
  integrations: [
    opengraphImages({
+      render: presets.rauchg,
    }),
  ],
});
```

![](assets/presets/rauchg.png)

### `simpleBlog`

```diff
import opengraphImages, { presets } from "astro-opengraph-images";

export default defineConfig({
  integrations: [
    opengraphImages({
+      render: presets.simpleBlog,
    }),
  ],
});
```

![](assets/presets/simpleBlog.png)

### `tailwind`

```diff
import opengraphImages, { presets } from "astro-opengraph-images";

export default defineConfig({
  integrations: [
    opengraphImages({
+      render: presets.tailwind,
    }),
  ],
});
```

![](assets/presets/tailwind.png)

### `vercel`

```diff
import opengraphImages, { presets } from "astro-opengraph-images";

export default defineConfig({
  integrations: [
    opengraphImages({
+      render: presets.vercel,
    }),
  ],
});
```

![](assets/presets/vercel.png)

### `waveSvg`

```diff
import opengraphImages, { presets } from "astro-opengraph-images";

export default defineConfig({
  integrations: [
    opengraphImages({
+      render: presets.waveSvg,
    }),
  ],
});
```

![](assets/presets/waveSvg.png)

## Alternatives

Here are some similar libraries using Satori and Astro. I haven't done a feature comparison.

- https://github.com/florian-lefebvre/satori-astro (This library looks excellent)
- https://github.com/delucis/astro-og-canvas (Doesn't allow arbitrary layouts)
- https://github.com/thewebforge/astro-og-images (Only allows you to choose from a list of templates)
- https://github.com/tomaskebrle/astro-og-image (Seems limited)
- https://github.com/cijiugechu/astro-satori (Possibly dead, hasn't been updated in a year)
- https://github.com/kevinzunigacuellar/astro-satori (Possibly dead, hasn't been updated in a year)
- https://github.com/rumaan/astro-vercel-og (Possibly dead, hasn't been updated in a year)
