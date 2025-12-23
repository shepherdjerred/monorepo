import * as express from 'express';
import * as morgan from 'morgan';
import * as bodyparser from 'body-parser';
import router from './features/routes';
import { handleError } from './middleware';
import * as cors from 'cors';
import { config } from './dependencies';

export let app = express();

app.use(morgan('dev'));
app.use(bodyparser.json());
app.use(cors({
  origin: config.frontEndUrl,
  optionsSuccessStatus: 200
}));
app.use('/api', router);
app.use(handleError);
