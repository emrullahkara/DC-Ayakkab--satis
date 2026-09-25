export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}
export const badRequest = (m: string, d?: unknown) => new HttpError(400, m, d);
export const notFound = (m = 'Kayıt bulunamadı') => new HttpError(404, m);
export const forbidden = (m = 'Bu işlem için yetkiniz yok') => new HttpError(403, m);
export const conflict = (m: string) => new HttpError(409, m);

export function assert(cond: unknown, message: string, status = 400): asserts cond {
  if (!cond) throw new HttpError(status, message);
}
