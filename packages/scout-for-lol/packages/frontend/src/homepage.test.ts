import { describe, expect, test } from "vitest";

const homepage = await Bun.file(
  new URL("pages/index.astro", import.meta.url),
).text();
const hero = await Bun.file(
  new URL("components/Hero.astro", import.meta.url),
).text();
const consumerPreview = await Bun.file(
  new URL("components/ConsumerExperiencePreviews.astro", import.meta.url),
).text();

describe("administrator homepage", () => {
  test("presents the complete administrator-focused value proposition", () => {
    expect(homepage).toContain('title="Scout for League of Legends"');
    expect(homepage).toContain(
      "Track your server’s League players with pre-match alerts and detailed recaps, run competitions and scheduled reports, then let members explore recorded games and shared player profiles.",
    );
    expect(homepage).toContain('title="Everything your League server needs"');
    for (const feature of [
      "Pre- & Post-Match Updates",
      "All the Modes You Play",
      "Every Region, Every Name",
      "Competitions, Leaderboards & Reports",
      "Player Profiles",
      "Explore & Ask Scout",
    ]) {
      expect(homepage).toContain(`title="${feature}"`);
    }
    expect(homepage).toContain(
      'title="Ready to track your friends\' League matches?"',
    );
    expect(homepage).toContain(
      "Add Scout to your Discord server and never miss another epic play or hilarious fail from your League friends.",
    );
  });

  test("uses one Get Started action in the hero and final call to action", () => {
    expect(homepage).not.toContain("View Documentation");
    expect(homepage).not.toContain("Read the docs");
    expect(homepage).not.toContain("DOCS_URL");
    expect(homepage.match(/text: "Get Started"/g)).toHaveLength(2);
  });

  test("centers the home hero in the viewport space below its two chrome rows", () => {
    expect(homepage).toContain(
      'class="grid min-h-svh min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)]"',
    );
    expect(hero).toContain('size === "home" ? "flex items-center"');
    expect(hero).not.toContain(
      '"scout-hero scout-section relative isolate px-6 lg:px-8"',
    );
  });

  test("places the new consumer preview after the core feature grid", () => {
    const featureGridEnd = homepage.indexOf("</FeatureGrid>");
    const consumerPreviewPosition = homepage.indexOf(
      "<ConsumerExperiencePreviews />",
    );
    const reportPreview = homepage.indexOf("<!-- Match Report Preview -->");
    expect(featureGridEnd).toBeGreaterThan(-1);
    expect(consumerPreviewPosition).toBeGreaterThan(featureGridEnd);
    expect(reportPreview).toBeGreaterThan(consumerPreviewPosition);
  });

  test("uses natural consumer and report-preview copy without snapshot metadata", () => {
    expect(consumerPreview).toContain("New · Explore &amp; Player Profiles");
    expect(consumerPreview).toContain(
      "Turn Scout&apos;s match history into answers",
    );
    expect(consumerPreview).not.toContain("Sanitized presentation snapshot");
    expect(homepage).toContain('badge="Automatic Match Reports"');
    expect(homepage).toContain('title="The whole match, at a glance"');
    expect(homepage).not.toContain("BenefitCard");
    expect(homepage).not.toContain("Complete Stats");
  });

  test("limits the visual showcase to four labeled mode families", () => {
    for (const asset of [
      "classic-prematch",
      "ranked-solo-discord",
      "aram-discord",
      "arena-discord",
    ]) {
      expect(homepage).toContain(`requireShowcaseAsset("${asset}")`);
    }
    expect(homepage).toContain("Solo/Duo · Flex · Ranked 5s");
    expect(homepage.match(/asset: requireShowcaseAsset/g)).toHaveLength(4);
  });

  test("starts installation through authenticated management", () => {
    expect(homepage).toContain("APP_LOGIN_URL");
    expect(homepage).not.toContain("SCOUT_INSTALL_URL");
    expect(homepage).not.toContain("Add Scout to Discord");
  });
});
