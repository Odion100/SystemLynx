module.exports = TestServerSetup = (port, done) => {
  const fs = require("fs");
  const server = require("../ServerManager/components/Server")();

  const response = (req, res) => {
    const { body, method } = req;
    body.testPassed = true;
    res.json({ method, ...body });
  };

  const uploadResponse = (req, res) => {
    const { file } = req;
    const json = JSON.parse(fs.readFileSync(file.path));

    res.json({ file, ...json });
  };

  const multiUploadResponse = (req, res) => {
    const { files } = req;
    const json = JSON.parse(fs.readFileSync(files[0].path));

    res.json({ files, ...json });
  };

  server.get("/test", response);
  server.put("/test", response);
  server.post("/test", response);
  server.delete("/test", response);
  server.post("/sf/test", uploadResponse);
  server.post("/mf/test", multiUploadResponse);
  server.listen(port, console.log(`(TestServer) listening on port:${port}`), done);

  return server;
};
