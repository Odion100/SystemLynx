const fs = require("fs");
const path = require("path");
function clearFolder(folder) {
  fs.readdir(folder, (err, files) => {
    if (err) return console.error(err);
    files.forEach((file) => {
      fs.unlink(path.join(folder, file), (err) => err && console.error(err));
    });
  });
}
async function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    return new Promise((resolve, reject) => {
      fs.mkdir(dir, { recursive: true }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
module.exports = { clearFolder, ensureDir };
