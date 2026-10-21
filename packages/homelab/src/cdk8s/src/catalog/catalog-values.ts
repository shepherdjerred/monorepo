import type { App } from "cdk8s";
import { z } from "zod";
import {
  ACQUIRED_IMAGE_PARAMETERS,
  IMAGE_PARAMETER_COMPONENTS,
} from "@shepherdjerred/homelab/cdk8s/src/catalog/catalog-targets.ts";
import {
  helmPath,
  mapStrings,
  rootRendered,
  walkStrings,
} from "@shepherdjerred/homelab/cdk8s/src/catalog/catalog-applications.ts";

/**
 * Artifact parameters (Delivery model, P4 and C2): the Helm values a
 * deployment binds to components, read from a first-party chart's templates
 * or split out of an upstream chart's values.
 */

const CHART_IMAGE_REFERENCE =
  /\(get \(get \(\.Values\.delivery \| default dict\) "(images|dependencies)" \| default dict\) "([a-z0-9.-]+)"\)/gu;
const CHART_OWN_IMAGE =
  /\.Values\.delivery\.image\b|\(\.Values\.delivery \| default dict\) "image"\)/u;
const ROOT_TEMPLATE_DEPENDENCY =
  /\(get \(get \(\.Values\.delivery \| default dict\) "dependencies" \| default dict\) "([a-z0-9.-]+)"\)/u;
const PINNED_DIGEST = /sha256:[a-f0-9]{64}/u;
/** The Delivery image parameters a first-party chart's templates require. */
export function chartImageParameters(
  app: App,
  chartName: string,
  ownImage: string | undefined,
): Record<string, string> {
  const chart = app.charts.find((candidate) => candidate.node.id === chartName);
  if (chart === undefined)
    throw new Error(`Repository chart ${chartName} is not synthesized`);
  const parameters: Record<string, string> = {};
  walkStrings(chart.toJson(), [], (text) => {
    for (const match of text.matchAll(CHART_IMAGE_REFERENCE)) {
      const [, kind = "", name = ""] = match;
      const parameter = `delivery.${kind}.${name}`;
      parameters[parameter] =
        IMAGE_PARAMETER_COMPONENTS[parameter] ?? `image:${name}`;
    }
    if (CHART_OWN_IMAGE.test(text)) {
      if (ownImage === undefined)
        throw new Error(
          `Chart ${chartName} reads delivery.image without one first-party image`,
        );
      parameters["delivery.image"] = ownImage;
    }
  });
  return parameters;
}

function child(container: unknown, segment: string | number): unknown {
  if (typeof segment === "number" && Array.isArray(container))
    return z.array(z.unknown()).parse(container).at(segment);
  if (typeof container === "object" && container !== null)
    return Reflect.get(container, segment);
  throw new TypeError(
    `Values path segment ${String(segment)} is not a container`,
  );
}

/** Delete one leaf in place; an array element keeps its other fields. */
function removePath(root: unknown, path: readonly (string | number)[]): void {
  const last = path.at(-1);
  if (typeof last !== "string")
    throw new TypeError(`Bound value ${helmPath(path)} is not an object field`);
  const parent = path
    .slice(0, -1)
    .reduce<unknown>((cursor, segment) => child(cursor, segment), root);
  if (
    typeof parent !== "object" ||
    parent === null ||
    !Object.hasOwn(parent, last)
  )
    throw new Error(`Bound value ${helmPath(path)} is absent`);
  Reflect.deleteProperty(parent, last);
}

/**
 * Split an upstream chart's values into the image bindings and the rest. A
 * value the root templated from `delivery.dependencies` binds that reference
 * component; a value pinning an acquired image binds the component the
 * reviewed table names. Any other pinned digest fails.
 */
export function splitUpstreamValues(
  application: string,
  values: Record<string, unknown>,
): {
  parameters: Record<string, string>;
  values: Record<string, unknown>;
} {
  const acquired = ACQUIRED_IMAGE_PARAMETERS[application] ?? {};
  const parameters: Record<string, string> = {};
  const bound: (string | number)[][] = [];
  walkStrings(values, [], (text, path) => {
    const parameter = helmPath(path);
    const dependency = ROOT_TEMPLATE_DEPENDENCY.exec(text)?.[1];
    if (dependency !== undefined) {
      parameters[parameter] = `image:${dependency}`;
      bound.push(path);
    } else if (
      rootRendered(text, `${application} value ${parameter}`) !== text
    ) {
      // An upstream-chart template the root render unescapes; not an image.
    } else if (acquired[parameter] !== undefined) {
      parameters[parameter] = acquired[parameter];
      bound.push(path);
    } else if (PINNED_DIGEST.test(text))
      throw new Error(
        `${application} value ${parameter} pins an image without a component`,
      );
  });
  const unused = Object.keys(acquired).filter(
    (parameter) => parameters[parameter] === undefined,
  );
  if (unused.length > 0)
    throw new Error(
      `${application} acquired image parameters match no value: ${unused.join(", ")}`,
    );
  const stripped = structuredClone(values);
  for (const path of bound) removePath(stripped, path);
  return {
    parameters,
    values: z
      .record(z.string(), z.unknown())
      .parse(
        mapStrings(stripped, (text) =>
          rootRendered(text, `${application} values`),
        ),
      ),
  };
}
