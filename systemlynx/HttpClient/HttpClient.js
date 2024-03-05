const { isNode } = require("../../utils/ProcessChecker");
const axios = require("axios").default;
const FormData = require("form-data");
const path = require("path");

module.exports = function createHttpClient() {
  const Client = {};
  Client.request = async ({ method = "get", url, body: data, headers }) => {
    method = method.toLowerCase();
    try {
      const res = await axios({ url, method, headers, data });
      if (res.status >= 400) {
        throw res.data;
      } else return res.data;
    } catch (error) {
      if (!error.isAxiosError) throw error;
      if (!error.response) throw error;
      if (!error.response.data) throw error;
      throw error.response.data;
    }
  };

  Client.upload = async ({ url, formData, headers }) => {
    const { file, files, __arguments } = formData;
    const form = new FormData();
    if (file) form.append("file", file, isNode ? path.basename(file.path) : file.name);
    if (files) {
      files.forEach((file) => {
        form.append("files", file, isNode ? path.basename(file.path) : file.name);
      });
    }
    if (__arguments) form.append("__arguments", JSON.stringify(__arguments));

    try {
      const res = await axios.post(url, form, {
        headers: { ...headers, "Content-Type": "multipart/form-data" },
      });
      if (res.status >= 400) {
        throw res.data;
      } else return res.data;
    } catch (error) {
      if (!error.isAxiosError) throw error;
      if (!error.response) throw error;
      if (!error.response.data) throw error;
      throw error.response.data;
    }
  };

  return Client;
};
