import { Dimensions } from 'react-native';

export function vw (percentageWidth) {
  return Dimensions.get('window').width * (percentageWidth / 100);
}

export function vh (percentageHeight) {
  return Dimensions.get('window').height * (percentageHeight / 100);
}
