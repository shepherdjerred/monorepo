import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { NavLink } from 'react-router-dom';

export default class TermList extends Component {
  static propTypes = {
    terms: PropTypes.object
  };

  renderTermList () {
    const {terms} = this.props;
    return Object.keys(terms).map(key => {
      const term = terms[key].data;
      console.log(term);
      return (
        <tr key={key}>
          {Object.keys(term).map(i => {
            return <td key={i}>{term[i]}</td>;
          })}
        </tr>
      );
    });
  }

  render () {
    return (
      <div>
        <h1>Terms</h1>
        <NavLink to='/terms/create'>Create</NavLink>
        <table>
          <thead>
            <tr>
              <th>UUID</th>
              <th>Type</th>
              <th>Start Date</th>
              <th>End Date</th>
            </tr>
          </thead>
          <tbody>
            {this.renderTermList()}
          </tbody>
        </table>
      </div>
    );
  }
}
