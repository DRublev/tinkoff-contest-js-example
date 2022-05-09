export class NoAccessException extends Error {
  constructor(message) {
    super(message);
    this.name = 'NoAccessException';
  }
}