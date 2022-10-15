//These are all the abstractions that make up SystemLynx
const { isNode } = require("./utils/ProcessChecker");
const AppFactory = require("./systemlynx/App/App");
const LoadBalancerFactory = require("./systemlynx/LoadBalancer/LoadBalancer");
const ServiceFactory = require("./systemlynx/Service/Service");
const ServerManagerFactory = require("./systemlynx/ServerManager/ServerManager");
const ClientFactory = require("./systemlynx/Client/Client");
const HttpClientFactory = require("./systemlynx/HttpClient/HttpClient");
const DispatcherFactory = require("./systemlynx/Dispatcher/Dispatcher");

const ServerManager = isNode ? ServerManagerFactory() : null;
const Service = isNode ? ServiceFactory() : null;
const LoadBalancer = isNode ? LoadBalancerFactory() : null;

const App = AppFactory();
const HttpClient = HttpClientFactory();
const Client = ClientFactory();
const Dispatcher = DispatcherFactory();

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
  AppFactory,
  LoadBalancerFactory,
  ServiceFactory,
  ClientFactory,
  HttpClientFactory,
  ServerManagerFactory,
  DispatcherFactory,
};
