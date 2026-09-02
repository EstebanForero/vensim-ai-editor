export class ModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelError";
  }
}
