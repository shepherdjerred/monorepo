import React from 'react';
import ReactDOM from 'react-dom';
import '../node_modules/bulma/css/bulma.min.css';
import registerServiceWorker from './registerServiceWorker';
import { App } from './components/App';

ReactDOM.render(<App />, document.getElementById('root'));

registerServiceWorker();
