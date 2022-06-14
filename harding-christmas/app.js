import './src/scss/main.scss';
import './node_modules/normalizecss/normalize.css';

import countdownJS from './node_modules/countdown/countdown';
import particlesJS from './node_modules/particlesjs/dist/particles.js';

var lightingDate = new Date(2018, 10, 26, 19);
var date = new Date();
var year = date.getFullYear();
var christmasThisYear = new Date(year, 11, 25);

var countdownDate;

if (date > lightingDate) {
  countdownDate = christmasThisYear;
  document.getElementById('title').innerText = 'Countdown to Christmas';
} else {
  countdownDate = lightingDate;
  document.getElementById('title').innerText = 'Countdown to Lighting Ceremony'
}

countdownJS(
  countdownDate,
  function (ts) {
    document.getElementById('daysValue').innerHTML = ts.days;
    document.getElementById('hoursValue').innerHTML = ts.hours;
    document.getElementById('minutesValue').innerHTML = ts.minutes;
    document.getElementById('secondsValue').innerHTML = ts.seconds;
  },
  countdownJS.DAYS | countdownJS.HOURS | countdownJS.MINUTES | countdownJS.SECONDS);

particlesJS.load('background', 'particles.json', function() {
  console.log('callback - particles.js config loaded');
});
