/**
 * 校验失败的统一错误类型。code 用于前端区分提示，message 为可读说明。
 */
class ValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ValidationError';
    this.code = code;
  }
}

module.exports = { ValidationError };
