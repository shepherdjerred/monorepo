import { useState } from "react";
import type { TabsComponent } from "../types";
import { ComponentRenderer } from "../ComponentRegistry";
import { resolveString } from "../../hooks/useDataBinding";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

interface A2UITabsProps {
  id: string;
  component: TabsComponent["Tabs"];
  surfaceId: string;
  dataModel: Record<string, unknown>;
}

export function A2UITabs({ component, surfaceId, dataModel }: A2UITabsProps) {
  const [activeTab, setActiveTab] = useState(component.tabItems[0]?.child || "");

  if (!component.tabItems || component.tabItems.length === 0) {
    return null;
  }

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList>
        {component.tabItems.map((tabItem, index) => {
          const title = resolveString(tabItem.title, dataModel);
          return (
            <TabsTrigger key={tabItem.child || index} value={tabItem.child}>
              {title}
            </TabsTrigger>
          );
        })}
      </TabsList>
      {component.tabItems.map((tabItem) => (
        <TabsContent key={tabItem.child} value={tabItem.child}>
          <ComponentRenderer
            componentId={tabItem.child}
            surfaceId={surfaceId}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}
