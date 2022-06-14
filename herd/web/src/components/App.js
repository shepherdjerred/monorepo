import {store} from '../store/store';
import {HashRouter} from 'react-router-dom';
import {Provider} from 'react-redux';
import React from 'react';
import Footer from './footer/Footer';
import {NavbarContainer} from './navbar/NavbarContainer';
import {RootRouterContaner} from './router/RootRouterContainer';
import {PersistGate} from 'redux-persist/integration/react';
import './App.css';
import LoadingIndicator from './common/loadingIndicator/LoadingIndicator';
import {persistor} from '../store/persistance/persistedStore';

export function App () {
  return (
    <Provider store={store}>
      <PersistGate loading={<LoadingIndicator />} persistor={persistor}>
        <HashRouter>
          <div className='site'>
            <NavbarContainer />
            <div className='site-content'>
              <RootRouterContaner />
            </div>
            <Footer />
          </div>
        </HashRouter>
      </PersistGate>
    </Provider>
  );
}
