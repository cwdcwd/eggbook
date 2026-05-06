import { z } from "zod";

// Shared field schemas
const cuid = z.string().cuid();
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);

// Strict numeric regex: rejects trailing chars like "10abc" or decimals for int
const STRICT_NUMBER_RE = /^-?\d+(\.\d+)?$/;
const STRICT_INT_RE = /^-?\d+$/;

// Coerce helper: accepts both number and numeric string (strict — rejects "10abc")
const coerceFinitePositive = (max: number) =>
  z.union([
    z.number().finite().positive().max(max),
    z.string().transform((v, ctx) => {
      if (!v.trim()) {
        ctx.addIssue({ code: "custom", message: "Required" });
        return z.NEVER;
      }
      if (!STRICT_NUMBER_RE.test(v.trim())) {
        ctx.addIssue({ code: "custom", message: "Must be a valid number" });
        return z.NEVER;
      }
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0 || n > max) {
        ctx.addIssue({ code: "custom", message: `Must be a positive number up to ${max}` });
        return z.NEVER;
      }
      return n;
    }),
  ]);

// Coerce helper for optional int fields — empty string treated as null
const coerceIntOptional = (min: number, max: number) =>
  z.union([
    z.number().int().min(min).max(max),
    z.literal("").transform(() => null),
    z.string().transform((v, ctx) => {
      if (!STRICT_INT_RE.test(v.trim())) {
        ctx.addIssue({ code: "custom", message: "Must be a valid integer" });
        return z.NEVER;
      }
      const n = Number(v);
      if (n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `Must be an integer between ${min} and ${max}` });
        return z.NEVER;
      }
      return n;
    }),
  ]);

// Coerce helper for required int fields — empty string is an error
const coerceInt = (min: number, max: number) =>
  z.union([
    z.number().int().min(min).max(max),
    z.string().transform((v, ctx) => {
      if (!v.trim()) {
        ctx.addIssue({ code: "custom", message: "Required" });
        return z.NEVER;
      }
      if (!STRICT_INT_RE.test(v.trim())) {
        ctx.addIssue({ code: "custom", message: "Must be a valid integer" });
        return z.NEVER;
      }
      const n = Number(v);
      if (n < min || n > max) {
        ctx.addIssue({ code: "custom", message: `Must be an integer between ${min} and ${max}` });
        return z.NEVER;
      }
      return n;
    }),
  ]);

// --- Orders ---

export const CreateOrderSchema = z.object({
  listingId: cuid,
  quantity: z.number().int().positive().max(10000),
  fulfillmentType: z.enum(["PICKUP", "DELIVERY"]),
  // Accepts both datetime-local (YYYY-MM-DDTHH:mm) and full ISO 8601
  pickupTime: z.string().regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/,
    "Must be a valid date-time"
  ).optional().nullable(),
  deliveryAddress: z.string().max(500).optional().nullable(),
  deliveryLat: latitude.optional().nullable(),
  deliveryLng: longitude.optional().nullable(),
}).refine(
  (data) => data.fulfillmentType !== "DELIVERY" || (data.deliveryAddress && data.deliveryAddress.trim().length > 0),
  { message: "Delivery address is required for delivery orders", path: ["deliveryAddress"] }
);

export const OrderActionSchema = z.object({
  action: z.enum(["confirm", "decline", "cancel", "markPaid", "complete"]),
  cancelReason: z.string().max(500).optional().nullable(),
});

export const OrderStatusParam = z.enum([
  "PENDING",
  "CONFIRMED",
  "PAID",
  "COMPLETED",
  "CANCELLED",
  "DECLINED",
]);

// --- Messages ---

export const SendMessageSchema = z.object({
  conversationId: cuid.optional().nullable(),
  content: z.string().trim().min(1).max(5000),
  recipientId: cuid.optional().nullable(),
}).refine(
  (data) => data.conversationId || data.recipientId,
  { message: "conversationId or recipientId required" }
);

// --- Listings ---

export const CreateListingSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional().nullable(),
  pricePerUnit: coerceFinitePositive(100000),
  unit: z.enum(["EGG", "HALF_DOZEN", "DOZEN", "FLAT", "CUSTOM"]),
  customUnitName: z.string().trim().max(100).optional().nullable(),
  customUnitQty: coerceIntOptional(1, 10000).optional().nullable(),
  stockCount: coerceIntOptional(0, 100000).optional().nullable(),
  photos: z.array(z.string().url().max(2048)).max(10).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
}).refine(
  (data) => data.unit !== "CUSTOM" || (data.customUnitName && data.customUnitQty),
  { message: "Custom unit name and quantity required for custom pricing" }
);

export const UpdateListingSchema = CreateListingSchema.extend({
  isAvailable: z.boolean().optional(),
});

// --- Favorites ---

export const AddFavoriteSchema = z.object({
  sellerProfileId: cuid,
});

// --- Checkout ---

export const CheckoutSchema = z.object({
  orderId: cuid,
});

// --- Settings ---

export const UpdateSettingsSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  bio: z.string().max(1000).optional().nullable(),
  avatarUrl: z.string().url().max(2048).optional().nullable(),
  address: z.string().max(200).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(50).optional().nullable(),
  zip: z.string().max(20).optional().nullable(),
  maxDeliveryDistance: z.union([
    z.number().finite().min(0).max(500),
    z.string().transform((v, ctx) => {
      if (!v || v.trim() === "") return null;
      if (!STRICT_NUMBER_RE.test(v.trim())) {
        ctx.addIssue({ code: "custom", message: "Must be a valid number" });
        return z.NEVER;
      }
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 500) {
        ctx.addIssue({ code: "custom", message: "Must be a number between 0 and 500" });
        return z.NEVER;
      }
      return n;
    }),
    z.null(),
  ]).optional().nullable(),
  pickupType: z.enum(["TIMESLOT", "HOURS", "ARRANGED"]).optional(),
  paymentMethod: z.enum(["PLATFORM", "OWN_STRIPE"]).optional(),
  autoAcceptOrders: z.boolean().optional(),
});

// --- Admin ---

export const AdminOrderStatusSchema = z.object({
  status: z.enum(["CONFIRMED", "COMPLETED", "CANCELLED", "DECLINED"]),
  cancelReason: z.string().max(500).optional().nullable(),
});

export const AdminUserActionSchema = z.object({
  action: z.enum(["suspend", "unsuspend", "change_role"]),
  role: z.enum(["BUYER", "SELLER"]).optional(),
});

export const AdminRefundSchema = z.object({
  amount: z.number().positive().max(100000).optional(),
  reason: z.string().max(500).optional(),
});
