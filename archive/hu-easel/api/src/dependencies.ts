import { Database } from './database';
import SimpleConfig from './config/SimpleConfig';
import Config from './config/Config';
import EnvConfig from './config/EnvConfig';
import HerokuConfig from './config/HerokuConfig';

export let config: Config;

if (process.env.IS_TRAVIS) {
  config = new EnvConfig();
} else if (process.env.IS_HEROKU) {
  config = new HerokuConfig();
} else {
  config = new SimpleConfig(
    true,
    true,
    'localhost',
    'easel',
    'password',
    32768,
    'root',
    8080,
    'localhost',
    'secret',
    true,
    true,
    false,
    'http://localhost:3000');
}

export let database = new Database(config);
