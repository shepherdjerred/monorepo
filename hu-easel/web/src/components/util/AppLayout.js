import React from 'react';
import NavbarContainer from './navbar/NabarContainer';
import RouterContainer from './router/RouterContainer';

export default function AppLayout () {
  return (
    <div>
      <NavbarContainer />
      <RouterContainer />
    </div>
  );
}
