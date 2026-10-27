import { z } from "zod/v4";
import { promotionTotp } from "./otp.ts";

type Credential = "username" | "email" | "password" | "otp";
export function promotionCredentialValue(
  login: {
    username: string;
    password: string;
    email?: string | undefined;
    otp?: string | undefined;
  },
  kind: Credential,
): string {
  switch (kind) {
    case "username":
      return login.username;
    case "password":
      return login.password;
    case "email": {
      const value =
        login.email ??
        (z.email().safeParse(login.username).success
          ? login.username
          : undefined);
      if (value === undefined)
        throw new Error("Stored email is unavailable for this account");
      return value;
    }
    case "otp": {
      if (login.otp === undefined)
        throw new Error("Stored second factor is unavailable for this account");
      return promotionTotp(login.otp);
    }
  }
}
export function assertPromotionCredentialInput(
  node: { role: string; name?: string | undefined },
  type: string | null,
  kind: Credential,
): void {
  let matches = false;
  if (node.role === "textbox") {
    switch (kind) {
      case "password":
        matches = type === "password";
        break;
      case "otp":
        matches =
          /verification|authenticator|security code|one.time|two.factor/i.test(
            node.name ?? "",
          ) && ["text", "tel", "number", null].includes(type);
        break;
      case "email":
      case "username":
        matches = [null, "text", "email"].includes(type);
    }
  }
  if (!matches)
    throw new Error(
      "Credential reference must identify the matching native input",
    );
}
