import React from "react";
import Card from "../components/cards/Card";
import Button from "../components/Button";
import CardList from "../components/cards/CardList";
import { useFindServersQuery, Server } from "@mira-hq/model/dist/index";
import ServerCard from "../components/cards/ServerCard";
import Spinner from "../components/Spinner";
import { Banner } from "../components/Banner";
import { Type } from "../components/Type";
import { initializeApollo } from "../lib/ApolloClient";
import Head from "next/head";

export default function Home(): React.ReactNode {
  const { loading, error, data } = useFindServersQuery({
    client: initializeApollo(),
  });

  const servers = (data?.servers as Server[]) || [];

  const serverCards = servers.map((server) => {
    return <ServerCard server={server} key={server.uuid} />;
  });

  const addServerCard = [
    <Card
      key={"add server"}
      footer={<Button text={"Start a new server"} type={Type.SUCCESS} />}
    />,
  ];

  return (
    <>
      <Head>
        <title>Home | Mira HQ</title>
        <meta name="viewport" content="initial-scale=1.0, width=device-width" />
      </Head>
      <div className="bg-white dark:bg-black min-h-screen w-screen flex">
        <div className={"container mx-auto px-10"}>
          {error && (
            <Banner message={JSON.stringify(error)} type={Type.DANGER} />
          )}
          {loading && <Spinner />}
          <CardList cards={serverCards} />
          <CardList cards={addServerCard} />
        </div>
      </div>
    </>
  );
}
