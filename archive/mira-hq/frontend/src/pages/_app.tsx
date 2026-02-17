import type { AppProps } from "next/app";
import React from "react";
import "tailwindcss/tailwind.css";
import { ApolloProvider } from "@apollo/client";
import { useApollo } from "../lib/ApolloClient";

function MyApp({ Component, pageProps }: AppProps): React.ReactNode {
  const apolloClient = useApollo({});

  return (
    <ApolloProvider client={apolloClient}>
      <Component {...pageProps} />
    </ApolloProvider>
  );
}

export default MyApp;
