# Funsheet

[![Build Status](https://travis-ci.org/ShepherdJerred/funsheet.svg?branch=master)](https://travis-ci.org/ShepherdJerred/funsheet)

## About

Funsheet is a web app for finding things to do. It's an easy way to add activities, and then search for them based on factors such as location and cost.

The backend is written in Java. It uses the following libraries

- Spark Framework
- HikariCP
- FluentJDBC
- Flyway
- Jackson (Core, databind, annotations)
- Lombok

The frontend is written in Vue. It uses the following libraries/resources

- Buefy
- Vuex
- Vue Router
- Vue Resource
- Fuse

## Features

- Add activities, features, types, and tags
- Fuzzy searching for activites
- Responsive interface

## Deploying

Funsheet was made to be deployed on Heroku. All that is needed is the JawsDB addon, the rest will be taken care of automatically. It can also run off of any other MySQL database by editing the hikari.properties file.

## Development

To avoid the pain of running a MySQL server while working on the front-end, there is also an InMemoryStore class which can be used. To use it, call setupInMemoryStorage rather than setupMysqlStorage in the main function. To add mock data to either store, call the createMockData method.

## Reflection

This application is the first REST API I've written, and the first 'real' web application I've made. The code is very messy, and there is plenty to be improved upon. I created this application as a way to keep track of things to do with friends while at college; we were originally using a Google Sheets document, and I decieded to make something better. The bulk of it was written over the course of about a month, doing little pieces at a time.

If I had the motiviation to redo the application (which I don't, it serves its purpose well enough and my time is better spent working on other projects), I would do a lot of things differently. I definately wouldn't use FluentJDBC. It makes code a lot cleaner, but it also greatly restricts what you can do.

I learned a lot from writing this application. While the code itself is a bit messy, I believe the REST API that resulted is perfect (or at least near perfect). I believe I did a decently job with the storage layer of the application, although it does have some rough edges. I'll likely adopt the same approach with future projects. Parsing JSON is incredibly easy with Jackson, but I don't like what feels like magic. I'll still use Jackson, but I need to know how it actually works.

![Screenshot](https://i.imgur.com/Ogj1qN2.png)
