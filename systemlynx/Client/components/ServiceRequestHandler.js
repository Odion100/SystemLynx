"use strict";
const isObject = (value) =>
  typeof value === "object" ? (!value ? false : !Array.isArray(value)) : false;
const isEmpty = (obj) => Object.getOwnPropertyNames(obj).length === 0;
const makeQuery = (data) =>
  Object.getOwnPropertyNames(data).reduce(
    (query, name) => (query += `${name}=${data[name]}&`),
    "?"
  );
module.exports = function ServiceRequestHandler(
  httpClient,
  protocol,
  method,
  fn,
  Service,
  reconnectModule
) {
  const ClientModule = this;
  return function sendRequest() {
    const __arguments = Array.from(arguments);

    const tryRequest = (cb, errCount = 0) => {
      const { route, port, host } = ClientModule.__connectionData();
      const singleFileURL = `${protocol}${host}:${port}/sf${route}/${fn}`;
      const multiFileURL = `${protocol}${host}:${port}/mf${route}/${fn}`;
      const defaultURL = `${protocol}${host}:${port}${route}/${fn}`;
      const { file, files } = __arguments[0] || {};
      const url = file ? singleFileURL : files ? multiFileURL : defaultURL;
      const defaultHeaders = ClientModule.headers();
      const headers = !isEmpty(defaultHeaders) ? defaultHeaders : Service.headers();
      if (url === defaultURL)
        httpClient
          .request({
            url: `${url}${
              method === "get" && isObject(__arguments[0])
                ? makeQuery(__arguments[0])
                : ""
            }`,
            method,
            body: { __arguments },
            headers,
          })
          .then((results) => cb(null, results))
          .catch((err) => ErrorHandler(err, errCount, cb));
      else {
        if (file) delete __arguments[0].file;
        if (files) delete __arguments[0].files;
        httpClient
          .upload({
            url,
            method,
            formData: { file, files, __arguments },
            headers,
          })
          .then((results) => cb(null, results))
          .catch((err) => ErrorHandler(err, errCount, cb));
      }
    };

    const ErrorHandler = (err, errCount, cb) => {
      if (err.SystemLynxService) {
        cb(err);
      } else if (errCount <= 3) {
        errCount++;
        if (reconnectModule) reconnectModule(() => tryRequest(cb, errCount));
        else Service.resetConnection(() => tryRequest(cb, errCount));
      } else {
        console.error(`[SystemLynx][ServiceRequestHandler][Error]: ${err.message}\n`);
        console.error(err);
      }
    };

    return new Promise((resolve, reject) =>
      tryRequest((err, results) => {
        if (err) reject(err);
        else resolve(results.returnValue);
      })
    );
  };
};
