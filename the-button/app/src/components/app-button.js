import React, {Component} from 'react';
import {StyleSheet, TouchableWithoutFeedback, View} from 'react-native';
import PropTypes from 'prop-types';
import * as util from '../util';

export default class AppButton extends Component {
  constructor (props) {
    super(props);
    this.state = {
      isPressed: false
    };
  }

  handlePressIn () {
    this.setState(previousState => {
      previousState.isPressed = true;
      return previousState;
    });
  }

  handlePressOut () {
    this.props.handlePress();
    this.setState(previousState => {
      previousState.isPressed = false;
      return previousState;
    });
  }

  render () {
    return (
      <TouchableWithoutFeedback onPressIn={this.handlePressIn.bind(this)}
        onPressOut={this.handlePressOut.bind(this)}>
        <View>
          <View
            style={[
              this.stylesheet.buttonLayer,
              this.stylesheet.buttonShadow
            ]}>
          </View>
          <View
            style={[
              this.stylesheet.buttonLayer,
              this.stylesheet.buttonDepth
            ]}>
          </View>
          <View
            style={[
              this.stylesheet.buttonLayer,
              this.stylesheet.buttonTop,
              this.state.isPressed ? this.stylesheet.buttonTopPushed : this.stylesheet.buttonTopUnpushed
            ]}>
          </View>
        </View>
      </TouchableWithoutFeedback>
    );
  }

  stylesheet = StyleSheet.create({
    buttonLayer: {
      height: util.vw(50),
      width: util.vw(50),
      borderRadius: util.vw(50) / 2,
      padding: 20,
      position: 'absolute'
    },
    buttonTop: {
    },
    buttonTopUnpushed: {
      backgroundColor: 'rgb(232, 69, 69)'
    },
    buttonTopPushed: {
      backgroundColor: 'rgb(227, 29, 29)'
    },
    buttonDepth: {
      backgroundColor: 'rgb(187, 23, 23)',
      top: 15
    },
    buttonShadow: {
      backgroundColor: 'rgb(209, 209, 209)',
      top: 20
    }
  });
}

AppButton.propTypes = {
  handlePress: PropTypes.func.isRequired
};
