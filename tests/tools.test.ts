// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calculateCost,
  calculateCostInput,
  checkAvailability,
  checkAvailabilityInput,
  copperTools,
  getPrices,
  listProducts,
  recommendSetup,
  recommendSetupInput,
} from "@/lib/copper/assistant/tools";
import * as inventory from "@/lib/copper/inventory";

afterEach(() => vi.restoreAllMocks());

describe("calculate_cost", () => {
  it("counts Copper Plus once: Copper Home, annual, 2 years is $307", () => {
    const r = calculateCost({
      products: ["copper-home"],
      plan: "copper-plus",
      billing: "annual",
      years: 2,
    });
    expect(r.totalUsd).toBe(307);
    expect(r.lines.map((l) => l.usd)).toEqual([149, 158]);
  });

  it("charges Plus once for two devices, and rounds monthly billing", () => {
    const r = calculateCost({
      products: ["copper-home", "copper-home"],
      plan: "copper-plus",
      billing: "monthly",
      years: 2,
    });
    expect(r.lines).toHaveLength(3);
    expect(r.totalUsd).toBe(489.76);
  });

  it("adds no line for the free plan, and allows no devices", () => {
    expect(
      calculateCost({
        products: [],
        plan: "free",
        billing: "annual",
        years: 1,
      }),
    ).toEqual({ lines: [], totalUsd: 0 });
  });

  it("rejects input outside the contract", () => {
    const ok = {
      products: ["copper-home"],
      plan: "free",
      billing: "annual",
      years: 1,
    };
    expect(calculateCostInput.safeParse(ok).success).toBe(true);
    for (const bad of [
      { ...ok, products: ["copper-pro"] },
      { ...ok, products: Array(6).fill("copper-home") },
      { ...ok, plan: "gold" },
      { ...ok, years: 0 },
      { ...ok, years: 6 },
      { ...ok, years: 1.5 },
    ]) {
      expect(calculateCostInput.safeParse(bad).success).toBe(false);
    }
  });
});

describe("catalog tools", () => {
  it("get_products returns colors and no stock", () => {
    const notes = listProducts().products.find((p) => p.id === "copper-notes");
    expect(notes?.colors).toEqual([
      "Brushed Copper",
      "Desert Sand",
      "Night Sky",
    ]);
    expect(JSON.stringify(listProducts())).not.toMatch(/stock/i);
  });

  it("get_prices returns every product and plan", () => {
    const p = getPrices();
    expect(p.products).toHaveLength(2);
    expect(p.plans.map((x) => x.id)).toEqual(["free", "copper-plus"]);
  });

  it("copperTools has exactly the five described tools", () => {
    expect(Object.keys(copperTools).sort()).toEqual([
      "calculate_cost",
      "check_availability",
      "get_prices",
      "get_products",
      "recommend_setup",
    ]);
    for (const t of Object.values(copperTools)) {
      expect(t.description).toBeTruthy();
    }
  });
});

// Today's stock, as the database holds it. The tests never touch Supabase.
const stock = [
  ["CH-POL", "Copper Home", "Polished Copper", 240, "2026-11-20"],
  ["CH-TEA", "Copper Home", "Patina Teal", 6, "2026-11-06"],
  ["CH-NSK", "Copper Home", "Night Sky", 185, "2026-11-20"],
  ["CN-BRC", "Copper Notes", "Brushed Copper", 310, "2026-11-13"],
  ["CN-DSA", "Copper Notes", "Desert Sand", 92, "2026-11-13"],
  ["CN-NSK", "Copper Notes", "Night Sky", 0, "2026-11-14"],
] as const;

const stockRows = () =>
  stock.map(([sku, product, color, units_in_stock, next_shipment]) => ({
    sku,
    product,
    color,
    units_in_stock,
    next_shipment,
  }));

