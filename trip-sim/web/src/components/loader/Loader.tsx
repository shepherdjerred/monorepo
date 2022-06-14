import React, {FunctionComponent, Fragment} from "react";

type LoaderProps = {
  isLoading: boolean
}

export const Loader: FunctionComponent<LoaderProps> = ({isLoading, children}) => {
  if (isLoading) {
    return (
        <h1>
          I'm loading!
        </h1>
    )
  } else {
    return (
        <Fragment>
          {children}
        </Fragment>
    )
  }
};
