// These are all the abstractions that make up SystemLynx
import _createClient from "./systemlynx/Client/Client.mjs";
import _createHttpClient from "./systemlynx/HttpClient/HttpClient.mjs";
import _createDispatcher from "./systemlynx/Dispatcher/Dispatcher.mjs";

export const HttpClient = _createHttpClient();
export const Client = _createClient();
export const Dispatcher = new _createDispatcher();
export const createClient = _createClient;
export const createHttpClient = _createHttpClient;
export const createDispatcher = _createDispatcher;

export default {
  // Export these pre-created objects for convenient object destructuring
  // These are the main utilities for app development
  HttpClient,
  Client,
  Dispatcher,
  // Export all modules themselves
  // All these modules export functions
  createClient,
  createHttpClient,
  createDispatcher,
};
