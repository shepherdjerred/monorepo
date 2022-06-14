import React from 'react';
import {CreateClubFormContainer} from './FormContainer';

export function CreateClubView () {
  return (
    <div>
      <div className='container'>
        <div className='columns'>
          <div className='column is-one-third is-offset-one-third'>
            <h1 className='title is-1'>Create Club</h1>
            <CreateClubFormContainer />
          </div>
        </div>
      </div>
    </div>
  );
}
