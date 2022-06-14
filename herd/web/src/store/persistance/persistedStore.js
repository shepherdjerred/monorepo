import {store} from '../store';
import {persistStore} from 'redux-persist';

export const persistor = persistStore(store);
