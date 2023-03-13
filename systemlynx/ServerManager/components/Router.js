const isObject = (value) =>
  typeof value === "object" ? (!value ? false : !Array.isArray(value)) : false;
const isEmpty = (obj) => Object.getOwnPropertyNames(obj).length === 0;
const isPromise = (p) => typeof p === "object" && typeof (p || {}).then === "function";

module.exports = function createRouter(server, config) {
  const addService = (Module, route, { fn, method }, module_name) => {
    server[method](
      [`/${route}/${fn}`, `/sf/${route}/${fn}`, `/mf/${route}/${fn}`],
      (req, res, next) => {
        req.module_name = module_name;
        req.fn = fn;
        req.Module = Module;
        next();
      },
      routeHandler
    );
  };

  const addREST = (Module, route, { method }, module_name) => {
    server[method](
      [`/${route}`],
      (req, res, next) => {
        req.module_name = module_name;
        req.fn = method;
        req.Module = Module;
        next();
      },
      routeHandler
    );
  };

  const routeHandler = (req, res) => {
    const { query, file, files, body, fn, Module, module_name, method } = req;
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
      const status = (returnValue || {}).status || 200;
      if (status < 400) {
        res.status(status).json({
          ...presets,
          status,
          message:
            (returnValue || {}).message ||
            `[SystemLynx][response]: ${module_name}.${fn}(...) returned successfully`,
          returnValue,
        });
      } else sendError(returnValue);
    };

    if (typeof Module[fn] !== "function")
      return sendResponse({
        message: `[SystemLynx][error]:${module_name}.${fn} method not found`,
        status: 404,
      });

    try {
      const args = body.__arguments || [];
      if (!isEmpty(query) && !args.length) args.push(query);
      if (isObject(args[0]) && method === "PUT") args[0] = { ...args[0], file, files };

      const results = Module[fn].apply({ ...Module, req, res }, args);

      if (isPromise(results)) {
        results.then(sendResponse).catch(sendError);
      } else {
        sendResponse(results);
      }
    } catch (error) {
      sendError(error);
    }
  };

  return { addService, addREST };
};
