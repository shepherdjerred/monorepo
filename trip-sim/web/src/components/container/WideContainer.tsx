import React from "react";
import {SimulationFetcher} from '../simulator/SimulationFetcher'

export const WideContainer = React.memo((props) => {
  return (
      <div className='container'>
        <SimulationFetcher/>
      </div>
  )
});
