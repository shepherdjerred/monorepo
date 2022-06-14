import React, {Component} from 'react';
import {Link} from 'react-router-dom';
import ClubListContainer from './ClubListContainer';
import NarrowLayout from '../../layout/NarrowLayout';

export default class ClubListView extends Component {
  render () {
    return (
      <NarrowLayout>
        <nav className='level'>
          <div className='level-left'>
            <div className='level-item'>
              <h1 className='title is-1'>Club List</h1>
            </div>
          </div>
          <div className='level-right'>
            <Link className='button is-success' to='/club/create'>Create</Link>
          </div>
        </nav>
        <ClubListContainer />
      </NarrowLayout>
    );
  }
}
