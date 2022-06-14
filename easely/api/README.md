# api

[![Build Status](https://travis-ci.org/Easely/api.svg?branch=master)](https://travis-ci.org/Easely/api)

## About
Easely API provides a HTTP API that allows you to view data from the Harding CS EASEL homework submission site.

## Technical details
The API is written in Java with the Spark Framework. It uses Jsoup to scrape EASEL and retrieve data. MySQL is used for user storage, and redis for caching EASEL information so that we can minimize our traffic to the actual EASEL site.

## Deploying
The Easely API was made to deploy with Dokku.

### Enviornment variables
In order for Easely API to run, certain envoriment variables must first be defined

* JWT_SECRET
* SENTRY_DSN
* DATABASE_URL
* REDIS_URL

## Using the API
API documentation can be found on the [project wiki](https://github.com/Easely/api/wiki)
