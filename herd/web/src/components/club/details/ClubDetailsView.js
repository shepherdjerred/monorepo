import React, {Component} from 'react';
import ExtraWideLayout from '../../layout/ExtraWideLayout';
import ClubDetailsContainer from './ClubDetailsContainer';
import PropTypes from 'prop-types';

export default class ClubDetailsView extends Component {
  static propTypes = {
    clubId: PropTypes.string.isRequired
  };

  render () {
    let {clubId} = this.props;
    return (
      <ExtraWideLayout>
        <ClubDetailsContainer clubId={clubId} />
      </ExtraWideLayout>
    );
  }
}
