import { useState } from "react";
import { ChampionSplashArt } from "#src/assets/index.tsx";
import { Button } from "#src/components/button.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "#src/components/collapsible.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#src/components/dropdown-menu.tsx";
import { Input } from "#src/components/field.tsx";
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "#src/components/navigation-menu.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#src/components/popover.tsx";
import { Separator } from "#src/components/separator.tsx";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "#src/components/sheet.tsx";
import { DiscordIdentity } from "#src/domain/discord-identity.tsx";
import { FormDialogFrame } from "#src/domain/form-dialog.tsx";
import {
  AugmentDisplay,
  ItemDisplay,
  LaneDisplay,
  RuneDisplay,
  SpellDisplay,
} from "#src/domain/icon-display.tsx";
import { MarkdownContent } from "#src/domain/markdown-content.tsx";
import { ReportResultTable } from "#src/domain/report-result-table.tsx";
import {
  ErrorState,
  LoadingState,
  PermissionState,
} from "#src/domain/states.tsx";
import { InteractiveVisualization } from "#src/domain/visualization.tsx";
import { Callout, Grid, Panel, Section, Stack } from "#src/layout/index.tsx";
import {
  AnnouncementBanner,
  CTA as Cta,
  FeatureCard,
  GalleryItem,
  Hero,
  ImageFeature,
  MarketingButton,
  ProcessStep,
  SectionHeader,
} from "#src/marketing/index.tsx";

const reportRows = [
  { champion: "Ahri", result: "Victory", kda: "8 / 2 / 11" },
  { champion: "Aatrox", result: "Defeat", kda: "4 / 6 / 5" },
];

export function CatalogSamples() {
  const [formOpen, setFormOpen] = useState(false);
  return (
    <>
      <Section className="workbench-section">
        <h2>Navigation and overlays</h2>
        <Stack>
          <NavigationMenu>
            <NavigationMenuList>
              <NavigationMenuItem>
                <NavigationMenuTrigger>Products</NavigationMenuTrigger>
                <NavigationMenuContent>
                  <NavigationMenuLink href="/app/">
                    Dashboard
                  </NavigationMenuLink>
                </NavigationMenuContent>
              </NavigationMenuItem>
            </NavigationMenuList>
          </NavigationMenu>
          <div className="scout-cluster">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">Open menu</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem>Edit report</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>Archive report</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">Open popover</Button>
              </PopoverTrigger>
              <PopoverContent>Context without leaving the page.</PopoverContent>
            </Popover>
            <Sheet>
              <SheetTrigger asChild>
                <Button variant="outline">Open drawer</Button>
              </SheetTrigger>
              <SheetContent>
                <SheetTitle>Scout drawer</SheetTitle>
                <p>Responsive secondary content.</p>
              </SheetContent>
            </Sheet>
          </div>
          <Collapsible defaultOpen>
            <CollapsibleTrigger asChild>
              <Button variant="ghost">Collapsible details</Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Callout>Stable disclosure semantics in every skin.</Callout>
            </CollapsibleContent>
          </Collapsible>
          <Separator />
        </Stack>
      </Section>

      <Section className="workbench-section">
        <SectionHeader>
          <h2>Layouts and states</h2>
          <p className="scout-muted">
            Container, stack, cluster, grid, section, panel, callout, page
            header, empty state, responsive frame, and shared shells use the
            same semantic slots.
          </p>
        </SectionHeader>
        <Grid>
          <Panel>
            <DiscordIdentity
              displayName="Scout Admin"
              detail="Discord identity"
            />
          </Panel>
          <LoadingState label="Loading match history…" />
          <ErrorState message="The report could not be loaded." />
          <PermissionState message="Administrator access is required." />
        </Grid>
      </Section>

      <Section className="workbench-section">
        <h2>Domain data</h2>
        <Grid>
          <Panel>
            <Stack>
              <ItemDisplay item="1001" label="Boots" detail="Movement speed" />
              <RuneDisplay rune="6361" label="Arcane Comet" />
              <SpellDisplay spell="SummonerBarrier" label="Barrier" />
              <AugmentDisplay
                augment="acceleratingsorcery_small"
                label="Accelerating Sorcery"
              />
              <LaneDisplay lane="adc" label="Bottom" />
            </Stack>
          </Panel>
          <Panel>
            <MarkdownContent
              source={
                "### Coaching note\n\nUse **tempo** before contesting the objective."
              }
            />
          </Panel>
        </Grid>
        <ReportResultTable
          caption="Example report results"
          rows={reportRows}
          getRowKey={(row) => row.champion}
          columns={[
            {
              key: "champion",
              header: "Champion",
              render: (row) => row.champion,
            },
            { key: "result", header: "Result", render: (row) => row.result },
            { key: "kda", header: "KDA", render: (row) => row.kda },
          ]}
        />
        <InteractiveVisualization label="Example objective timeline">
          <div className="workbench-chart" aria-hidden="true" />
        </InteractiveVisualization>
        <Button
          variant="outline"
          onClick={() => {
            setFormOpen(true);
          }}
        >
          Open form dialog frame
        </Button>
        <FormDialogFrame
          open={formOpen}
          onOpenChange={setFormOpen}
          title="Schedule report"
          description="Workflow state remains in the consuming app."
          footer={<Button>Save schedule</Button>}
        >
          <Input aria-label="Schedule name" placeholder="Weekly recap" />
        </FormDialogFrame>
      </Section>

      <Section className="workbench-section">
        <h2>Marketing compositions</h2>
        <AnnouncementBanner>Scout 2.0 is available.</AnnouncementBanner>
        <Hero
          titleLevel="h2"
          eyebrow={
            <span className="scout-badge scout-badge--primary">Live</span>
          }
          title="Know the match before it starts."
          description="Shared composition slots preserve content while each skin changes its visual language."
          primaryAction={
            <MarketingButton href="/app/login">Get Started</MarketingButton>
          }
          secondaryAction={
            <MarketingButton href="/docs/" secondary>
              Read the docs
            </MarketingButton>
          }
          media={
            <ChampionSplashArt champion="Ahri" alt="Ahri splash artwork" />
          }
        />
        <Grid>
          <FeatureCard title="Prematch insight">
            See lanes, champions, and history before loading in.
          </FeatureCard>
          <ProcessStep number={1} title="Invite Scout">
            Connect the Discord server you already use.
          </ProcessStep>
          <GalleryItem
            image={
              <ChampionSplashArt
                champion="Aatrox"
                alt="Aatrox splash artwork"
              />
            }
            caption="Gallery and report-showcase framing"
          />
        </Grid>
        <ImageFeature
          image={
            <ChampionSplashArt champion="Ahri" alt="Ahri splash artwork" />
          }
          title="Champion-aware surfaces"
        >
          Existing champion keys resolve to patch-pinned, same-origin art.
        </ImageFeature>
        <Cta
          title="Ready to scout?"
          description="The same CTA hierarchy works across all themes."
          action={
            <MarketingButton href="/app/login">Open Scout</MarketingButton>
          }
        />
      </Section>
    </>
  );
}
