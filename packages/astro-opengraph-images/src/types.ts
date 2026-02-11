import type { BaseIntegrationHooks } from "astro";
import type { ReactNode } from "react";

export interface IntegrationInput {
  options: PartialIntegrationOptions;
  render: RenderFunction;
}

/** When applied to PartialIntegrationOptions this type equals IntegrationOptions */
export interface IntegrationDefaults {
  width: number;
  height: number;
  verbose: boolean;
}

/**
 * IntegrationOptions with some optional properties. This is what we expose to the user. It allows us to
 * merge the defaults with the user's options and ensure that all required properties are present.
 */
export type PartialIntegrationOptions = Omit<Omit<SatoriOptions, "width">, "height"> & Partial<IntegrationDefaults>;

/**
 * The options that we use internally. This ensures that all options are configured, either with something
 * the user provided or with a default value.
 */
export type IntegrationOptions = PartialIntegrationOptions & IntegrationDefaults;

/** This is the page data passed in by Astro */
export interface Page {
  pathname: string;
}

/** The input Astro passes to the build done hook */
export type AstroBuildDoneHookInput = Parameters<BaseIntegrationHooks["astro:build:done"]>[0];

/** The input arguments to a `RenderFunction` */
export type RenderFunctionInput = {
  pathname: string;
  dir: URL;
  document: Document;
} & PageDetails;

/** A function that renders some page input to React */
export type RenderFunction = (input: RenderFunctionInput) => Promise<ReactNode>;

/** Basic information about a page */
export interface PageDetails {
  title: string;
  description?: string;
  url: string;
  type: string;
  image: string;
}

type NonEmptyArray<T> = [T, ...T[]];

/** Types copied from Satori */
export type SatoriWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
export type SatoriFontStyle = "normal" | "italic";
export interface SatoriFontOptions {
  data: Buffer | ArrayBuffer;
  name: string;
  weight?: SatoriWeight;
  style?: SatoriFontStyle;
  lang?: string;
}
export interface SatoriOptions {
  width: number;
  height: number;
  fonts: NonEmptyArray<SatoriFontOptions>;
  /** Callback to load additional assets like emoji images or fallback fonts */
  loadAdditionalAsset?: (languageCode: string, segment: string) => Promise<string | SatoriFontOptions[]>;
}
