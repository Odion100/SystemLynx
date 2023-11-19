//These are all the abstractions that make up SystemLynx
const createClient = require("./systemlynx/Client/Client");
const createHttpClient = require("./systemlynx/HttpClient/HttpClient");
const createDispatcher = require("./systemlynx/Dispatcher/Dispatcher");

const HttpClient = createHttpClient();
const Client = createClient();
const Dispatcher = createDispatcher();

module.exports = {
  //Export these pre-created objects for convenient object destructuring
  //These are the main utilities for app development
  HttpClient,
  Client,
  Dispatcher,
  //export all modules themselves
  //all these modules export a functions
  createClient,
  createHttpClient,
  createDispatcher,
};
