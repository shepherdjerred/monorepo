import PropTypes from 'prop-types';
import React, {Component} from 'react';
import WithLoading from '../../common/WithLoading';
import EditClub from './EditClub';

const EditWithLoading = WithLoading(EditClub);

class LoadingEditClub extends Component {
  componentDidMount () {
    this.props.onFetchClub();
  }

  render () {
    return (
      <EditWithLoading isFetching={this.props.isFetching} error={this.props.isEditError} club={this.props.club}
        onSave={this.props.onSave} />
    );
  }
}

LoadingEditClub.propTypes = {
  isFetching: PropTypes.bool,
  // error: PropTypes.object,
  club: PropTypes.object,
  onFetchClub: PropTypes.func.isRequired,
  onSave: PropTypes.func.isRequired,
  // isEditFetching: PropTypes.bool,
  isEditError: PropTypes.oneOfType([
    PropTypes.object,
    PropTypes.bool
  ]).isRequired
};

export default LoadingEditClub;
