import type { Express } from "express";
import request from "supertest";
import { expect } from "vitest";

import { hashPassword } from "../src/auth";
import { UserModel } from "../src/models";

export const TEST_PASSWORD = "a-good-password";

/** A customer with a password, signed in on a cookie-keeping agent (sign-up itself is by email code). */
export async function signedInCustomer(app: Express, email = "priya@example.com", name = "Priya Sharma") {
  const user = await UserModel.create({ name, email, passwordHash: await hashPassword(TEST_PASSWORD), emailVerifiedAt: new Date() });
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/login").send({ email, password: TEST_PASSWORD });
  expect(res.status).toBe(200);
  return { agent, id: user._id.toString() };
}
