const createClient = require("../../Client/Client");

module.exports = ({ services }, App, customClient, systemContext) => {
  const Client = createClient(customClient, systemContext);

  return Promise.all(
    services.map((serviceData) => {
      const { url, limit, wait, name, onLoad } = serviceData;
      return new Promise((resolve) => {
        Client.loadService(url, { limit, wait })
          .then((service) => {
            serviceData.client = service;
            if (typeof onLoad === "function") {
              onLoad(serviceData.client);
              serviceData.client.on("reconnect", onLoad);
            }
            App.emit("service_loaded", serviceData.client).emit(
              `service_loaded:${name}`,
              serviceData.client
            );
            resolve();
          })
          .catch((err) => {
            console.warn(err);
            App.emit("failed_connection", { err, ...serviceData });
            resolve();
          });
      });
    })
  );
};
