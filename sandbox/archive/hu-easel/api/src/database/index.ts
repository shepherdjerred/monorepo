import { Sequelize } from "sequelize-typescript";
import * as log from "loglevel";
import { User } from "../features/users/model";
import Config from "../config/Config";
import { Term } from "../features/terms/model";
import { Listing } from "../features/courses/listings/model";
import { Content } from "../features/courses/contents/model";
import { Course } from "../features/courses/model";

const sequelizeOptions = {
  dialect: "mysql",
  pool: {
    max: 10,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
  operatorsAliases: false,
  logging: log.trace,
};

const models = [User, Listing, Content, Term, Course];

export class Database {
  sequelize?: Sequelize;
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  async initialize() {
    log.info("Trying to initialize sequelize");
    let { config } = this;

    if (this.sequelize) {
      log.error("Sequelize is already initialized");
    } else {
      log.info("Initializing sequelize");
      let { dbHost, dbPort, dbName, dbUsername, dbPassword, dbUrl } = config;
      if (dbUrl) {
        this.sequelize = new Sequelize({
          url: dbUrl,
          ...sequelizeOptions,
        });
      } else {
        this.sequelize = new Sequelize({
          host: dbHost as string,
          port: dbPort as number,
          database: dbName as string,
          username: dbUsername as string,
          password: dbPassword as string,
          ...sequelizeOptions,
        });
      }

      log.info("Adding models");
      this.sequelize.addModels(models);

      log.info("Checking connection");
      await this.sequelize.authenticate();

      log.info("Sequelize has been initialized");
    }
  }

  async sync(force: boolean) {
    let sequelize = this.sequelize as Sequelize;
    log.info("Syncing database models");

    if (force) {
      sequelize.query("SET FOREIGN_KEY_CHECKS = 0");
    }

    for (let model of models) {
      log.info("Syncing model for " + model.getTableName());
      await model.sync({
        force: force,
      });
    }

    if (force) {
      sequelize.query("SET FOREIGN_KEY_CHECKS = 1");
    }

    log.info("Finished syncing database models");
  }

  close(): any {
    if (this.sequelize) {
      log.info("Closing sequelize");
      return this.sequelize.close();
    } else {
      log.error("Sequelize is not initialized");
      return null;
    }
  }
}
