import React from 'react';
import { store } from '../../store/store';
import { Provider } from 'react-redux';
import ErrorBoundary from '../ErrorBoundary';
import AppLayout from './AppLayout';
import { BrowserRouter } from 'react-router-dom';

export default function App () {
  return (
    <ErrorBoundary>
      <Provider store={store}>
        <BrowserRouter>
          <AppLayout />
        </BrowserRouter>
      </Provider>
    </ErrorBoundary>
  );
}
