import React, { Component } from 'react';
import { HashRouter } from 'react-router-dom';
import Router from '../Router';
import Navbar from '../Navbar';
import Footer from '../Footer';
import '../../../../node_modules/bulma/css/bulma.min.css';
import './App.css';

class App extends Component {
  render () {
    return (
      <HashRouter>
        <div className='site'>
          <Navbar />
          <div className='site-content'>
            <Router />
          </div>
          <Footer />
        </div>
      </HashRouter>
    );
  }
}

export default App;
