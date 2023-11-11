//express server, socket.io server and middleware needed for SystemLynx basic functionality
const clearFolder = require("./clearFolder");
const clearTempFolder = clearFolder.bind({}, "./temp");
module.exports = function createServer(customServer) {
  //express server
  const express = require("express");
  const server = customServer || express();
  //express middleware
  const multer = require("multer");
  //express file upload middleware setup
  const TEMP_LOCATION = "./temp";
  const mime = require("mime");
  const shortId = require("shortid");
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, TEMP_LOCATION),
    filename: (req, file, cb) =>
      cb(null, `${shortId()}.${mime.getExtension(file.mimetype)}`),
  });
  //multi-file and single-file upload middleware functions
  const sf = multer({ storage }).single("file");
  const mf = multer({ storage }).array("files");
  //the sf and mf functions are used to a extract file from the req during a file upload
  //a property named file and files will be added to the req object respectively
  const singleFileUpload = (req, res, next) =>
    sf(req, res, (err) => {
      if (err) return res.json(err);
      res.on("finish", clearTempFolder);
      next();
    });
  const multiFileUpload = (req, res, next) =>
    mf(req, res, (err) => {
      if (err) return res.json(err);
      res.on("finish", clearTempFolder);
      next();
    });
  const parseArguments = (req, res, next) => {
    const { __arguments } = req.body;
    if (__arguments) req.body.__arguments = JSON.parse(__arguments);
    next();
  };
  server.use("/sf", singleFileUpload, parseArguments);
  server.use("/mf", multiFileUpload, parseArguments);
  server.use(express.json({ limit: "5mb" }));

  !customServer &&
    server.use((req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT ,DELETE");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "X-Requested-With,content-type, Authorization"
      );
      next();
    });

  return server;
};
