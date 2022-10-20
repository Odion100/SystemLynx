const { expect } = require("chai");
const fs = require("fs");
const HttpSystemLynxClient = require("./HttpClient");
const port = 4789;
const testServerSetup = require("./test.server");
//test server setup

beforeAll(() => new Promise((resolve) => testServerSetup(port, resolve)));
describe("HttpSystemLynxClient Test", () => {
  const HttpClient = HttpSystemLynxClient();
  const url = `http://localhost:${port}/test`;
  const singleFileUrl = `http://localhost:${port}/sf/test`;
  const multiFileUrl = `http://localhost:${port}/mf/test`;

  it("should return a HttpClient instance", () => {
    expect(HttpClient)
      .to.be.an("Object")
      .that.has.all.keys("request", "upload")
      .that.respondsTo("request")
      .that.respondsTo("upload");
  });

  it("should be able to make http requests using a callback", async () => {
    const results = await new Promise((resolve, reject) => {
      HttpClient.request(
        {
          method: "GET",
          url: "http://localhost:4789/test",
          body: { getWithCallback: true },
        },
        (err, results) => {
          if (err) reject(err);
          else resolve(results);
        }
      );
    });

    expect(results).to.be.an("Object").that.deep.equal({
      getWithCallback: true,
      testPassed: true,
      method: "GET",
    });
  });

  it("should be able to make http requests using a promise", async () => {
    const results = await HttpClient.request({
      method: "GET",
      url,
      body: { getWithPromise: true },
    });

    expect(results).to.be.an("Object").that.deep.equal({
      getWithPromise: true,
      testPassed: true,
      method: "GET",
    });
  });

  it("should be able to make PUT requests", async () => {
    const results = await HttpClient.request({
      method: "GET",
      url,
      body: { getWithPromise: true },
    });

    expect(results).to.be.an("Object").that.deep.equal({
      getWithPromise: true,
      testPassed: true,
      method: "GET",
    });
  });

  it("should be able to make POST requests", async () => {
    const results = await HttpClient.request({
      method: "POST",
      url,
      body: { test: true },
    });

    expect(results).to.be.an("Object").that.deep.equal({
      test: true,
      testPassed: true,
      method: "POST",
    });
  });
  it("should be able to make DELETE requests", async () => {
    const results = await HttpClient.request({
      method: "DELETE",
      url,
      body: { test: true },
    });

    expect(results).to.be.an("Object").that.deep.equal({
      test: true,
      testPassed: true,
      method: "DELETE",
    });
  });

  it("should be able to upload a file", async () => {
    const file = fs.createReadStream(__dirname + "/test.file.json");
    const results = await HttpClient.upload({
      url: singleFileUrl,
      formData: { file },
    });

    expect(results).to.be.an("Object").that.has.property("testPassed", true);
    expect(results)
      .to.have.property("file")
      .that.is.an("Object")
      .that.has.property("originalname", "test.file.json");
  });

  it("should be able to upload multiple files", async () => {
    const files = [
      fs.createReadStream(__dirname + "/test.file.json"),
      fs.createReadStream(__dirname + "/test.file.json"),
    ];
    const multiUploadResponse = await HttpClient.upload({
      url: multiFileUrl,
      formData: { files },
    });
    expect(multiUploadResponse).to.be.an("Object").that.has.property("testPassed", true);
    expect(multiUploadResponse).to.have.property("files").that.is.an("Array");
    expect(multiUploadResponse).to.have.property("fileUploadTest", true);
  });
});
