//These are all the abstractions that make up SystemLynx
const { isNode } = require("./utils/ProcessChecker");
const createApp = require("./systemlynx/App/App");
const createLoadBalancer = require("./systemlynx/LoadBalancer/LoadBalancer");
const createService = require("./systemlynx/Service/Service");
const createServerManager = require("./systemlynx/ServerManager/ServerManager");
const createClient = require("./systemlynx/Client/Client");
const createHttpClient = require("./systemlynx/HttpClient/HttpClient");
const createDispatcher = require("./systemlynx/Dispatcher/Dispatcher");

const ServerManager = isNode ? createServerManager() : null;
const Service = isNode ? createService() : null;
const LoadBalancer = isNode ? createLoadBalancer() : null;

const App = createApp();
const HttpClient = createHttpClient();
const Client = createClient();
const Dispatcher = new createDispatcher();

module.exports = {
  //Export these pre-created objects for convenient object destructuring
  //These are the main utilities for app development
  App,
  HttpClient,
  LoadBalancer,
  Client,
  Service,
  ServerManager,
  Dispatcher,
  //export all modules themselves
  //all these modules export a functions
  createApp,
  createLoadBalancer,
  createService,
  createClient,
  createHttpClient,
  createServerManager,
  createDispatcher,
};
