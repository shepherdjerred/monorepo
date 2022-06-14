import {applyMiddleware, compose, createStore} from 'redux';
import {createLogger} from 'redux-logger';
import reduxThunk from 'redux-thunk';
import {rootReducer} from './reducers';

const enhancer = compose(
  applyMiddleware(
    reduxThunk,
    createLogger()
  )
);

const reducer = rootReducer();

export const store = createStore(
  reducer,
  enhancer
);
