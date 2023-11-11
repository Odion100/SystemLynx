const HttpClient = require("../../HttpClient/HttpClient")();

module.exports = function Router(server) {
  const CloneManager = this;

  const addService = ({ route, locations }) => {
    server.get(route, recursiveGetService);

    let location_index = -1;
    function recursiveGetService(req, res) {
      if (locations.length === 0)
        return res.status(404).json({
          message: `No services found on requested route: ${route}`,
          locations,
        });

      location_index++;
      location_index = location_index < locations.length ? location_index : 0;
      const url = locations[location_index];
      HttpClient.request({ url })
        .then((connData) => {
          res.json(connData);
        })
        .catch((err) => {
          console.log(err);
          for (i = 0; i < locations.length; i++) {
            if (locations[i] === url) {
              locations.splice(i, 1);
              console.warn(`(LoadBalancer): Removing (${url}) URL from ${route} Service`);
              CloneManager.emit("location_removed", { url, route, locations });
            }
          }
          recursiveGetService(req, res);
        });
    }
  };

  return { addService };
};
