"use strict";
const HttpClient = require("../../HttpClient/HttpClient")();
const isObject = (value) =>
  typeof value === "object" ? (!value ? false : !Array.isArray(value)) : false;

const makeQuery = (data) =>
  Object.getOwnPropertyNames(data).reduce(
    (query, name) => (query += `${name}=${data[name]}&`),
    "?"
  );
module.exports = function ServiceRequestHandler(method, fn, resetConnection) {
  const ClientModule = this;

  return function sendRequest() {
    const __arguments = Array.from(arguments);

    const tryRequest = (cb, errCount = 0) => {
      const { route, port, host } = ClientModule.__connectionData();
      const singleFileURL = `http://${host}:${port}/sf${route}/${fn}`;
      const multiFileURL = `http://${host}:${port}/mf${route}/${fn}`;
      const defaultURL = `http://${host}:${port}${route}/${fn}`;
      const { file, files } = __arguments[0] || {};
      const url = file ? singleFileURL : files ? multiFileURL : defaultURL;

      if (url === defaultURL)
        HttpClient.request({
          url: `${url}${
            method === "get" && isObject(__arguments[0]) ? makeQuery(__arguments[0]) : ""
          }`,
          method,
          body: { __arguments },
        })
          .then((results) => cb(null, results))
          .catch((err) => ErrorHandler(err, errCount, cb));
      else
        HttpClient.upload({
          url,
          method,
          formData: { ...__arguments[0], __arguments },
        })
          .then((results) => cb(null, results))
          .catch((err) => ErrorHandler(err, errCount, cb));
    };

    const ErrorHandler = (err, errCount, cb) => {
      if (err.SystemLynxServiceError) {
        cb(err);
      } else if (errCount <= 3) {
        console.log(err);
        errCount++;
        resetConnection(() => tryRequest(cb, errCount));
      } else throw Error(`(SystemLynxServiceError): Invalid route:${err}`);
    };

    return new Promise((resolve, reject) =>
      tryRequest((err, results) => {
        if (err) reject(err);
        else resolve(results.returnValue);
      })
    );
  };
};
