import { Schema, model, type InferSchemaType, type Types } from "mongoose";

export const CATEGORIES = [
  { id: "electronics", name: "Electronics", emoji: "📱" },
  { id: "fashion", name: "Fashion", emoji: "👕" },
  { id: "home", name: "Home & Kitchen", emoji: "🏠" },
  { id: "books", name: "Books", emoji: "📚" },
  { id: "beauty", name: "Beauty", emoji: "💄" },
  { id: "grocery", name: "Grocery", emoji: "🛒" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id) as [CategoryId, ...CategoryId[]];

// ---------------------------------------------------------------- users

const addressSchema = new Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true },
    line1: { type: String, required: true },
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
  },
  { _id: false },
);

const cartLineSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    qty: { type: Number, required: true, min: 1, max: 10 },
  },
  { _id: false },
);

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["customer", "admin"], default: "customer" },
    address: { type: addressSchema, default: null },
    cart: { type: [cartLineSchema], default: [] },
  },
  { timestamps: true },
);

export const UserModel = model("User", userSchema);
export type UserDoc = InferSchemaType<typeof userSchema> & { _id: Types.ObjectId };

// ---------------------------------------------------------------- products

const productSchema = new Schema(
  {
    slug: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    category: { type: String, enum: CATEGORY_IDS, required: true, index: true },
    price: { type: Number, required: true, min: 0 }, // rupees
    mrp: { type: Number, required: true, min: 0 },
    emoji: { type: String, required: true },
    hue: { type: Number, required: true, min: 0, max: 360 },
    description: { type: String, required: true },
    highlights: { type: [String], default: [] },
    rating: { type: Number, required: true, min: 0, max: 5 },
    ratingCount: { type: Number, required: true, min: 0 },
    stock: { type: Number, required: true, min: 0 },
    returnable: { type: Boolean, default: true },
    deliveryDays: { type: Number, default: 3, min: 1 },
  },
  { timestamps: true },
);
productSchema.index({ name: "text", description: "text" });

export const ProductModel = model("Product", productSchema);
export type ProductDoc = InferSchemaType<typeof productSchema> & { _id: Types.ObjectId };

// ---------------------------------------------------------------- orders

export const ORDER_STATUSES = ["placed", "packed", "shipped", "out_for_delivery", "delivered", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const RETURN_STATUSES = ["requested", "approved", "picked_up", "refunded", "rejected"] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

const orderItemSchema = new Schema(
  {
    productId: { type: Schema.Types.ObjectId, ref: "Product", required: true },
    slug: { type: String, required: true },
    name: { type: String, required: true },
    emoji: { type: String, required: true },
    hue: { type: Number, required: true },
    price: { type: Number, required: true },
    qty: { type: Number, required: true },
    returnable: { type: Boolean, required: true },
  },
  { _id: false },
);

const eventSchema = new Schema(
  {
    status: { type: String, required: true },
    at: { type: Date, required: true },
    note: { type: String, default: "" },
  },
  { _id: false },
);

const returnSchema = new Schema(
  {
    status: { type: String, enum: RETURN_STATUSES, required: true },
    reason: { type: String, required: true },
    details: { type: String, default: "" },
    requestedAt: { type: Date, required: true },
    timeline: { type: [eventSchema], default: [] },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    items: { type: [orderItemSchema], required: true },
    subtotal: { type: Number, required: true },
    deliveryFee: { type: Number, required: true },
    total: { type: Number, required: true },
    address: { type: addressSchema, required: true },
    paymentMethod: { type: String, enum: ["pay_on_delivery"], default: "pay_on_delivery" },
    status: { type: String, enum: ORDER_STATUSES, required: true, default: "placed", index: true },
    timeline: { type: [eventSchema], default: [] },
    expectedDelivery: { type: Date, required: true },
    deliveredAt: { type: Date, default: null },
    cancel: {
      type: new Schema(
        { at: Date, reason: String, by: { type: String, enum: ["customer", "store"] } },
        { _id: false },
      ),
      default: null,
    },
    return: { type: returnSchema, default: null },
    refund: {
      type: new Schema(
        {
          status: { type: String, enum: ["pending", "completed"] },
          amount: Number,
          at: Date,
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { timestamps: true },
);

export const OrderModel = model("Order", orderSchema);
export type OrderDoc = InferSchemaType<typeof orderSchema> & { _id: Types.ObjectId };
