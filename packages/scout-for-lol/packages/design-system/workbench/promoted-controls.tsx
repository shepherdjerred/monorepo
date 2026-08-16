import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "#src/components/alert-dialog.tsx";
import { Avatar, AvatarFallback } from "#src/components/avatar.tsx";
import { Button } from "#src/components/button.tsx";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
} from "#src/components/drawer.tsx";
import { Progress } from "#src/components/progress.tsx";
import { ScrollArea } from "#src/components/scroll-area.tsx";
import { Toaster, toast } from "#src/components/toaster.tsx";
import { ToggleGroup, ToggleGroupItem } from "#src/components/toggle-group.tsx";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "#src/components/tooltip.tsx";
import { Container, Section, Stack } from "#src/layout/index.tsx";

export function PromotedControlsCatalog() {
  return (
    <main className="workbench-main">
      <Container>
        <Section className="workbench-section">
          <h1>Activity-ready controls</h1>
          <Stack>
            <div className="scout-cluster" aria-label="Team-side colors">
              <span className="scout-cluster">
                <span
                  aria-hidden="true"
                  style={{
                    width: "0.75rem",
                    height: "0.75rem",
                    borderRadius: "999px",
                    background: "var(--scout-color-team-blue)",
                  }}
                />
                Blue team
              </span>
              <span className="scout-cluster">
                <span
                  aria-hidden="true"
                  style={{
                    width: "0.75rem",
                    height: "0.75rem",
                    borderRadius: "999px",
                    background: "var(--scout-color-team-red)",
                  }}
                />
                Red team
              </span>
            </div>
            <div className="scout-cluster">
              <Avatar size="lg">
                <AvatarFallback>JP</AvatarFallback>
              </Avatar>
              <ToggleGroup
                type="single"
                defaultValue="ready"
                aria-label="Availability"
              >
                <ToggleGroupItem value="ready">Ready</ToggleGroupItem>
                <ToggleGroupItem value="maybe">Maybe</ToggleGroupItem>
                <ToggleGroupItem value="away">Away</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <Progress aria-label="Roster completion" value={70} />
            <ScrollArea
              aria-label="Bench players"
              style={{ width: "100%", height: "4rem" }}
            >
              <p>
                Bench order: Janna, Poppy, Braum, Lulu, Rakan, Thresh, Nami,
                Leona.
              </p>
            </ScrollArea>
            <div className="scout-cluster">
              <TooltipProvider delayDuration={0}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline">Roster help</Button>
                  </TooltipTrigger>
                  <TooltipContent>First ten ready players</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">End custom night</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogTitle>End this custom night?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Temporary voice channels will be removed.
                  </AlertDialogDescription>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep playing</AlertDialogCancel>
                    <AlertDialogAction variant="destructive">
                      End night
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Drawer showSwipeHandle>
                <DrawerTrigger render={<Button variant="outline" />}>
                  Open mobile roster
                </DrawerTrigger>
                <DrawerContent>
                  <DrawerTitle>Mobile roster</DrawerTitle>
                  <DrawerDescription>
                    Swipe or press Escape to dismiss.
                  </DrawerDescription>
                </DrawerContent>
              </Drawer>
              <Button
                variant="outline"
                onClick={() => {
                  toast.success("Custom night created");
                }}
              >
                Show toast
              </Button>
            </div>
            <Toaster />
          </Stack>
        </Section>
      </Container>
    </main>
  );
}
