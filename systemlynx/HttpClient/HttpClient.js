const axios = require("axios");
const FormData = require("form-data");
const path = require("path");

module.exports = function createHttpClient() {
  const Client = {};
  Client.request = async ({ method = "get", url, body: data, headers }) => {
    method = method.toLowerCase();
    const res = await axios({ url, method, headers, data });
    if (res.status >= 400) {
      throw res.data;
    } else return res.data;
  };

  Client.upload = async ({ url, formData, headers }) => {
    const { file, files, __arguments } = formData;
    const form = new FormData();
    if (file) form.append("file", file, path.basename(file.path));
    if (files) {
      files.forEach((file) => {
        form.append("files", file, path.basename(file.path));
      });
    }
    if (__arguments) form.append("__arguments", JSON.stringify(__arguments));
    const res = await axios({
      url,
      method: "post",
      data: form,
      headers: { headers, ...form.getHeaders() },
    });
    if (res.status >= 400) {
      throw res.data;
    } else return res.data;
  };

  return Client;
};
