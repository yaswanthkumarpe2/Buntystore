import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

/** An error that is safe to show: a status, a code the client can branch on, and a plain sentence. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = "That page") => new HttpError(404, "NOT_FOUND", `${what} was not found.`);

/** Parses a request body or query with a schema; a failure is a 400 with the first problem in plain words. */
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    const field = issue?.path.join(".");
    throw new HttpError(400, "INVALID_INPUT", field ? `${field}: ${issue?.message}` : (issue?.message ?? "Invalid input."));
  }
  return result.data;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  void _next;
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  if (err && typeof err === "object" && "type" in err && (err as { type?: string }).type === "entity.parse.failed") {
    res.status(400).json({ error: { code: "INVALID_JSON", message: "The request could not be read." } });
    return;
  }
  console.error(err);
  res.status(500).json({ error: { code: "SERVER_ERROR", message: "Something went wrong. Please try again." } });
}
