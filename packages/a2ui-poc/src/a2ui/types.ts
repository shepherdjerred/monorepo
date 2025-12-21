/**
 * A2UI Protocol v0.8 TypeScript Type Definitions
 * Based on: https://a2ui.org/specification/v0.8-a2ui/
 */

// ============= Bound Values =============

export interface BoundString {
  literalString?: string;
  path?: string;
}

export interface BoundNumber {
  literalNumber?: number;
  path?: string;
}

export interface BoundBoolean {
  literalBoolean?: boolean;
  path?: string;
}

export interface BoundArray {
  literalArray?: string[];
  path?: string;
}

export type BoundValue = BoundString | BoundNumber | BoundBoolean | BoundArray;

// ============= Children Definition =============

export interface ExplicitChildren {
  explicitList: string[];
}

export interface TemplateChildren {
  template: {
    componentId: string;
    dataBinding: string;
  };
}

export type Children = ExplicitChildren | TemplateChildren;

// ============= Action Definition =============

export interface ActionContext {
  key: string;
  value: BoundString | BoundNumber | BoundBoolean;
}

export interface Action {
  name: string;
  context?: ActionContext[];
}

// ============= Standard Catalog Components =============

export type TextUsageHint =
  | "h1"
  | "h2"
  | "h3"
  | "h4"
  | "h5"
  | "caption"
  | "body";

export interface TextComponent {
  Text: {
    text: BoundString;
    usageHint?: TextUsageHint;
  };
}

export interface ButtonComponent {
  Button: {
    child: string;
    primary?: boolean;
    action: Action;
  };
}

export interface CardComponent {
  Card: {
    child: string;
  };
}

export type RowDistribution =
  | "center"
  | "end"
  | "spaceAround"
  | "spaceBetween"
  | "spaceEvenly"
  | "start";

export type Alignment = "start" | "center" | "end" | "stretch";

export interface RowComponent {
  Row: {
    children: Children;
    distribution?: RowDistribution;
    alignment?: Alignment;
  };
}

export type ColumnDistribution =
  | "start"
  | "center"
  | "end"
  | "spaceBetween"
  | "spaceAround"
  | "spaceEvenly";

export interface ColumnComponent {
  Column: {
    children: Children;
    distribution?: ColumnDistribution;
    alignment?: Alignment;
  };
}

export interface ListComponent {
  List: {
    children: Children;
    direction?: "vertical" | "horizontal";
    alignment?: Alignment;
  };
}

export type ImageFit = "contain" | "cover" | "fill" | "none" | "scale-down";
export type ImageUsageHint =
  | "icon"
  | "avatar"
  | "smallFeature"
  | "mediumFeature"
  | "largeFeature"
  | "header";

export interface ImageComponent {
  Image: {
    url: BoundString;
    fit?: ImageFit;
    usageHint?: ImageUsageHint;
  };
}

export interface IconComponent {
  Icon: {
    name: BoundString;
  };
}

export interface DividerComponent {
  Divider: {
    axis?: "horizontal" | "vertical";
  };
}

export interface TabItem {
  title: BoundString;
  child: string;
}

export interface TabsComponent {
  Tabs: {
    tabItems: TabItem[];
  };
}

// Custom component for POC
export interface ProgressIndicatorComponent {
  ProgressIndicator: {
    progress: BoundNumber;
    label?: BoundString;
  };
}

export type ComponentDefinition =
  | TextComponent
  | ButtonComponent
  | CardComponent
  | RowComponent
  | ColumnComponent
  | ListComponent
  | ImageComponent
  | IconComponent
  | DividerComponent
  | TabsComponent
  | ProgressIndicatorComponent;

// ============= Component Wrapper =============

export interface A2UIComponent {
  id: string;
  weight?: number;
  component: ComponentDefinition;
}

// ============= Message Types =============

export interface SurfaceUpdate {
  surfaceUpdate: {
    surfaceId: string;
    components: A2UIComponent[];
  };
}

export interface DataModelEntry {
  key: string;
  valueString?: string;
  valueNumber?: number;
  valueBoolean?: boolean;
  valueMap?: DataModelEntry[];
}

export interface DataModelUpdate {
  dataModelUpdate: {
    surfaceId: string;
    path?: string;
    contents: DataModelEntry[];
  };
}

export interface BeginRendering {
  beginRendering: {
    surfaceId: string;
    catalogId?: string;
    root: string;
    styles?: Record<string, unknown>;
  };
}

export interface DeleteSurface {
  deleteSurface: {
    surfaceId: string;
  };
}

export type A2UIMessage =
  | SurfaceUpdate
  | DataModelUpdate
  | BeginRendering
  | DeleteSurface;

// ============= Client-to-Server Events =============

export interface UserAction {
  userAction: {
    name: string;
    surfaceId: string;
    sourceComponentId: string;
    timestamp: string;
    context: Record<string, unknown>;
  };
}

export interface ClientError {
  error: Record<string, unknown>;
}

export type ClientEvent = UserAction | ClientError;

// ============= Type Guards =============

export function isSurfaceUpdate(msg: A2UIMessage): msg is SurfaceUpdate {
  return "surfaceUpdate" in msg;
}

export function isDataModelUpdate(msg: A2UIMessage): msg is DataModelUpdate {
  return "dataModelUpdate" in msg;
}

export function isBeginRendering(msg: A2UIMessage): msg is BeginRendering {
  return "beginRendering" in msg;
}

export function isDeleteSurface(msg: A2UIMessage): msg is DeleteSurface {
  return "deleteSurface" in msg;
}
