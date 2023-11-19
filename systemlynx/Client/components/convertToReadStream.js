const fs = require("fs");
const { Readable } = require("stream");

function convertStringToReadStream(path) {
  try {
    const stats = fs.statSync(path);
    if (stats.isFile()) {
      return fs.createReadStream(path);
    } else {
      throw new Error(`File does not exists: ${path}`);
    }
  } catch (error) {
    throw new Error(
      "Error occurred while converting file path to Readable stream:",
      error
    );
  }
}
function bufferToStream(buffer) {
  // Create a custom readable stream
  const readableStream = new Readable();
  // Push the buffer data into the stream
  readableStream.push(buffer);
  // Signal the end of the stream
  readableStream.push(null);
  return readableStream;
}
function convertToReadStream(input) {
  if (input instanceof Readable) {
    return input;
  } // else if (Buffer.isBuffer(input)) {
  //  return bufferToStream(input);
  // }
  else if (typeof input === "string") {
    return convertStringToReadStream(input);
  } else {
    throw new Error("File input must be either a Readable stream, or a file path.");
  }
}

module.exports = { convertToReadStream };
