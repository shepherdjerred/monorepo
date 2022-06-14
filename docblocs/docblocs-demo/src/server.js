const app = require('./index');

let port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log('Now listening on port ' + port);
});
