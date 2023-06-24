module.exports = function headerSetter(headers = {}) {
  this.setHeaders = (options) => {
    Object.assign(headers, options);
    return this;
  };

  this.headers = () => headers;
  return this;
};
