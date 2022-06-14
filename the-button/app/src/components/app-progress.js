import React, { Component } from 'react';
import { View, StyleSheet } from 'react-native';
import PropTypes from 'prop-types';
import * as util from '../util';

export default class AppButton extends Component {
  render () {
    return (
      <View style={[
        this.stylesheet.background
      ]}>
        <View style={[
          this.stylesheet.fill
        ]}/>
      </View>
    );
  }

  stylesheet = StyleSheet.create({
    background: {
      height: 10,
      alignSelf: 'stretch',
      backgroundColor: '#DBDBDB',
      borderRadius: util.vw(75) / 2
    },
    fill: {
      height: 10,
      backgroundColor: '#4A4A4A',
      width: this.props.value / this.props.max * 100 + '%',
      borderRadius: 100,
      borderTopRightRadius: 0,
      borderBottomRightRadius: 0
    }
  });
}

AppButton.propTypes = {
  value: PropTypes.number.isRequired,
  max: PropTypes.number.isRequired
};
