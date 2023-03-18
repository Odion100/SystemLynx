const parseMethods = (obj, reserved_methods = [], useREST) => {
  const methods = [];
  const REST_methods = ["get", "put", "post", "delete", "options"];
  const props = Object.getOwnPropertyNames(obj);

  props.forEach((fn) => {
    if (typeof obj[fn] === "function" && reserved_methods.indexOf(fn) === -1) {
      const method =
        useREST && REST_methods.indexOf(fn.toLocaleLowerCase()) > -1
          ? fn.toLocaleLowerCase()
          : "put";
      methods.push({ method, fn });
    }
  });

  return methods;
};

module.exports = parseMethods;
