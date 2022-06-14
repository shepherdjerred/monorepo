import autoMergeLevel2 from 'redux-persist/lib/stateReconciler/autoMergeLevel2';
import storage from 'redux-persist/es/storage';
import {rootReducer} from '../reducers';
import {persistReducer} from 'redux-persist';
import {createFilter} from 'redux-persist-transform-filter';

const jwtFilter = createFilter('authentication', ['token'], ['token']);

const persistConfig = {
  key: 'root',
  storage,
  stateReconciler: autoMergeLevel2,
  whitelist: [
    'authentication'
  ],
  transforms: [
    jwtFilter
  ]
};

export const persistedReducer = persistReducer(persistConfig, rootReducer);
