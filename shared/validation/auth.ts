import { z } from "zod";
import { cleanText, emailAddress } from "./common";

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/** Structural password rules. Breach and similarity checks run on the server. */
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters.`);

export const loginSchema = z.object({
  email: emailAddress,
  // Never validate existing passwords beyond length — policy changes must not lock people out.
  password: z
    .string()
    .min(1, "Enter your password.")
    .max(PASSWORD_MAX * 4),
});

export const otpCodeSchema = z
  .string()
  .transform((v) => v.replace(/\s|-/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Enter the 6-digit code."));

export const recoveryCodeSchema = z
  .string()
  .transform((v) => v.toUpperCase().replace(/[^0-9A-Z]/g, ""))
  .pipe(z.string().regex(/^[0-9A-Z]{10}$/, "Enter a recovery code like ABCDE-12345."));

export const personNameSchema = z
  .string()
  .transform(cleanText)
  .pipe(z.string().min(1, "Enter your name.").max(120, "Please keep this under 120 characters."));

export const setPasswordSchema = z
  .object({
    password: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "The passwords don't match.",
  });

export const forgotPasswordSchema = z.object({ email: emailAddress });
