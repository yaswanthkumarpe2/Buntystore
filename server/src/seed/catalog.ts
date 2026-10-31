import type { CategoryId } from "../models";

/**
 * The starter catalogue: 6 categories, 10 products each. Pictures are drawn from
 * an emoji on a tinted tile, so there are no image licences to worry about.
 * Prices are in rupees.
 */
type Row = [name: string, price: number, mrp: number, emoji: string, description: string, highlights: string[]];

const ROWS: Record<CategoryId, { hue: number; returnable: boolean; deliveryDays: number; rows: Row[] }> = {
  electronics: {
    hue: 220,
    returnable: true,
    deliveryDays: 3,
    rows: [
      ["Nova 5G Smartphone (128 GB)", 13999, 17999, "📱", "A fast 5G phone with a bright 6.6-inch screen and a battery that lasts all day.", ["6.6-inch display", "128 GB storage", "5000 mAh battery"]],
      ["Pulse Wireless Earbuds", 1499, 2999, "🎧", "Small, light earbuds with clear sound and a charging case.", ["30 hours with case", "Touch controls", "Water resistant"]],
      ["Bolt Power Bank 20000 mAh", 1299, 1999, "🔋", "Charge your phone up to four times on the go.", ["20000 mAh", "Two USB ports", "Fast charging"]],
      ["Orbit Smartwatch", 2499, 4999, "⌚", "Track steps, sleep and heart rate, and see your messages.", ["1.8-inch screen", "7-day battery", "Heart-rate sensor"]],
      ["Echo Bluetooth Speaker", 1799, 2999, "🔊", "Loud, clear sound for your room or your trip.", ["12 hours of music", "Splash proof", "Built-in mic"]],
      ["Swift Laptop 14\" (8 GB / 512 GB)", 42999, 52999, "💻", "A thin laptop for study and work, with a full-day battery.", ["14-inch Full HD", "8 GB RAM", "512 GB SSD"]],
      ["Snap Mirrorless Camera Kit", 38999, 45999, "📷", "Take sharp photos and 4K video with this easy camera kit.", ["24 MP sensor", "4K video", "Kit lens included"]],
      ["Glide Wireless Mouse", 499, 999, "🖱️", "A quiet mouse that fits your hand and works for months on one battery.", ["Silent clicks", "12-month battery", "Plug-and-play"]],
      ["Type Mechanical Keyboard", 2299, 3499, "⌨️", "Clicky keys and soft lights for typing and games.", ["Mechanical keys", "Backlit", "Full size"]],
      ["Vista 43\" Smart TV", 24999, 32999, "📺", "Watch your shows on a sharp 4K screen with apps built in.", ["43-inch 4K", "Streaming apps", "Two HDMI ports"]],
    ],
  },
  fashion: {
    hue: 330,
    returnable: true,
    deliveryDays: 4,
    rows: [
      ["Classic Cotton T-Shirt", 399, 799, "👕", "A soft cotton tee for every day. Comes in many colours.", ["100% cotton", "Regular fit", "Machine wash"]],
      ["Slim Fit Blue Jeans", 1199, 1999, "👖", "Stretchy denim jeans that are comfortable all day.", ["Stretch denim", "Slim fit", "5 pockets"]],
      ["Floral Summer Dress", 1299, 2499, "👗", "A light, flowy dress with a fresh floral print.", ["Breathable fabric", "Knee length", "Easy care"]],
      ["Runner Sports Shoes", 1799, 3499, "👟", "Light running shoes with soft cushioning.", ["Mesh upper", "Cushioned sole", "Non-slip grip"]],
      ["Leather Belt", 499, 999, "🪢", "A simple brown leather belt with a metal buckle.", ["Genuine leather", "Adjustable", "35 mm wide"]],
      ["Everyday Backpack", 899, 1799, "🎒", "Roomy backpack with a laptop pocket for college or office.", ["Fits 15-inch laptop", "Water resistant", "Padded straps"]],
      ["Silk Saree", 2999, 5999, "🥻", "An elegant saree for festivals and weddings.", ["Soft silk blend", "With blouse piece", "5.5 m length"]],
      ["Woollen Winter Cap", 299, 599, "🧢", "Keeps you warm on cold mornings.", ["Soft wool", "One size", "Hand wash"]],
      ["Analog Steel Watch", 1499, 2999, "🕰️", "A classic watch with a steel strap.", ["Water resistant", "Steel strap", "1-year warranty"]],
      ["Polarised Sunglasses", 699, 1499, "🕶️", "Cuts glare and protects your eyes from UV.", ["Polarised lenses", "UV400", "Light frame"]],
    ],
  },
  home: {
    hue: 30,
    returnable: true,
    deliveryDays: 4,
    rows: [
      ["Non-Stick Frying Pan", 699, 1299, "🍳", "Cook with less oil on a pan that is easy to clean.", ["24 cm", "Induction ready", "Cool-touch handle"]],
      ["Steel Pressure Cooker 5 L", 1599, 2299, "🍲", "Cooks rice and dal fast and safely.", ["5 litres", "Stainless steel", "Safety valve"]],
      ["Electric Kettle 1.5 L", 799, 1499, "🫖", "Boils water in minutes and switches off by itself.", ["1.5 litres", "Auto shut-off", "Steel body"]],
      ["Cotton Bedsheet Set", 999, 1999, "🛏️", "A soft double bedsheet with two pillow covers.", ["Double size", "100% cotton", "Fade resistant"]],
      ["Table Lamp", 899, 1599, "💡", "A warm reading light for your desk.", ["LED bulb included", "Adjustable neck", "Energy saving"]],
      ["Wall Clock", 449, 899, "🕛", "A silent wall clock with a clean design.", ["Silent movement", "30 cm", "Easy to hang"]],
      ["Glass Storage Jars (Set of 3)", 599, 999, "🫙", "Keep snacks and spices fresh in airtight jars.", ["Airtight lids", "1 litre each", "See-through glass"]],
      ["Room Plant in Pot", 349, 599, "🪴", "A low-care green plant that brightens any room.", ["Easy care", "Ceramic pot", "Indoor plant"]],
      ["Bath Towel Set", 699, 1299, "🧺", "Soft, thick towels that dry fast.", ["Set of 2", "Cotton", "Quick dry"]],
      ["Dinner Plate Set (6)", 1199, 1999, "🍽️", "Strong ceramic plates for daily meals.", ["Set of 6", "Microwave safe", "Chip resistant"]],
    ],
  },
  books: {
    hue: 260,
    returnable: true,
    deliveryDays: 3,
    rows: [
      ["The Little Book of Habits", 299, 499, "📘", "Small steps that build good habits, explained simply.", ["Paperback", "200 pages", "English"]],
      ["Learn Python in 30 Days", 499, 799, "🐍", "A friendly guide to your first programs in Python.", ["Paperback", "Exercises", "Beginner level"]],
      ["Stories for Bedtime", 249, 399, "📖", "Short, kind stories for children to fall asleep to.", ["Hardcover", "Colour pictures", "Ages 4–8"]],
      ["Money Made Simple", 349, 599, "💰", "Budgeting and saving basics in plain words.", ["Paperback", "Easy examples", "Workbook pages"]],
      ["World Atlas for Students", 599, 899, "🗺️", "Maps and facts about every country.", ["Hardcover", "Full colour", "Updated maps"]],
      ["The Mystery of Hill Station", 299, 449, "🔎", "A gripping detective novel set in the mountains.", ["Paperback", "320 pages", "Fiction"]],
      ["Indian Home Cooking", 549, 899, "🥘", "100 everyday recipes with step-by-step photos.", ["Hardcover", "100 recipes", "Photos"]],
      ["Drawing for Beginners", 399, 599, "✏️", "Learn to sketch people, places and things.", ["Paperback", "Step-by-step", "All ages"]],
      ["English Grammar Made Easy", 279, 449, "📝", "Clear rules and quick practice for better English.", ["Paperback", "Exercises", "Answer key"]],
      ["Space and the Stars", 449, 699, "🔭", "A colourful tour of planets, stars and galaxies.", ["Hardcover", "Photos", "Ages 10+"]],
    ],
  },
  beauty: {
    hue: 350,
    returnable: true,
    deliveryDays: 3,
    rows: [
      ["Aloe Face Wash", 199, 299, "🧴", "Gently cleans and cools your skin.", ["Aloe vera", "All skin types", "150 ml"]],
      ["Daily Sunscreen SPF 50", 349, 499, "☀️", "Light sunscreen that does not feel sticky.", ["SPF 50", "Non-greasy", "50 g"]],
      ["Herbal Shampoo", 249, 399, "🧼", "Mild shampoo for soft, shiny hair.", ["No harsh sulphates", "Herbal", "340 ml"]],
      ["Matte Lipstick", 299, 499, "💄", "Long-lasting colour that stays put.", ["Matte finish", "8-hour wear", "Many shades"]],
      ["Moisturising Body Lotion", 299, 449, "🫧", "Keeps your skin soft for the whole day.", ["Shea butter", "Quick absorb", "400 ml"]],
      ["Beard Grooming Kit", 799, 1299, "🧔", "Oil, balm and comb for a neat beard.", ["Beard oil", "Balm", "Wooden comb"]],
      ["Floral Perfume", 899, 1499, "🌸", "A light, fresh scent for every day.", ["50 ml", "Long lasting", "Floral notes"]],
      ["Hair Dryer", 999, 1799, "💨", "Dries hair fast with two heat settings.", ["1200 W", "2 heat settings", "Foldable"]],
      ["Nail Paint Set (6)", 399, 699, "💅", "Six bright shades that dry quickly.", ["Set of 6", "Quick dry", "Chip resistant"]],
      ["Vitamin C Face Serum", 499, 799, "🍊", "Brightens skin and evens out tone.", ["Vitamin C", "Lightweight", "30 ml"]],
    ],
  },
  grocery: {
    hue: 130,
    returnable: false,
    deliveryDays: 1,
    rows: [
      ["Basmati Rice 5 kg", 649, 799, "🍚", "Long-grain rice that cooks soft and fluffy.", ["5 kg", "Aged rice", "Long grain"]],
      ["Toor Dal 1 kg", 159, 199, "🫘", "Clean, unpolished toor dal for daily cooking.", ["1 kg", "Unpolished", "High protein"]],
      ["Sunflower Oil 1 L", 169, 199, "🌻", "Light cooking oil for frying and curries.", ["1 litre", "Refined", "Heart friendly"]],
      ["Assam Tea 500 g", 249, 299, "🍵", "Strong, rich tea for a perfect cup of chai.", ["500 g", "Strong taste", "Assam leaves"]],
      ["Instant Coffee 100 g", 299, 349, "☕", "Smooth instant coffee, ready in seconds.", ["100 g", "Rich aroma", "Jar pack"]],
      ["Mixed Dry Fruits 500 g", 549, 699, "🥜", "Almonds, cashews and raisins for healthy snacking.", ["500 g", "No added salt", "Resealable pack"]],
      ["Whole Wheat Atta 10 kg", 449, 549, "🌾", "Soft rotis every day with this whole wheat flour.", ["10 kg", "Whole wheat", "Stone ground"]],
      ["Pure Honey 500 g", 249, 349, "🍯", "Natural honey for tea, toast and more.", ["500 g", "No added sugar", "Glass jar"]],
      ["Masala Combo Pack", 199, 299, "🌶️", "Turmeric, chilli and garam masala in one pack.", ["3 spices", "100 g each", "No colours"]],
      ["Dark Chocolate Bar", 99, 129, "🍫", "Rich dark chocolate with 70% cocoa.", ["70% cocoa", "100 g", "Less sugar"]],
    ],
  },
};

export interface SeedProduct {
  slug: string;
  name: string;
  category: CategoryId;
  price: number;
  mrp: number;
  emoji: string;
  hue: number;
  description: string;
  highlights: string[];
  rating: number;
  ratingCount: number;
  stock: number;
  returnable: boolean;
  deliveryDays: number;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/["'()]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Deterministic, so a re-seed gives the same numbers. */
function pseudo(n: number): number {
  const x = Math.sin(n * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

export const CATALOG: SeedProduct[] = Object.entries(ROWS).flatMap(([category, def], ci) =>
  def.rows.map(([name, price, mrp, emoji, description, highlights], i) => {
    const n = ci * 10 + i + 1;
    return {
      slug: slugify(name),
      name,
      category: category as CategoryId,
      price,
      mrp,
      emoji,
      hue: (def.hue + i * 9) % 360,
      description,
      highlights,
      rating: Math.round((3.8 + pseudo(n) * 1.1) * 10) / 10,
      ratingCount: Math.floor(40 + pseudo(n + 100) * 4800),
      stock: Math.floor(15 + pseudo(n + 200) * 120),
      returnable: def.returnable,
      deliveryDays: def.deliveryDays,
    };
  }),
);
