(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.History = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function History(initial, limit) {
    this.limit = limit || 100;
    this.stack = [clone(initial)];
    this.cursor = 0;
  }

  History.prototype.push = function (state) {
    if (this.cursor < this.stack.length - 1) {
      this.stack = this.stack.slice(0, this.cursor + 1);
    }
    this.stack.push(clone(state));
    if (this.stack.length > this.limit) this.stack.shift();
    this.cursor = this.stack.length - 1;
    return this.current();
  };

  History.prototype.undo = function () {
    if (!this.canUndo()) return null;
    this.cursor -= 1;
    return this.current();
  };

  History.prototype.redo = function () {
    if (!this.canRedo()) return null;
    this.cursor += 1;
    return this.current();
  };

  History.prototype.current = function () {
    return clone(this.stack[this.cursor]);
  };

  History.prototype.canUndo = function () {
    return this.cursor > 0;
  };

  History.prototype.canRedo = function () {
    return this.cursor < this.stack.length - 1;
  };

  History.prototype.reset = function (state) {
    this.stack = [clone(state)];
    this.cursor = 0;
    return this.current();
  };

  return History;
});
