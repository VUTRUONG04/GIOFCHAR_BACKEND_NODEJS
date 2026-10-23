import { z } from "zod";

export const loginSchema = z.object({
  body: z.object({
    email: z.string().trim().email("Invalid email"),

    password: z.string().min(1, "Password is required"),
  }),
});

export const registerSchema = z.object({
  body: z.object({
    userName: z.string().trim().min(1, "Username is required"),

    email: z.string().trim().email("Invalid email"),

    phone: z.string().trim().min(1, "Phone is required"),

    password: z.string().min(6, "Password must be at least 6 characters"),

    address: z.string().trim().optional(),
  }),
});
