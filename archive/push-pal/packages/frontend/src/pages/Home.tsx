import Sites from "../components/list/Sites";
import Form from "../components/add/Form";
import type { Site } from "../types/Site";
import { signInWithGithub, supabase } from "../supabase";

export default async function Home() {
  // TODO: load this data from Supabase
  const sites: Site[] = [
    {
      id: "1",
      name: "Site 1",
      stages: {
        main: {
          name: "main",
          revision: "1",
        },
        prod: {
          name: "prod",
          revision: "2",
        },
      },
    },
    {
      id: "2",
      name: "Site 2",
      stages: {
        main: {
          name: "main",
          revision: "1",
        },
        prod: {
          name: "prod",
          revision: "2",
        },
      },
    },
  ];

  if (await supabase.auth.getUser()) {
    // user is signed in
  } else {
    await signInWithGithub();
  }

  return (
    <>
      <h1>Home - Push Pal</h1>
      <Sites sites={sites} />
      <Form />
    </>
  );
}
