"use strict";

const { isNode } = require("../../../utils/ProcessChecker");
const { convertToReadStream } = require("../components/convertToReadStream");
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
  return function sendRequest() {
    const __arguments = Array.from(arguments);

    const tryRequest = (cb, errCount = 0) => {
      const { route, port, host } = this.__connectionData();
      const singleFileURL = `${protocol}${host}:${port}/sf${route}/${fn}`;
      const multiFileURL = `${protocol}${host}:${port}/mf${route}/${fn}`;
      const defaultURL = `${protocol}${host}:${port}${route}/${fn}`;
      const { file, files } = __arguments[0] || {};
      const url = file ? singleFileURL : files ? multiFileURL : defaultURL;
      const defaultHeaders = this.headers();
      const headers = !isEmpty(defaultHeaders) ? defaultHeaders : Service.headers();
      if (url === defaultURL) {
        const query =
          method === "get" && isObject(__arguments[0]) ? makeQuery(__arguments[0]) : "";
        httpClient
          .request({
            url: `${url}${query}`,
            method,
            body: { __arguments },
            headers,
          })
          .then((results) => cb(null, results))
          .catch((err) => ErrorHandler(err, errCount, cb));
      } else {
        delete __arguments[0].file;
        delete __arguments[0].files;
        const formData = {};
        formData.__arguments = __arguments;
        if (file) formData.file = isNode ? convertToReadStream(file) : file;
        if (Array.isArray(files))
          formData.files = isNode ? files.map(convertToReadStream) : files;
        httpClient
          .upload({
            url,
            method,
            formData,
            headers,
          })
          .then((results) => cb(null, results))
          .catch((err) => ErrorHandler(err, errCount, cb));
      }
    };

    const ErrorHandler = (err, errCount, cb) => {
      if (!err.isAxiosError) {
        throw err;
      } else if (err.response.data.SystemLynxService) {
        cb(err.response.data);
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
