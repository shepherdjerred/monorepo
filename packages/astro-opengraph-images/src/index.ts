import { presets as importedPresets } from "./presets/index.js";
import { getImagePath as importedGetImagePath } from "./util.js";
import { astroOpenGraphImages } from "./integration.js";
import type {
  IntegrationInput as _IntegrationInput,
  IntegrationDefaults as _IntegrationDefaults,
  PartialIntegrationOptions as _PartialIntegrationOptions,
  IntegrationOptions as _IntegrationOptions,
  Page as _Page,
  AstroBuildDoneHookInput as _AstroBuildDoneHookInput,
  RenderFunctionInput as _RenderFunctionInput,
  RenderFunction as _RenderFunction,
  PageDetails as _PageDetails,
  SatoriWeight as _SatoriWeight,
  SatoriFontStyle as _SatoriFontStyle,
  SatoriFontOptions as _SatoriFontOptions,
  SatoriOptions as _SatoriOptions,
} from "./types.js";

export const presets = importedPresets;
export const getImagePath = importedGetImagePath;
export default astroOpenGraphImages;

export type IntegrationInput = _IntegrationInput;
export type IntegrationDefaults = _IntegrationDefaults;
export type PartialIntegrationOptions = _PartialIntegrationOptions;
export type IntegrationOptions = _IntegrationOptions;
export type Page = _Page;
export type AstroBuildDoneHookInput = _AstroBuildDoneHookInput;
export type RenderFunctionInput = _RenderFunctionInput;
export type RenderFunction = _RenderFunction;
export type PageDetails = _PageDetails;
export type SatoriWeight = _SatoriWeight;
export type SatoriFontStyle = _SatoriFontStyle;
export type SatoriFontOptions = _SatoriFontOptions;
export type SatoriOptions = _SatoriOptions;
