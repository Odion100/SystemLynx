"use strict";
import Hooker from "../../../utils/Hooker.mjs";

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
      if (arg.file) {
        if (foundFile)
          throw new Error("Only one file or files allowed across arguments.");
        foundFile = arg.file;
        fileType = "file";
        arg.file = "__file__";
      } else if (arg.files) {
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

export default function ServiceRequestHandler(
  httpClient,
  protocol,
  method,
  fn,
  Service,
  reconnectModule
) {
  return function sendRequest() {
    const self = this;
    const __arguments = Array.from(arguments);
    const stores = self.__middlewareStores || {}; // { namespaced, scoped } (RFC 005)
    const moduleName = self.__name;

    const tryRequest = (cb, errCount = 0) => {
      const { route, port, host } = self.__connectionData();
      const { foundFile, fileType } = extractFilesFromArguments(__arguments);

      // A 2xx that isn't a genuine SystemLynx response means a stranger answered on the
      // port (stale server / proxy) — treat it like a transport failure and reconnect.
      const onResults = (results) =>
        results && results.SystemLynxService
          ? cb(null, results)
          : ErrorHandler({ message: "non-SystemLynx response on this connection" }, errCount, cb);

      const defaultURL = `${protocol}${host}:${port}${route}/${fn}`;
      const url =
        fileType === "file"
          ? `${protocol}${host}:${port}/sf${route}/${fn}`
          : fileType === "files"
          ? `${protocol}${host}:${port}/mf${route}/${fn}`
          : defaultURL;

      const defaultHeaders = self.headers();
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
          .then(onResults)
          .catch((err) => ErrorHandler(err, errCount, cb));
      } else {
        const formData = { __arguments };
        if (fileType === "file") formData.file = foundFile;
        if (fileType === "files") formData.files = foundFile;

        httpClient
          .upload({
            url,
            method,
            formData,
            headers,
          })
          .then(onResults)
          .catch((err) => ErrorHandler(err, errCount, cb));
      }
    };

    const ErrorHandler = (err, errCount, cb) => {
      if (err.SystemLynxService) {
        cb(err);
      } else if (errCount <= 3) {
        errCount++;
        // Reconnect, then retry — but if reconnect itself fails, reject rather than hang.
        const afterReconnect = (reconnectErr) =>
          reconnectErr ? cb(reconnectErr) : tryRequest(cb, errCount);
        if (reconnectModule) reconnectModule(afterReconnect);
        else Service.resetConnection(afterReconnect);
      } else {
        // retries exhausted — reject the original call instead of hanging forever
        console.error(`[SystemLynx][ServiceRequestHandler][Error]: ${err.message}\n`);
        cb(err);
      }
    };

    return new Promise((resolve, reject) => {
      // RFC 005: run the before-chain (client → service instance → module) synchronously before the
      // request reads headers; then send; then run the after-chain on the returned value.
      const before = Hooker.gather("before", stores, moduleName, fn);
      const after = Hooker.gather("after", stores, moduleName, fn);
      Hooker.runChain(before, self, [__arguments])
        .then(() =>
          tryRequest((err, results) => {
            if (err) return reject(err);
            const returnValue = results.returnValue;
            Hooker.runChain(after, self, [returnValue])
              .then(() => resolve(returnValue))
              .catch(reject);
          })
        )
        .catch(reject);
    });
  };
}
