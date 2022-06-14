import PropTypes from 'prop-types';
import React, {Component} from 'react';
import {Redirect} from 'react-router-dom';

export default class DeleteClub extends Component {
  static propTypes = {
    club: PropTypes.object.isRequired,
    isRequesting: PropTypes.bool,
    error: PropTypes.oneOfType([
      PropTypes.object,
      PropTypes.bool
    ]).isRequired,
    onRequest: PropTypes.func.isRequired,
    history: PropTypes.object.isRequired
  };

  constructor (props) {
    super(props);
    this.state = {
      hasBeenSubmitted: false
    };
  }

  onDelete = () => {
    this.setState({
      hasBeenSubmitted: true
    });
    this.props.onRequest();
  };

  onCancel = () => {
    this.props.history.goBack();
  };

  render () {
    let {club, isRequesting, error} = this.props;
    let {hasBeenSubmitted} = this.state;
    if (hasBeenSubmitted && !isRequesting && !error) {
      return (<Redirect to='/club/list' />);
    }
    return (
      <article className='message is-danger'>
        <div className='message-header'>
          <p>Confirm Action</p>
        </div>
        <div className='message-body'>
          <p className='confirmation-message'>
            Are you sure you want to delete {club.name}? This action cannot be undone.
          </p>
          <nav className='level'>
            <div className='level-left' />
            <div className='level-right'>
              <div className='buttons'>
                <a className='button is-danger' onClick={this.onDelete}>Delete</a>
                <a className='button' onClick={this.onCancel}>Cancel</a>
              </div>
            </div>
          </nav>
        </div>
      </article>
    );
  }
}
