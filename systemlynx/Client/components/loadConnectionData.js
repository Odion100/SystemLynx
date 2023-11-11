module.exports = function loadConnectionData(
  httpClient,
  url,
  { limit = 3, wait = 1000 } = {}
) {
  const errors = [];

  return new Promise(async function getData(resolve, reject) {
    try {
      const results = await httpClient.request({ method: "get", url });
      resolve(results);
    } catch (error) {
      errors.push(error);

      if (errors.length < limit)
        setTimeout(() => getData(resolve, reject), errors.length * wait);
      else {
        console.error(
          `[SystemLynx][Client]: Failed to load Service @${url} after ${errors.length} attempts.\n`
        );
        console.error(errors);
        reject(errors);
      }
    }
  });
};
