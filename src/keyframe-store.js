/* 镜头关键帧的保存、恢复、导出。存储层可注入，默认使用 localStorage。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.KeyframeStore = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STORAGE_KEY = 'camera-keyframes-v1';

  function createMemoryStorage() {
    var data = {};
    return {
      getItem: function (key) { return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null; },
      setItem: function (key, value) { data[key] = String(value); },
      removeItem: function (key) { delete data[key]; }
    };
  }

  function resolveStorage(custom) {
    if (custom) return custom;
    if (typeof localStorage !== 'undefined') return localStorage;
    return createMemoryStorage();
  }

  function createStore(customStorage) {
    var storage = resolveStorage(customStorage);

    function readAll() {
      try {
        var raw = storage.getItem(STORAGE_KEY);
        var parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
      } catch (err) {
        return [];
      }
    }

    function writeAll(frames) {
      storage.setItem(STORAGE_KEY, JSON.stringify(frames));
    }

    /* 从当前应用状态快照一帧；result 为求解结果，便于恢复时直接显示可行性。 */
    function snapshot(state, result, note) {
      return {
        id: 'kf-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
        time: new Date().toISOString(),
        note: note || '',
        scenarioId: state.scenarioId,
        stage: state.stage,
        characters: state.characters,
        set: state.set,
        focal: state.focal,
        aspect: state.aspect,
        lock: state.lock,
        relax: state.relax,
        result: result ? {
          feasible: result.feasible,
          camera: result.camera,
          view: result.view,
          conflicts: result.conflicts
        } : null
      };
    }

    function save(frame) {
      var frames = readAll();
      frames.push(frame);
      writeAll(frames);
      return frame;
    }

    function list() {
      return readAll();
    }

    function remove(id) {
      writeAll(readAll().filter(function (f) { return f.id !== id; }));
    }

    function clear() {
      writeAll([]);
    }

    /* 恢复关键帧：返回可供求解器直接使用的状态对象（深拷贝，避免污染源数据）。 */
    function restore(frame) {
      return JSON.parse(JSON.stringify({
        scenarioId: frame.scenarioId,
        stage: frame.stage,
        characters: frame.characters,
        set: frame.set,
        focal: frame.focal,
        aspect: frame.aspect,
        lock: frame.lock,
        relax: frame.relax
      }));
    }

    function exportJSON() {
      return JSON.stringify(readAll(), null, 2);
    }

    return {
      snapshot: snapshot,
      save: save,
      list: list,
      remove: remove,
      clear: clear,
      restore: restore,
      exportJSON: exportJSON,
      STORAGE_KEY: STORAGE_KEY
    };
  }

  return {
    createStore: createStore,
    createMemoryStorage: createMemoryStorage,
    STORAGE_KEY: STORAGE_KEY
  };
});
