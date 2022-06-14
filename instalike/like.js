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

const username = '';
const password = '';
const targetUsername = '';

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
                resultsList.forEach(function (results) {
                    console.log(results);
                    results.forEach(function (post) {
                        new Client.Request(session)
                            .setMethod('POST')
                            .setResource('like', {id: post.id})
                            .generateUUID()
                            .setData({
                                media_id: post.id,
                                src: "profile"
                            })
                            .signPayload()
                            .send()
                            .then(function (data) {
                                return new Client.Like(session, {});
                            })
                    });
                });
            });
    });
