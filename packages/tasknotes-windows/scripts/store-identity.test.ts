import { describe, expect, test } from "vitest";
import { parseStoreIdentity, storeManifest } from "./store-identity.ts";

const fixture = {
  schemaVersion: 1,
  name: "10017Fixture.Facet",
  publisher: "CN=00000000-0000-0000-0000-000000000001",
  publisherDisplayName: "Fixture & Publisher",
  displayName: "Facet",
  version: "1.2.3.0",
};
describe("Store identity", () => {
  test("requires actual registered metadata instead of development defaults", () => {
    expect(() => parseStoreIdentity(undefined)).toThrow();
    expect(() =>
      parseStoreIdentity({ ...fixture, publisher: "CN=TaskNotes Development" }),
    ).toThrow();
    expect(() =>
      parseStoreIdentity({ ...fixture, version: "1.2.3.1" }),
    ).toThrow();
    expect(() =>
      parseStoreIdentity({ ...fixture, version: "65536.0.0.0" }),
    ).toThrow();
    expect(() =>
      parseStoreIdentity({ ...fixture, token: "synthetic" }),
    ).toThrow();
  });
  test("escapes display names and preserves executable tokens and capabilities", () => {
    const manifest = storeManifest(
      '<Package><Identity Name="development" Publisher="CN=TaskNotes Development" Version="0.1.0.0" /><Properties><DisplayName>Old</DisplayName><PublisherDisplayName>Old</PublisherDisplayName></Properties><Application Executable="$targetnametoken$.exe" DisplayName="Old" /><Capabilities><Capability Name="internetClient" /></Capabilities></Package>',
      parseStoreIdentity(fixture),
    );
    expect(manifest).toContain('Name="10017Fixture.Facet"');
    expect(manifest).toContain("Fixture &amp; Publisher");
    expect(manifest).toContain("$targetnametoken$.exe");
    expect(manifest).toContain('<Capability Name="internetClient" />');
  });
});
