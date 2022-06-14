import PropTypes from 'prop-types';
import React, {Component} from 'react';
import NarrowLayout from '../../layout/NarrowLayout';
import DeleteClubContainer from './DeleteClubContainer';

export default class DeleteClubView extends Component {
  render () {
    let {clubId} = this.props;
    return (
      <NarrowLayout>
        <DeleteClubContainer clubId={clubId} />
      </NarrowLayout>
    );
  }
}

DeleteClubView.propTypes = {
  clubId: PropTypes.string.isRequired
};
