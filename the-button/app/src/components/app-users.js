import React, { Component } from 'react';
import { Text, View, StyleSheet } from 'react-native';

export default class AppUsers extends Component {

  constructor (props) {
    super(props);
  }

  generateConnectedUsersPhrase () {
    if (this.props.users < 2) {
      return 'There are no other users here now';
    } else if (this.props.users === 2) {
      return 'There is ' + (this.props.users - 1) + ' other user here now';
    } else {
      return 'There are ' + (this.props.users - 1) + ' other users here now';
    }
  }

  render () {
    return (
      <View>
        <Text>{this.generateConnectedUsersPhrase()}</Text>
      </View>
    );
  }

  styles = StyleSheet.create({
  });
}
