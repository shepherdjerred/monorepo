import { createClient } from "@supabase/supabase-js";

// Create a single supabase client for interacting with your database
export const supabase = createClient("", "");

export async function signInWithGithub() {
  return await supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: `http://localhost:5173/`,
    },
  });
}

export async function signOut() {
  return await supabase.auth.signOut();
}
