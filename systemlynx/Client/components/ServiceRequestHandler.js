"use strict";

const { isNode } = require("../../../utils/ProcessChecker");
const { convertToReadStream } = require("./convertToReadStream");
const isObject = (value) =>
  typeof value === "object" ? (!value ? false : !Array.isArray(value)) : false;
const isEmpty = (obj) => Object.getOwnPropertyNames(obj).length === 0;
const makeQuery = (data) =>
  Object.getOwnPropertyNames(data).reduce(
    (query, name) => (query += `${name}=${data[name]}&`),
    "?"
  );

const extractFilesFromArguments = (__arguments) => {
  let foundFile = null;
  let fileType = null;

  __arguments.forEach((arg) => {
    if (isObject(arg)) {
      if ("file" in arg) {
        if (foundFile)
          throw new Error("Only one file or files allowed across arguments.");
        foundFile = arg.file;
        fileType = "file";
        arg.file = "__file__";
      } else if ("files" in arg) {
        if (foundFile)
          throw new Error("Only one file or files allowed across arguments.");
        foundFile = arg.files;
        fileType = "files";
        arg.files = "__files__";
      }
    }
  });

  return { foundFile, fileType };
};

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
      const { foundFile, fileType } = extractFilesFromArguments(__arguments);

      const defaultURL = `${protocol}${host}:${port}${route}/${fn}`;
      const url =
        fileType === "file"
          ? `${protocol}${host}:${port}/sf${route}/${fn}`
          : fileType === "files"
          ? `${protocol}${host}:${port}/mf${route}/${fn}`
          : defaultURL;

      const defaultHeaders = this.headers();
      const headers = !isEmpty(defaultHeaders) ? defaultHeaders : Service.headers();

      if (!foundFile) {
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
        const formData = { __arguments };
        if (fileType === "file")
          formData.file = isNode ? convertToReadStream(foundFile) : foundFile;
        if (fileType === "files")
          formData.files = isNode ? foundFile.map(convertToReadStream) : foundFile;

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
