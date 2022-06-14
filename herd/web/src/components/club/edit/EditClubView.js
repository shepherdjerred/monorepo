import PropTypes from 'prop-types';
import React, {Component} from 'react';
import EditClubContainer from './EditClubContainer';

export default class EditClubView extends Component {
  render () {
    let clubId = this.props.match.params.id;
    return (
      <div>
        <div className='container'>
          <div className='columns'>
            <div className='column is-three-fifths is-offset-one-fifth'>
              <EditClubContainer id={clubId} />
            </div>
          </div>
        </div>
      </div>
    );
  }
}

EditClubView.propTypes = {
  match: PropTypes.object.isRequired
};
