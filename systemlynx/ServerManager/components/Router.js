const isObject = (value) =>
  typeof value === "object" ? (!value ? false : !Array.isArray(value)) : false;
const isEmpty = (obj) => Object.getOwnPropertyNames(obj).length === 0;
const isPromise = (p) => typeof p === "object" && typeof (p || {}).then === "function";

module.exports = function createRouter(server, config) {
  const addService = (
    Module,
    route,
    { fn, method },
    module_name,
    beforeware,
    afterware
  ) => {
    server[method](
      [`/${route}/${fn}`, `/sf/${route}/${fn}`, `/mf/${route}/${fn}`],
      (req, res, next) => {
        req.module_name = module_name;
        req.fn = fn;
        req.Module = Module;
        req.module = Module;
        next();
      },
      parseRequest,
      beforeware,
      handleRequest,
      afterware,
      sendResponseMiddleware
    );
  };

  const addREST = (Module, route, { method }, module_name, beforeware, afterware) => {
    server[method](
      [`/${route}`],
      (req, res, next) => {
        req.module_name = module_name;
        req.fn = method;
        req.Module = Module;
        req.module = Module;
        next();
      },
      parseRequest,
      beforeware,
      handleRequest,
      afterware,
      sendResponseMiddleware
    );
  };

  const parseRequest = (req, res, next) => {
    const { fn, module_name, query, file, files, body, method, Module } = req;

    const { serviceUrl } = config();
    const presets = { serviceUrl, module_name, fn };
    const unhandledMessage = `[SystemLynx]: handled error While calling ${module_name}.${fn}(...)`;

    const sendError = (error) => {
      const status = (error || {}).status || 500;
      const message = (error || {}).message || unhandledMessage;
      res.status(status).json({
        ...presets,
        ...error,
        status,
        message,
        SystemLynxService: true,
      });
    };

    const sendResponse = (returnValue) => {
      req.returnValue = returnValue;
      sendResponseMiddleware(req, res);
    };

    if (typeof Module[fn] !== "function")
      return sendResponse({
        message: `[SystemLynx][Router][Error]:${module_name}.${fn} method not found`,
        status: 404,
      });

    const getArguments = () => {
      const args = body.__arguments || [];
      if (!isEmpty(query) && !args.length) args.push(query);
      if (isObject(args[0]) && method === "POST")
        args[0] = { ...args[0], ...(file && { file }), ...(files && { files }) };
      return args;
    };
    req.arguments = getArguments();
    req.presets = presets;
    res.sendError = sendError;
    res.sendResponse = sendResponse;
    next();
  };

  const sendResponseMiddleware = (req, res, next) => {
    const returnValue = req.returnValue;
    const presets = req.presets;
    const { module_name, fn } = req;

    const status = (returnValue || {}).status >= 100 ? returnValue.status : 200;
    if (status < 400) {
      res.status(status).json({
        ...presets,
        status,
        message:
          (returnValue || {}).message ||
          `[SystemLynx][response]: ${module_name}.${fn}(...) returned successfully`,
        returnValue,
      });
    } else {
      const unhandledMessage = `[SystemLynx]: handled error While calling ${module_name}.${fn}(...)`;
      const error = returnValue;
      const errorStatus = (error || {}).status || 500;
      const message = (error || {}).message || unhandledMessage;
      res.status(errorStatus).json({
        ...presets,
        ...error,
        status: errorStatus,
        message,
        SystemLynxService: true,
      });
    }

    // Call next if it exists (needed for middleware chaining)
    if (next) next();
  };

  const handleRequest = (req, res, next) => {
    const { fn, Module } = req;
    const { sendError } = res;

    try {
      const args = req.arguments;
      const results = Module[fn].apply({ ...Module, req, res }, args);

      if (isPromise(results)) {
        results
          .then((result) => {
            req.returnValue = result;
            next();
          })
          .catch(sendError);
      } else {
        req.returnValue = results;
        next();
      }
    } catch (error) {
      sendError(error);
    }
  };

  return { addService, addREST };
};
