import WebSocket from 'ws';
import * as hue from 'node-hue-api';
import * as dotenv from 'dotenv';
import low from 'lowdb';
import FileSync from 'lowdb/adapters/FileSync';

dotenv.config();
const adapter = new FileSync('db.json');
const db = low(adapter);

let lastColor;
let colorBeforePause;

db.defaults({
  hue: {
    username: null
  }
});

(async function main() {
  let hueApi;
  try {
    hueApi = await connectToHue();
  } catch (err) {
    console.error('Error connecting to Hue bridge');
    console.error(err);
    return;
  }
  if (hueApi) {
    const lights = await getLights(hueApi);
    await listenForEvents(hueApi, lights);
  } else {
    console.error('Hue API not created');
    process.exit(1);
  }
})();

function saveUsername(username) {
  return db.set('hue.username', username).write();
}

function loadUsername() {
  return db.get('hue.username').value();
}

async function getUsername(host) {
  let username = loadUsername();
  if (!username) {
    try {
      const hueApi = new hue.HueApi();
      username = await hueApi.registerUser(host, 'huesaber');
      console.log('Registered user');
      console.log(username);
      saveUsername(username);
    } catch (err) {
      console.error(err);
    }
  }
  return username;
}

async function getBridge() {
  try {
    const bridges = await hue.nupnpSearch();
    console.log('Bridges found');
    console.log(bridges);
    return bridges[0];
  } catch (err) {
    console.error(err);
  }
}

async function testBridgeConnection(hueApi) {
  try {
    const config = await hueApi.config();
    console.log('Connected to bridge');
    console.log(config);

    const fullState = await hueApi.getFullState();
    console.log(fullState);
  } catch (err) {
    console.error(err);
  }
}

async function connectToHue() {
  const bridge = await getBridge();
  const {ipaddress} = bridge;
  const username = await getUsername(ipaddress);

  const hueApi = new hue.HueApi(ipaddress, username);
  // await testBridgeConnection(hueApi);
  return hueApi;
}

async function getLights(hueApi) {
  try {
    const lights = await hueApi.lights();
    // console.log(lights);
    // await setRed(hueApi, lights.lights[0].id, false);
    // await setBlue(hueApi, lights.lights[0].id, false);
    return lights;
  } catch (err) {
    console.error(err);
  }
}

async function setColor(hueApi, lightId, fade, color) {
  let state;
  state = hue.lightState.create().on(true).rgb(color.r, color.g,
      color.b).brightness(100).transition(100);
  let result = await hueApi.setLightState(lightId, state);
  if (fade) {
    state = hue.lightState.create().on(true).rgb(color.r, color.g,
        color.b).brightness(0).transition(1000);
    result = await hueApi.setLightState(lightId, state);
  }
  return result;
}

async function setRed(hueApi, lightId, fade) {
  lastColor = 'red';
  await setColor(hueApi, lightId, fade, {r: 255, g: 0, b: 0});
}

async function setBlue(hueApi, lightId, fade) {
  lastColor = 'blue';
  await setColor(hueApi, lightId, fade, {r: 0, g: 0, b: 255});
}

async function setBlank(hueApi, lightId) {
  lastColor = 'blank';
  let state;
  state = hue.lightState.create().brightness(0).off().transition(1000);
  await hueApi.setLightState(lightId, state);
}

async function setBright(hueApi, lightId) {
  let state = hue.lightState.create().on(true).scene('bright');
  await hueApi.setLightState(lightId, state);
}

function processHello() {
  console.log('Connected to beatsaver-http-status');
}

async function processBeatmapEvent(hueApi, light, data) {
  console.log(data);
  const {type, value} = data.beatmapEvent;
  if (type < 5) {
    switch (value) {
      case 0:
        await setBlank(hueApi, light.id);
        break;
      case 1:
      case 2:
        await setBlue(hueApi, light.id, false);
        break;
      case 3:
        await setBlue(hueApi, light.id, true);
        break;
      case 4:
        // Unused?
        break;
      case 5:
      case 6:
        await setRed(hueApi, light.id, false);
        break;
      case 7:
        await setRed(hueApi, light.id, true);
        break;
      default:
    }
  }
}

async function processFinishedEvent(hueApi, light) {
  await setBright(hueApi, light.id);
}

async function processStartEvent(hueApi, light) {
  await setBlank(hueApi, light.id);
}

async function processPauseEvent(hueApi, light) {
  colorBeforePause = lastColor;
  await setBlank(hueApi, light.id);
}

async function processResumeEvent(hueApi, light) {
  switch (colorBeforePause) {
    case 'blue':
      await setBlue(hueApi, light.id, true);
      break;
    case 'red':
      await setRed(hueApi, light.id, true);
      break;
    case 'blank':
      await setBlank(hueApi, light.id);
      break;
  }
}

async function listenForEvents(hueApi, lights) {
  const {SOCKET_URL} = process.env;

  console.log('Connecting to beatsaver-http-status');

  const ws = new WebSocket(SOCKET_URL);

  ws.onmessage = data => {
    // console.log(data);
    data = JSON.parse(data.data);
    try {
      switch (data.event) {
        case 'hello':
          processHello(data);
          break;
        case 'beatmapEvent':
          for (let light in lights) {
            processBeatmapEvent(hueApi, light, data);
          }
          break;
        case 'finished':
          console.log('Finished song');
          for (let light in lights) {
            processFinishedEvent(hueApi, light);
          }
        case 'songStart':
          console.log('Starting song');
          for (let light in lights) {
            processStartEvent(hueApi, light);
          }
          break;
        case 'pause':
          console.log('Pausing song');
          for (let light in lights) {
            processPauseEvent(hueApi, light);
          }
          break;
        case 'resume':
          console.log('Resuming song');
          for (let light in lights) {
            processResumeEvent(hueApi, light);
          }
      }
    } catch (err) {
      console.error(err);
    }
  };
}
