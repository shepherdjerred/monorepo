const _ = require('underscore');
const Promise = require('bluebird');
const Client = require('instagram-private-api').V1;

const comments = [
  'Woah!',
  'Nice picture',
  'I miss you!',
  'Wish I was there',
  "You're so cool",
  'I was there!',
  'This is so funny'
];

const username = 'username';
const password = 'password';
const userId = 'userId';
const targetUsername = 'target';

const device = new Client.Device(username);
const storage = new Client.CookieFileStorage(__dirname + '/cookies/cookie.json');

Client.Session.create(device, storage, username, password)
  .then(function (session) {
    let search = Client.Account.searchForUser(session, targetUsername);
    return [session, search];
  })
  .spread(function (session, account) {
    let feed = new Client.Feed.UserMedia(session, account.id);

    Promise.mapSeries(_.range(0, 4), function () {
      return feed.get();
    })
      .then(function (resultsList) {
        console.log('Result list size: ' + resultsList.length);
        resultsList.forEach(function (results) {
          console.log('Results Size: ' + results.length);
          results.forEach(function (post) {
            let hasAlreadyBeenCommentedOn = false;

            post.comments.forEach(function (postComment) {
              if (postComment.account.id === userId) {
                hasAlreadyBeenCommentedOn = true;
              } else {
                // console.log(postComment.account.id);
              }
            });

            if (!hasAlreadyBeenCommentedOn) {
              console.log('Has not been commented on');
              Client.Comment.create(session, post.id, _.shuffle(comments)[0]);
            } else {
              console.log('Has been commented on');
            }
          });
        });
      });
  });
