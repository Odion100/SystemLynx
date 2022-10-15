const Router = require("./Router");
module.exports = function Clones(server) {
  const Clones = this;
  const cloneRouter = Router.apply(Clones, [server]);
  const handledEvents = [];
  Clones.clones = [];

  Clones.register = ({ port, host, route }, cb) => {
    if (!(port && route && host))
      return cb({
        message: "route port and host are required options",
        status: 400,
      });

    route = route.charAt(0) === "/" ? route : "/" + route;
    const url = `http://${host}:${port}${route}`;
    let service = Clones.clones.find((service) => service.route === route);

    if (service) {
      if (service.locations.indexOf(url) === -1) {
        service.locations.push(url);
        Clones.emit("new_clone", { url, service });
        cb(null, { message: "New clone locations registered", service });
      }
    } else {
      service = { route, locations: [url] };
      cloneRouter.addService(service);
      Clones.clones.push(service);
      Clones.emit("new_service", { url, service });
      Clones.emit("new_clone", { url, service });
      cb(null, { url, service });
    }
  };

  Clones.dispatch = ({ name, data }, cb) => {
    Clones.emit(name, data);
    cb();
  };

  Clones.assignDispatch = (event, cb) => {
    const e = handledEvents.find((e) => e.id === event.id);
    if (!e) {
      handledEvents.push(event);
      cb(null, event);
    } else cb({ message: "Event already handle", status: 403 });

    if (handledEvents.length > 50) handledEvents.splice(20);
  };
};
