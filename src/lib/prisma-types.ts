// Re-export Prisma types for better IDE compatibility
// This helps VS Code resolve types from the generated client

export type {
  User,
  SellerProfile,
  EggListing,
  Tag,
  Order,
  Conversation,
  Message,
  Favorite,
  Post,
  SellerMonthlyVolume,
  UserRole,
  PickupType,
  PricingUnit,
  OrderStatus,
  FulfillmentType,
  FeeTier,
} from ".prisma/client";
