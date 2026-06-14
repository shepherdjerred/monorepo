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
  A2UIList,
  A2UITabs,
  A2UIImage,
  A2UIModal,
  A2UIVideo,
  A2UIAudioPlayer,
  A2UICheckBox,
  A2UITextField,
  A2UIMultipleChoice,
  A2UISlider,
  A2UIDateTimeInput,
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
    return <A2UIColumn component={componentDef.Column} surfaceId={surfaceId} />;
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

  if ("List" in componentDef) {
    return (
      <A2UIList
        id={comp.id}
        component={componentDef.List}
        surfaceId={surfaceId}
        dataModel={dataModel}
      />
    );
  }

  if ("Tabs" in componentDef) {
    return (
      <A2UITabs
        id={comp.id}
        component={componentDef.Tabs}
        surfaceId={surfaceId}
        dataModel={dataModel}
      />
    );
  }

  if ("Image" in componentDef) {
    return (
      <A2UIImage
        id={comp.id}
        component={componentDef.Image}
        dataModel={dataModel}
      />
    );
  }

  if ("Modal" in componentDef) {
    return (
      <A2UIModal
        id={comp.id}
        component={componentDef.Modal}
        surfaceId={surfaceId}
      />
    );
  }

  if ("Video" in componentDef) {
    return (
      <A2UIVideo
        id={comp.id}
        component={componentDef.Video}
        dataModel={dataModel}
      />
    );
  }

  if ("AudioPlayer" in componentDef) {
    return (
      <A2UIAudioPlayer
        id={comp.id}
        component={componentDef.AudioPlayer}
        dataModel={dataModel}
      />
    );
  }

  if ("CheckBox" in componentDef) {
    return (
      <A2UICheckBox
        id={comp.id}
        component={componentDef.CheckBox}
        surfaceId={surfaceId}
        dataModel={dataModel}
      />
    );
  }

  if ("TextField" in componentDef) {
    return (
      <A2UITextField
        id={comp.id}
        component={componentDef.TextField}
        surfaceId={surfaceId}
        dataModel={dataModel}
      />
    );
  }

  if ("MultipleChoice" in componentDef) {
    return (
      <A2UIMultipleChoice
        id={comp.id}
        component={componentDef.MultipleChoice}
        surfaceId={surfaceId}
        dataModel={dataModel}
      />
    );
  }

  if ("Slider" in componentDef) {
    return (
      <A2UISlider
        id={comp.id}
        component={componentDef.Slider}
        surfaceId={surfaceId}
        dataModel={dataModel}
      />
    );
  }

  if ("DateTimeInput" in componentDef) {
    return (
      <A2UIDateTimeInput
        id={comp.id}
        component={componentDef.DateTimeInput}
        surfaceId={surfaceId}
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
