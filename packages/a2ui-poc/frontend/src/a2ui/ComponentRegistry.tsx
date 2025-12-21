import { useSurface } from "./SurfaceManager";
import {
  A2UIText,
  A2UIButton,
  A2UICard,
  A2UIColumn,
  A2UIRow,
  A2UIIcon,
  A2UIDivider,
  A2UIProgressIndicator,
} from "./components";

interface ComponentRendererProps {
  componentId: string;
  surfaceId: string;
}

export function ComponentRenderer({
  componentId,
  surfaceId,
}: ComponentRendererProps) {
  const { surfaces } = useSurface();
  const surface = surfaces.get(surfaceId);

  if (!surface) {
    return null;
  }

  const comp = surface.components.get(componentId);
  if (!comp) {
    return null;
  }

  const componentDef = comp.component;
  const dataModel = surface.dataModel;

  // Render based on component type
  if ("Text" in componentDef) {
    return <A2UIText component={componentDef.Text} dataModel={dataModel} />;
  }

  if ("Button" in componentDef) {
    return (
      <A2UIButton
        id={comp.id}
        component={componentDef.Button}
        surfaceId={surfaceId}
        dataModel={dataModel}
      />
    );
  }

  if ("Card" in componentDef) {
    return <A2UICard component={componentDef.Card} surfaceId={surfaceId} />;
  }

  if ("Column" in componentDef) {
    return (
      <A2UIColumn component={componentDef.Column} surfaceId={surfaceId} />
    );
  }

  if ("Row" in componentDef) {
    return <A2UIRow component={componentDef.Row} surfaceId={surfaceId} />;
  }

  if ("Icon" in componentDef) {
    return <A2UIIcon component={componentDef.Icon} dataModel={dataModel} />;
  }

  if ("Divider" in componentDef) {
    return <A2UIDivider component={componentDef.Divider} />;
  }

  if ("ProgressIndicator" in componentDef) {
    return (
      <A2UIProgressIndicator
        component={componentDef.ProgressIndicator}
        dataModel={dataModel}
      />
    );
  }

  // Unknown component type
  return (
    <div className="text-red-500 text-sm">
      Unknown component: {Object.keys(componentDef)[0]}
    </div>
  );
}

interface SurfaceRendererProps {
  surfaceId: string;
}

export function SurfaceRenderer({ surfaceId }: SurfaceRendererProps) {
  const { surfaces } = useSurface();
  const surface = surfaces.get(surfaceId);

  if (!surface || !surface.isRendering || !surface.rootId) {
    return null;
  }

  return (
    <div className="animate-fade-in">
      <ComponentRenderer componentId={surface.rootId} surfaceId={surfaceId} />
    </div>
  );
}