describe("check_availability", () => {
  beforeEach(() => {
    vi.spyOn(inventory, "readInventory").mockResolvedValue(stockRows());
  });

  it("reports a backordered color with its restock date", async () => {
    const r = await checkAvailability({
      product: "copper-notes",
      color: "night sky",
    });
    expect(r).toEqual({
      status: "ok",
      product: "Copper Notes",
      colors: [
        { color: "Night Sky", stock: "backordered", restockDate: "2026-11-14" },
      ],
    });
  });

  it("reports low stock and in stock for every color", async () => {
    const r = await checkAvailability({ product: "copper-home" });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.colors.map((c) => [c.color, c.stock])).toEqual([
      ["Polished Copper", "in_stock"],
      ["Patina Teal", "low_stock"],
      ["Night Sky", "in_stock"],
    ]);
  });

  it("says Patina Teal is not a Copper Notes color, not out of stock", async () => {
    const r = await checkAvailability({
      product: "copper-notes",
      color: "Patina Teal",
    });
    expect(r).toEqual({
      status: "not_a_color",
      product: "Copper Notes",
      color: "Patina Teal",
      colors: ["Brushed Copper", "Desert Sand", "Night Sky"],
    });
  });

  it("says stock is unavailable without stock words, but checks colors first", async () => {
    vi.spyOn(inventory, "readInventory").mockResolvedValue(null);
    const r = await checkAvailability({ product: "copper-home" });
    expect(r.status).toBe("unavailable");
    expect(JSON.stringify(r)).not.toMatch(/in_stock|low_stock|backordered/);
    const bad = await checkAvailability({
      product: "copper-notes",
      color: "Patina Teal",
    });
    expect(bad.status).toBe("not_a_color");
  });

  it("only accepts Copper products", () => {
    expect(
      checkAvailabilityInput.safeParse({ product: "toaster" }).success,
    ).toBe(false);
  });
});

describe("recommend_setup", () => {
  beforeEach(() => {
    vi.spyOn(inventory, "readInventory").mockResolvedValue(stockRows());
  });

  it("picks the free plan when Copper Plus doesn't fit the budget", async () => {
    // Copper Notes is $129; Plus adds $79 a year, so 2 years is $287 > $200.
    const r = await recommendSetup({
      use: "lectures",
      years: 2,
      budgetUsd: 200,
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.recommended).toBe("free");
    expect(r.options).toEqual([
      { plan: "free", name: "Free", totalUsd: 129, withinBudget: true },
      {
        plan: "copper-plus",
        name: "Copper Plus",
        totalUsd: 287,
        withinBudget: false,
      },
    ]);
    expect(r.products.map((p) => [p.name, p.feature.name])).toEqual([
      ["Copper Notes", "Lecture Mode"],
    ]);
  });

  it("picks Copper Plus when it fits, and says which colors are back-ordered", async () => {
    const r = await recommendSetup({
      use: "lectures",
      years: 2,
      budgetUsd: 350,
    });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.recommended).toBe("copper-plus");
    expect(r.products[0].colors).toEqual([
      { color: "Brushed Copper", stock: "in_stock", restockDate: null },
      { color: "Desert Sand", stock: "in_stock", restockDate: null },
      { color: "Night Sky", stock: "backordered", restockDate: "2026-11-14" },
    ]);
  });

  it("recommends both devices for 'both' and Copper Plus when there is no budget", async () => {
    const r = await recommendSetup({ use: "both", years: 2 });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.products.map((p) => p.name)).toEqual([
      "Copper Home",
      "Copper Notes",
    ]);
    expect(r.budgetUsd).toBeNull();
    expect(r.recommended).toBe("copper-plus");
    // $149 + $129 + 2 years of Plus at $79, charged once for the household.
    expect(r.options.map((o) => [o.plan, o.totalUsd, o.withinBudget])).toEqual([
      ["free", 278, null],
      ["copper-plus", 436, null],
    ]);
  });

  it("says by how much the budget falls short instead of recommending", async () => {
    const r = await recommendSetup({ use: "home", years: 1, budgetUsd: 100 });
    expect(r).toMatchObject({
      status: "over_budget",
      budgetUsd: 100,
      cheapestTotalUsd: 149,
      shortByUsd: 49,
    });
  });

  it("still recommends, without stock words, when stock can't be checked", async () => {
    vi.spyOn(inventory, "readInventory").mockResolvedValue(null);
    const r = await recommendSetup({ use: "home", years: 1 });
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.products[0].colors).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/in_stock|low_stock|backordered/);
  });

  it("is one of Copper's tools, with a described contract that rejects bad input", () => {
    expect(copperTools.recommend_setup.description).toBeTruthy();
    const ok = { use: "home", years: 1 };
    expect(recommendSetupInput.safeParse(ok).success).toBe(true);
    for (const bad of [
      { use: "gaming", years: 1 },
      { use: "home", years: 0 },
      { use: "home", years: 6 },
      { use: "home", years: 1, budgetUsd: -5 },
    ]) {
      expect(recommendSetupInput.safeParse(bad).success).toBe(false);
    }
  });
});
