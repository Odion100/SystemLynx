const { expect } = require("chai");
const fs = require("fs");
const HttpSystemLynxClient = require("./HttpClient");
const port = 4789;
const testServerSetup = require("./test.server");
const TEST_FILE = process.cwd() + "/test.file.json";

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

  it("should be able to make http requests using a promise", async () => {
    const results = await HttpClient.request({
      method: "GET",
      url,
    });

    expect(results).to.be.an("Object").that.deep.equal({
      testPassed: true,
      method: "GET",
    });
  });

  it("should be able to make PUT requests", async () => {
    const results = await HttpClient.request({
      method: "GET",
      url,
    });

    expect(results).to.be.an("Object").that.deep.equal({
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
    });

    expect(results).to.be.an("Object").that.deep.equal({
      testPassed: true,
      method: "DELETE",
    });
  });

  it("should be able to upload a file", async () => {
    const file = fs.createReadStream(TEST_FILE);
    const results = await HttpClient.upload({
      url: singleFileUrl,
      formData: { file, __arguments: [{ uploadArguments: true }] },
    });

    expect(results).to.be.an("Object").that.has.property("testPassed", true);
    expect(results)
      .to.have.property("file")
      .that.is.an("Object")
      .that.has.property("originalname", "test.file.json");
    expect(results.__arguments).to.deep.equal([{ uploadArguments: true }]);
  });

  it("should be able to upload multiple files", async () => {
    const files = [fs.createReadStream(TEST_FILE), fs.createReadStream(TEST_FILE)];
    const results = await HttpClient.upload({
      url: multiFileUrl,
      formData: { files, __arguments: [{ multiUploadArguments: true }] },
    });

    expect(results).to.be.an("Object").that.has.property("testPassed", true);
    expect(results).to.have.property("files").that.is.an("Array");
    expect(results).to.have.property("fileUploadTest", true);
    expect(results.__arguments).to.deep.equal([{ multiUploadArguments: true }]);
  });
});
