import React from "react";
import ReactDOM from "react-dom";
import Home from "./components/Home";
import "bulma/bulma.sass";
import Footer from "./components/Footer";

ReactDOM.render(
  <React.StrictMode>
    <div className="wrapper">
      <Home />
    </div>
    <Footer />
  </React.StrictMode>,
  document.getElementById("root"),
);
