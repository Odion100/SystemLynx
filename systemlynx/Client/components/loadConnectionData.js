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
          throw `[SystemLynx][Client][Error]: Failed to load Service @${url} after ${errors.length} attempts.`;
      } else resolve(results);
    });
  });
};
