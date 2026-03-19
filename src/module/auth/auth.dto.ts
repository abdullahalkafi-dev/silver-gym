import z from "zod";

const registerDto = z.object({
  body: z
    .object({
      firstName: z.string().min(1, "First name is required").trim(),
      lastName: z.string().min(1, "Last name is required").trim(),
      email: z.email("Invalid email address").toLowerCase().optional(),
      password: z
        .string()
        .min(8, "Password must be at least 8 characters")
        .optional(),
      phone: z.string().optional(),
      countryCode: z.string().optional(),
      loginProvider: z.enum(["email", "google", "phone"]).default("email"),
      googleId: z.string().optional(),
      profilePicture: z.url("Invalid URL").optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
      const hasEmail = Boolean(data.email);
      const hasPhone = Boolean(data.phone);

      if (hasEmail && hasPhone) {
        ctx.addIssue({
          code: "custom",
          path: ["email"],
          message: "Cannot provide both email and phone for registration",
        });
      }

      if (!hasEmail && !hasPhone) {
        ctx.addIssue({
          code: "custom",
          path: ["email"],
          message: "Either email or phone is required for registration",
        });
      }
      if (data.loginProvider === "phone") {
        if (data.email) {
          ctx.addIssue({
            code: "custom",
            path: ["email"],
            message: "Email cannot be used during phone registration",
          });
        }
        if (data.googleId) {
          ctx.addIssue({
            code: "custom",
            path: ["googleId"],
            message: "Google ID cannot be used during phone registration",
          });
        }
      }

      if (data.loginProvider === "email") {
        if (!hasEmail) {
          ctx.addIssue({
            code: "custom",
            path: ["email"],
            message: "Email is required when login provider is email",
          });
        }

        if (!data.password) {
          ctx.addIssue({
            code: "custom",
            path: ["password"],
            message: "Password is required when login provider is email",
          });
        }
      }

      if (data.loginProvider === "google") {
        if (!hasEmail) {
          ctx.addIssue({
            code: "custom",
            path: ["email"],
            message: "Email is required when login provider is google",
          });
        }

        if (!data.googleId) {
          ctx.addIssue({
            code: "custom",
            path: ["googleId"],
            message: "Google ID is required when login provider is google",
          });
        }

        if (hasPhone) {
          ctx.addIssue({
            code: "custom",
            path: ["phone"],
            message: "Phone cannot be used during google registration",
          });
        }
      }

      if (data.loginProvider === "phone" && !hasPhone) {
        ctx.addIssue({
          code: "custom",
          path: ["phone"],
          message: "Phone number is required when login provider is phone",
        });
      }
    }),
});

const loginDto = z.object({
  body: z
    .object({
      email: z.email("Invalid email address").toLowerCase().optional(),
      phone: z.string().optional(),
      password: z.string().min(8, "Password must be at least 8 characters"),
    })
    .strict()
    .superRefine((data, ctx) => {
      const hasEmail = Boolean(data.email);
      const hasPhone = Boolean(data.phone);

      if (hasEmail && hasPhone) {
        ctx.addIssue({
          code: "custom",
          path: ["email"],
          message: "Provide either email or phone, not both",
        });
      }

      if (!hasEmail && !hasPhone) {
        ctx.addIssue({
          code: "custom",
          path: ["email"],
          message: "Either email or phone is required",
        });
      }
    }),
});

const verifyAccountDto = z.object({
  body: z
    .object({
      email: z.email("Invalid email address").toLowerCase().optional(),
      phone: z.string().optional(),
      otp: z.string().length(6, "OTP must be 6 digits"),
    })
    .strict()
    .superRefine((data, ctx) => {
      const hasEmail = Boolean(data.email);
      const hasPhone = Boolean(data.phone);

      if (hasEmail && hasPhone) {
        ctx.addIssue({
          code: "custom",
          path: ["email"],
          message: "Provide either email or phone, not both",
        });
      }

      if (!hasEmail && !hasPhone) {
        ctx.addIssue({
          code: "custom",
          path: ["email"],
          message: "Either email or phone is required",
        });
      }
    }),
});

const resendOtpDto = z.object({
  body: z
    .object({
      email: z.email("Invalid email address").toLowerCase().optional(),
      phone: z.string().optional(),
      type: z
        .enum(["account_verification", "password_reset", "two_factor"])
        .default("account_verification"),
    })
    .strict()
    .superRefine((data, ctx) => {
      const hasEmail = Boolean(data.email);
      const hasPhone = Boolean(data.phone);

      if (hasEmail && hasPhone) {
        ctx.addIssue({
          code: "custom",
          path: ["email"],
          message: "Provide either email or phone, not both",
        });
      }

      if (!hasEmail && !hasPhone) {
        ctx.addIssue({
          code: "custom",
          path: ["email"],
          message: "Either email or phone is required",
        });
      }
    }),
});

export const AuthDto = {
  register: registerDto,
  login: loginDto,
  verifyAccount: verifyAccountDto,
  resendOtp: resendOtpDto,
};
