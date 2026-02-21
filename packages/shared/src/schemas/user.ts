import { z } from 'zod';
import { UserRole } from '../enums';

// Base User schema
export const userSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  entraObjectId: z.string().nullable().optional(), // nullable for email/password users
  email: z.string().email(),
  displayName: z.string().min(1).max(255),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// Create User schema (used internally for bootstrap)
export const createUserSchema = z.object({
  organizationId: z.string().uuid(),
  entraObjectId: z.string().nullable().optional(), // optional for email/password users
  email: z.string().email(),
  displayName: z.string().min(1).max(255),
});

// Update User schema
export const updateUserSchema = z.object({
  displayName: z.string().min(1).max(255).optional(),
  isActive: z.boolean().optional(),
});

// Role schema
export const roleSchema = z.object({
  id: z.string().uuid(),
  name: z.nativeEnum(UserRole),
  description: z.string().nullable(),
});

// User with roles (joined)
export const userWithRolesSchema = userSchema.extend({
  roles: z.array(z.nativeEnum(UserRole)),
});

// Types
export type User = z.infer<typeof userSchema>;
export type CreateUser = z.infer<typeof createUserSchema>;
export type UpdateUser = z.infer<typeof updateUserSchema>;
export type Role = z.infer<typeof roleSchema>;
export type UserWithRoles = z.infer<typeof userWithRolesSchema>;
