const fs = require("fs");
const path = require("path");
module.exports = function clearFolder(folder) {
  fs.readdir(folder, (err, files) => {
    if (err) return console.error(err);
    files.forEach((file) => {
      fs.unlink(path.join(folder, file), (err) => err && console.error(err));
    });
  });
};
