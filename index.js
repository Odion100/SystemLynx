//These are all the abstractions that make up SystemLynx
const { isNode } = require("./utils/ProcessChecker");
const SystemLynxApp = require("./systemlynx/App/App");
const SystemLynxLoadBalancer = require("./systemlynx/LoadBalancer/LoadBalancer");
const SystemLynxService = require("./systemlynx/Service/Service");
const SystemLynxServerManager = require("./systemlynx/ServerManager/ServerManager");
const SystemLynxClient = require("./systemlynx/Client/Client");
const SystemLynxHttpClient = require("./systemlynx/HttpClient/HttpClient");
const SystemLynxDispatcher = require("./systemlynx/Dispatcher/Dispatcher");

const ServerManager = isNode ? SystemLynxServerManager() : null;
const Service = isNode ? SystemLynxService() : null;
const LoadBalancer = isNode ? SystemLynxLoadBalancer() : null;

const App = SystemLynxApp();
const HttpClient = SystemLynxHttpClient();
const Client = SystemLynxClient();
const Dispatcher = SystemLynxDispatcher();

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
  //all these modules export factory functions
  //to ensure non-singleton behavior
  SystemLynxApp,
  SystemLynxLoadBalancer,
  SystemLynxService,
  SystemLynxClient,
  SystemLynxHttpClient,
  SystemLynxServerManager,
  SystemLynxDispatcher,
};
