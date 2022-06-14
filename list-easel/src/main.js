require('dotenv').config();
const log = require('loglevel');
const request = require('request-promise-native');
const tough = require('tough-cookie');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

log.setLevel('info');

let username = process.env.USERNAME;
let password = process.env.PASSWORD;

log.info('Logging in with ' + username + ' and ' + password);

(async () => {
  const cookies = await fetchCookies();
  const classes = await getClasses(cookies, 182, 500);
  log.info(classes);
  classes.forEach(course => {
    log.info('https://cs.harding.edu/easel/cgi-bin/class?id=' + course);
  });
})();

async function getClasses (cookies, start, end) {
  const classes = [];
  let emptyClasses = 0;
  for (let i = start; i < end; i++) {
    const res = await request.get('https://cs.harding.edu/easel/cgi-bin/class?id=' + i, {
      resolveWithFullResponse: true,
      jar: cookies
    });

    const dom = new JSDOM(res.body);

    const error = dom.window.document.querySelector('.error');

    if (error) {
      if (error.textContent === 'Missing required information') {
        // Class probably doesn't exist
        log.info('Nonexistent class');
        if (emptyClasses < 3) {
          emptyClasses++;
        } else {
          break;
        }
      } else if (error.textContent === 'User not authorized to use this page') {
        // User not in this class
        log.info('User not in ' + i);
        continue;
      }
    }

    log.info('Adding class ' + i);
    classes.push(i);
  }
  return classes;
}

async function fetchCookies () {
  try {
    const res = await request.post('https://cs.harding.edu/easel/cgi-bin/proc_login', {
      form: {
        user: username,
        passwd: password
      },
      simple: false,
      resolveWithFullResponse: true
    });

    const cookies = res.headers['set-cookie'];
    const cookiesObj = tough.Cookie.parse(cookies[0]);
    const cookieJar = request.jar();
    cookieJar.setCookie(cookiesObj, 'https://cs.harding.edu');
    return cookieJar;
  } catch (err) {
    log.error(err);
  }
}
