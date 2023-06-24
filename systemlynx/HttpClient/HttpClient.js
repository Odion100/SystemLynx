"use strict";
const request = require("request");
const json = true;

module.exports = function createHttpClient() {
  const Client = this || {};

  Client.request = ({ method, url, body, headers }, cb) => {
    const tryRequest = (callback) => {
      request({ method, url, body, json, headers }, (err, res, body) => {
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

  Client.upload = ({ url, formData, headers }, cb) => {
    const tryRequest = (callback) => {
      request.post({ url, formData, json, headers }, (err, res, body) => {
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
