const HttpClient = require("../../HttpClient/HttpClient")();

module.exports = function loadConnectionData(url, { limit = 10, wait = 150 } = {}) {
  const errors = [];

  return new Promise(function getData(resolve) {
    HttpClient.request({ method: "GET", url }, (err, results) => {
      if (err) {
        errors.push(err);

        if (errors.length < limit)
          setTimeout(() => getData(resolve), errors.length * wait);
        else
          throw `SystemLynx loadConnectionData() Error: url:${url}, attempts:${errors.length}`;
      } else resolve(results);
    });
  });
};
