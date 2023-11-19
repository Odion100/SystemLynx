const { expect } = require("chai");
const fs = require("fs");
const { convertToReadStream } = require("../components/convertToReadStream"); // Update the path accordingly
// const { Readable } = require("stream");
const TEST_FILE = process.cwd() + "/test.file.json";

describe("convertToReadStream", () => {
  it("should convert file path to Readable stream", () => {
    const expected = fs.createReadStream(TEST_FILE);
    const result = convertToReadStream(TEST_FILE);
    expect(result).to.be.an.instanceOf(fs.ReadStream);
    expect(result.path).to.equal(expected.path);
  });

  it("should handle existing Readable streams", () => {
    const existingReadStream = fs.createReadStream(TEST_FILE);
    const result = convertToReadStream(existingReadStream);
    expect(result).to.equal(existingReadStream);
  });

  // it("should convert Buffer to Readable stream", () => {
  //   const fileContentsBuffer = fs.readFileSync(TEST_FILE);
  //   const result = convertToReadStream(fileContentsBuffer);
  //   expect(result).to.be.an.instanceOf(Readable);
  // });

  it("should throw error for invalid input", () => {
    const invalidInput = 123;
    expect(() => convertToReadStream(invalidInput)).to.throw(
      "File input must be either a Readable stream, or a file path."
    );
  });
});
