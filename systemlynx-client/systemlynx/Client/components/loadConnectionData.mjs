export default function loadConnectionData(
  httpClient,
  url,
  { limit = 3, wait = 1000 } = {}
) {
  const errors = [];

  return new Promise(async function getData(resolve, reject) {
    try {
      const results = await httpClient.request({ url });
      resolve(results);
    } catch (error) {
      errors.push(error);

      if (errors.length < limit)
        setTimeout(() => getData(resolve, reject), errors.length * wait);
      else {
        // One concise line (not a dump of every attempt): a background reconnect has no caller
        // to catch the rejection, so we surface the freshest failure — but reject with the full
        // `errors` array so a caller that cares can still inspect every attempt.
        const last = errors[errors.length - 1];
        const detail = last && last.message ? last.message : JSON.stringify(last);
        console.error(
          `[SystemLynx][Client]: Failed to load Service @${url} after ${errors.length} attempts — ${detail}`
        );
        reject(errors);
      }
    }
  });
}
