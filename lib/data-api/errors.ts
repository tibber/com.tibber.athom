/** The Data API can't be used until the user logs in (again). */
export class LoginRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}
