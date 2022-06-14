const express = require('express');

let app = express();
app.use(express.static('dist'));

let port = process.env.PORT || 80;

app.listen(port);

console.log('App started on ' + port);
