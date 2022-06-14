import React, {Component} from 'react';
import {Text, View, ActivityIndicator, StyleSheet} from 'react-native';
import AppButton from './components/app-button';
import AppProgress from './components/app-progress';
import io from 'socket.io-client';
import AppUsers from './components/app-users';
import * as util from './util';

export default class App extends Component {
  socket;

  constructor () {
    super();

    this.state = {
      counter: undefined,
      users: undefined,
      connected: false,
      error: undefined
    };

    this.socket = io('https://the-button-api.herokuapp.com/');

    this.socket.on('connect', () => {
      this.setState((previousState) => {
        previousState.connected = true;
        return previousState;
      });
    });

    this.socket.on('counterStatus', (data) => {
      this.setState({counter: data});
    });

    this.socket.on('connectedUsers', (data) => {
      this.setState({users: data});
    });

    this.socket.on('error', (error) => {
      console.log(error);
      this.handleError(error);
    });

    this.socket.on('connect_error', (error) => {
      console.log(error);
      error.message = 'Error connecting to server';
      this.handleError(error);
    });

    this.socket.on('connect_timeout', (error) => {
      console.log(error);
      error.message = 'Connection to server timed out';
      this.handleError(error);
    });

    this.socket.emit('getCounter');
    this.socket.emit('getConnectedUsers');
  }

  handleError (error) {
    this.setState((previousState) => {
      previousState.error = error;
      return previousState;
    });
  }

  handlePress () {
    this.socket.emit('incrementCounter');
  }

  render () {
    if (this.state.error) {
      return (
        <View style={[
          this.stylesheet.center
        ]}>
          <Text>{this.state.error.message}</Text>
        </View>
      );
    } else {
      if (this.state.counter && this.state.users) {
        return (
          <View style={[
            this.stylesheet.center
          ]}>
            <View style={{
              paddingBottom: util.vw(50)
            }}>
              <AppButton handlePress={this.handlePress.bind(this)}/>
            </View>
            <View style={{
              width: util.vw(50),
              paddingTop: 40
            }}>
              <AppProgress value={this.state.counter.currentValue} max={this.state.counter.maxValue}/>
            </View>
            <View style={{
              paddingTop: 20
            }}>
              <AppUsers users={this.state.users}/>
            </View>
          </View>
        );
      } else {
        if (this.state.connected) {
          return (
            <View style={[
              this.stylesheet.center
            ]}>
              <ActivityIndicator size="large"/>
              <Text>Loading...</Text>
            </View>
          );
        } else {
          return (
            <View style={[
              this.stylesheet.center
            ]}>
              <ActivityIndicator size="large"/>
              <Text>Connecting to server; this may take a few seconds</Text>
            </View>
          );
        }
      }
    }
  }

  stylesheet = StyleSheet.create({
    center: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center'
    }
  });
}
