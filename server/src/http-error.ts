/** Σφάλμα με HTTP status και μήνυμα για τον χρήστη (στα ελληνικά). */
export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} δεν βρέθηκε`);
