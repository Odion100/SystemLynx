module.exports = function throttleByCount(func, limit = 1, interval) {
  let callCount = 0;
  let resetTimer;

  return function (...args) {
    callCount++;

    if (callCount <= limit) {
      func.apply(this, args);
    }

    if (!resetTimer) {
      resetTimer = setTimeout(() => {
        callCount = 0;
        resetTimer = null;
      }, interval);
    }
  };
};
