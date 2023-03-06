//express server, socket.io server and middleware needed for SystemLynx basic functionality

module.exports = function SystemLynxServer() {
  const cwd = process.cwd();
  //express server
  const express = require("express");
  const server = express();
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
  const sf = multer({ storage: storage }).single("file");
  const mf = multer({ storage: storage }).array("files");
  //the sf and mf functions are used to a extract file from the req during a file upload
  //a property named file and files will be added to the req object respectively
  const singleFileUpload = (req, res, next) =>
    sf(req, res, (err) => {
      if (err) res.json(errorResponseBuilder(err));
      else next();
    });
  const multiFileUpload = (req, res, next) =>
    mf(req, res, (err) => {
      if (err) res.json(errorResponseBuilder(err));
      else next();
    });

  server.use("/sf", singleFileUpload);
  server.use("/mf", multiFileUpload);
  server.use(express.static(cwd + "/public"));
  server.use(express.json({ limit: "5mb" }));

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
