"use strict";
const httpClient = require("request");
const json = true;

module.exports = function createClient() {
  const Client = this || {};
  Client.request = ({ method, url, body }, cb) => {
    const tryRequest = (callback) => {
      httpClient({ method, url, body, json }, (err, res, body) => {
        if (err) callback(err);
        else if (res.statusCode >= 400) callback(body);
        else callback(null, body, res);
      });
    };
    if (typeof cb === "function") tryRequest(cb);
    else
      return new Promise((resolve, reject) =>
        tryRequest((err, results) => {
          if (err) reject(err);
          else resolve(results);
        })
      );
  };

  Client.upload = ({ url, formData }, cb) => {
    const tryRequest = (callback) => {
      httpClient.post({ url, formData, json }, (err, res, body) => {
        if (err) callback(err);
        else if (res.statusCode >= 400) callback(body);
        else callback(null, body, res);
      });
    };
    if (typeof cb === "function") tryRequest(cb);
    else
      return new Promise((resolve, reject) =>
        tryRequest((err, results) => {
          if (err) reject(err);
          else resolve(results);
        })
      );
  };

  return Client;
};
