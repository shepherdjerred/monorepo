import { useMemo } from "react";
import {
  ApolloCache,
  ApolloClient,
  HttpLink,
  InMemoryCache,
} from "@apollo/client";
import ApplicationState from "./ApplicationState";

let apolloClient: ApolloClient<ApplicationState>;

const endpoint = "https://api.mira-hq.com/";
function createApolloClient(): ApolloClient<ApplicationState> {
  return new ApolloClient<ApplicationState>({
    ssrMode: typeof window === "undefined", // set to true for SSR
    link: new HttpLink({
      uri: endpoint,
    }),
    cache: new InMemoryCache() as ApolloCache<ApplicationState>,
  });
}

export function initializeApollo(
  initialState: ApplicationState = {}
): ApolloClient<ApplicationState> {
  const _apolloClient = apolloClient ?? createApolloClient();

  if (initialState) {
    // Get existing cache, loaded during client side data fetching
    const existingCache = _apolloClient.extract();

    // Restore the cache using the data passed from
    // getStaticProps/getServerSideProps combined with the existing cached data
    _apolloClient.cache.restore({ ...existingCache, ...initialState });
  }

  // For SSG and SSR always create a new Apollo Client
  if (typeof window === "undefined") return _apolloClient;

  // Create the Apollo Client once in the client
  if (!apolloClient) apolloClient = _apolloClient;
  return _apolloClient;
}

export function useApollo(
  initialState: ApplicationState = {}
): ApolloClient<ApplicationState> {
  return useMemo<ApolloClient<ApplicationState>>(
    () => initializeApollo(initialState),
    [initialState]
  );
}
