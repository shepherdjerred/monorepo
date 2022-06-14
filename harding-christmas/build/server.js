const express = require('express');
const app = express();

const port = process.env.PORT || 3000;

app.use(express.static('dist'));

app.get('/', function (req, res) {
  res.sendfile('./dist/html/index.html');
});

app.listen(port, function () {
  console.log('Site started on port ' + port);
});
