import { z } from "zod";

const createStaffDto = z.object({
  body: z
    .object({
      username: z
        .string()
        .min(3, "Username must be at least 3 characters")
        .trim()
        .toLowerCase(),
      displayName: z.string().trim().optional(),
      email: z.email("Invalid email format").trim().toLowerCase().optional(),
      phone: z.string().trim().optional(),
      password: z
        .string()
        .min(6, "Password must be at least 6 characters")
        .trim(),
      roleId: z.string().min(1, "Role ID is required"),
    })
    .strict(),
});

const updateStaffDto = z.object({
  body: z
    .object({
      displayName: z.string().trim().optional(),
      email: z.email("Invalid email format").trim().toLowerCase().optional(),
      phone: z.string().trim().optional(),
      roleId: z.string().optional(),
      isActive: z.boolean().optional(),
    })
    .strict(),
});

export const StaffDto = {
  create: createStaffDto,
  update: updateStaffDto,
};
