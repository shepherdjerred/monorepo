import { TerraformIterator, TerraformVariable } from "cdktn";
import { describe, expect, test } from "vitest";
import { OnepasswordProvider } from "#generated/providers/onepassword/provider/index.ts";
import { HOMELAB_VAULT_ID, onePasswordWrite } from "#src/onepassword.ts";
import { synthesizeStack } from "#src/testing.ts";

describe("writing a credential to 1Password", () => {
  test("keeps the HCL address and writes concealed fields into one section", async () => {
    const stack = await synthesizeStack((scope) => {
      new OnepasswordProvider(scope, "onepassword", {});
      const token = new TerraformVariable(scope, "token", {
        type: "string",
        sensitive: true,
      });
      onePasswordWrite(scope, "argocd_delivery_token", {
        title: "delivery-argocd-token",
        section: "tokens",
        fields: { ARGOCD_TOKEN: token.stringValue },
      });
    });
    expect(stack.resource).toEqual({
      onepassword_item: {
        argocd_delivery_token: {
          vault: HOMELAB_VAULT_ID,
          title: "delivery-argocd-token",
          section: [
            {
              label: "tokens",
              field: [
                {
                  label: "ARGOCD_TOKEN",
                  type: "CONCEALED",
                  value: "${var.token}",
                },
              ],
            },
          ],
        },
      },
    });
  });

  test("one item per for_each element, with the category and field order as declared", async () => {
    const stack = await synthesizeStack((scope) => {
      new OnepasswordProvider(scope, "onepassword", {});
      const keys = new TerraformVariable(scope, "keys", {
        type: "map(object({ title = string }))",
      });
      const each = TerraformIterator.fromMap(keys.value);
      onePasswordWrite(scope, "backup", {
        forEach: each,
        title: each.getString("title"),
        category: "secure_note",
        section: "credentials",
        fields: {
          B2_ACCESS_KEY_ID:
            "${b2_application_key.backup[each.key].application_key_id}",
          B2_SECRET_ACCESS_KEY:
            "${b2_application_key.backup[each.key].application_key}",
        },
      });
    });
    const item = stack.resource?.["onepassword_item"]?.["backup"];
    expect(item).toMatchObject({
      for_each: "${var.keys}",
      title: "${each.value.title}",
      category: "secure_note",
      vault: HOMELAB_VAULT_ID,
    });
    expect(item?.["section"]).toEqual([
      {
        label: "credentials",
        field: [
          {
            label: "B2_ACCESS_KEY_ID",
            type: "CONCEALED",
            value: "${b2_application_key.backup[each.key].application_key_id}",
          },
          {
            label: "B2_SECRET_ACCESS_KEY",
            type: "CONCEALED",
            value: "${b2_application_key.backup[each.key].application_key}",
          },
        ],
      },
    ]);
  });

  test("an item without fields is a mistake, not an empty item", async () => {
    await expect(
      synthesizeStack((scope) => {
        onePasswordWrite(scope, "empty", {
          title: "empty",
          section: "tokens",
          fields: {},
        });
      }),
    ).rejects.toThrow("declares no fields");
  });
});
