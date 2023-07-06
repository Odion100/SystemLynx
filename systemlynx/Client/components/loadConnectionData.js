module.exports = function loadConnectionData(
  httpClient,
  url,
  { limit = 3, wait = 1000 } = {}
) {
  const errors = [];

  return new Promise(function getData(resolve, reject) {
    httpClient.request({ method: "GET", url }, (err, results) => {
      if (err) {
        errors.push(err);

        if (errors.length < limit)
          setTimeout(() => getData(resolve, reject), errors.length * wait);
        else {
          console.error(
            `[SystemLynx][Client]: Failed to load Service @${url} after ${errors.length} attempts.\n`
          );
          reject(err);
        }
      } else resolve(results);
    });
  });
};
