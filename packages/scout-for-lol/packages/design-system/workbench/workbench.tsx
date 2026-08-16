import { Info } from "lucide-react";
import { ChampionLoadingArt, ChampionPortrait } from "#src/assets/index.tsx";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "#src/components/accordion.tsx";
import { Alert } from "#src/components/alert.tsx";
import { Badge } from "#src/components/badge.tsx";
import { Button, IconButton } from "#src/components/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "#src/components/card.tsx";
import { Checkbox } from "#src/components/checkbox.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#src/components/dialog.tsx";
import {
  Field,
  FieldDescription,
  Input,
  Label,
  Textarea,
} from "#src/components/field.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#src/components/select.tsx";
import { Skeleton } from "#src/components/skeleton.tsx";
import { Spinner } from "#src/components/spinner.tsx";
import { Switch } from "#src/components/switch.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "#src/components/tabs.tsx";
import {
  ChampionCombobox,
  type ChampionOption,
} from "#src/domain/champion-combobox.tsx";
import { RankDisplay } from "#src/domain/rank-display.tsx";
import { StatusBadge } from "#src/domain/status-badge.tsx";
import { ChartFrame } from "#src/domain/visualization.tsx";
import {
  Container,
  GlobalFooter,
  GlobalNavbar,
  Grid,
  Section,
  Stack,
} from "#src/layout/index.tsx";
import { scoutThemes } from "#src/generated/tokens.ts";
import { CatalogSamples } from "./catalog-samples.tsx";

function ignoreChampionChange(champion: ChampionOption): void {
  void champion;
}

function colorTokenVariable(name: string): string {
  return `var(--scout-color-${name.replaceAll(/([a-z])([A-Z])/g, "$1-$2").toLowerCase()})`;
}

export function Workbench() {
  return (
    <div className="scout-page-frame">
      <GlobalNavbar currentPath="/" />
      <main className="workbench-main">
        <Container>
          <Stack>
            <Badge>Internal catalog</Badge>
            <h1>Scout design system</h1>
            <p className="scout-muted">
              Foundations, accessible primitives, shared chrome, marketing
              compositions, and League-aware widgets.
            </p>
          </Stack>
          <Section className="workbench-section">
            <h2>Foundations</h2>
            <Grid>
              {Object.entries(scoutThemes["modern-dark"].colors).map(
                ([name, value]) => (
                  <div key={name} className="workbench-swatch">
                    <span
                      className="workbench-swatch__color"
                      style={{ background: colorTokenVariable(name) }}
                      aria-hidden="true"
                    />
                    <strong>{name}</strong>
                    <span>{value} reference</span>
                  </div>
                ),
              )}
            </Grid>
          </Section>
          <Section className="workbench-section">
            <h2>Primitives</h2>
            <Stack>
              <div className="scout-cluster">
                <Button>Primary</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="destructive">Danger</Button>
                <IconButton label="Information">
                  <Info />
                </IconButton>
                <Button disabled>Disabled</Button>
                <Spinner />
              </div>
              <div className="scout-cluster">
                <Badge>Default</Badge>
                <Badge variant="secondary">Secondary</Badge>
                <Badge variant="destructive">Danger</Badge>
                <StatusBadge status="success">Healthy</StatusBadge>
              </div>
              <Alert icon={<Info />}>
                The same semantic component works in every Scout skin.
              </Alert>
              <Grid>
                <Card>
                  <CardHeader>
                    <CardTitle>Report delivery</CardTitle>
                    <CardDescription>Reusable card anatomy</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Field>
                      <Label htmlFor="name">Name</Label>
                      <Input id="name" placeholder="Weekly ranked report" />
                      <FieldDescription>
                        Visible to this Discord server.
                      </FieldDescription>
                    </Field>
                    <Textarea
                      aria-label="Description"
                      placeholder="Description"
                    />
                  </CardContent>
                  <CardFooter>
                    <Button size="sm">Save</Button>
                  </CardFooter>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Controls</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Stack>
                      <label className="scout-cluster" htmlFor="track-ranked">
                        <Checkbox id="track-ranked" />
                        <span>Track ranked games</span>
                      </label>
                      <label
                        className="scout-cluster"
                        htmlFor="publish-automatically"
                      >
                        <Switch id="publish-automatically" />
                        <span>Publish automatically</span>
                      </label>
                      <Select defaultValue="ranked">
                        <SelectTrigger aria-label="Queue">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ranked">Ranked</SelectItem>
                          <SelectItem value="arena">Arena</SelectItem>
                        </SelectContent>
                      </Select>
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
              <Tabs defaultValue="one">
                <TabsList>
                  <TabsTrigger value="one">Overview</TabsTrigger>
                  <TabsTrigger value="two">Details</TabsTrigger>
                </TabsList>
                <TabsContent value="one">
                  Keyboard-accessible tab content.
                </TabsContent>
                <TabsContent value="two">
                  Stable semantics across skins.
                </TabsContent>
              </Tabs>
              <Accordion type="single" collapsible>
                <AccordionItem value="one">
                  <AccordionTrigger>Why four themes?</AccordionTrigger>
                  <AccordionContent>
                    Skin and appearance are independent preferences.
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline">Open dialog</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create report</DialogTitle>
                    <DialogDescription>
                      Focus is trapped and restored by Radix.
                    </DialogDescription>
                  </DialogHeader>
                  <Input aria-label="Report name" />
                  <DialogFooter>
                    <Button>Create</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Skeleton style={{ width: "100%", height: "3rem" }} />
            </Stack>
          </Section>
          <Section className="workbench-section">
            <h2>Scout domain</h2>
            <Grid>
              <Card>
                <CardHeader>
                  <CardTitle>Champion selector</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChampionCombobox
                    value={undefined}
                    onChange={ignoreChampionChange}
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Champion art</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChampionPortrait
                    champion="Ahri"
                    alt="Ahri"
                    style={{ width: 96, height: 96 }}
                  />
                  <ChampionLoadingArt
                    champion="Aatrox"
                    className="workbench-art"
                  />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Rank</CardTitle>
                </CardHeader>
                <CardContent>
                  <RankDisplay rank="Diamond" division="II" leaguePoints={64} />
                </CardContent>
              </Card>
            </Grid>
            <ChartFrame
              title="Win rate by patch"
              description="A shared frame around consumer-owned chart rendering"
            >
              <div className="scout-empty-state">Interactive chart canvas</div>
            </ChartFrame>
          </Section>
          <CatalogSamples />
        </Container>
      </main>
      <GlobalFooter release="workbench" />
    </div>
  );
}
