import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AskCopper } from "@/components/copper/ask-copper";
import { createLive } from "@/lib/ai/live";
import type { Progress } from "@/lib/copper/assistant/progress";

const askCopper = vi.fn();
vi.mock("@/lib/copper/assistant/ask", () => ({
  askCopper: (request: unknown) => askCopper(request),
}));

afterEach(() => {
  cleanup();
  askCopper.mockReset();
});

// One starter question per tool, so a shopper (or a TA) can make each of
// Copper's five tools work with one click.
const BY_TOOL = {
  calculate_cost:
    "How much is Copper Home with Copper Plus, paid yearly, for 2 years?",
  check_availability: "Is Copper Notes in Night Sky in stock?",
  get_prices: "Is Copper Plus cheaper monthly or yearly?",
  get_products:
    "What does Copper sell, and what colors does each product come in?",
  recommend_setup:
    "I record lectures and have $200 for 2 years. What should I get?",
};

async function openPanel() {
  render(<AskCopper aiConfigured />);
  fireEvent.click(screen.getByTestId("ask-copper-launcher"));
  return within(await screen.findByTestId("ask-copper"));
}

describe("Ask Copper starter questions", () => {
  it("offers a starter for each of the five tools, original three first", async () => {
    const chat = await openPanel();
    for (const question of Object.values(BY_TOOL)) {
      expect(chat.getByRole("button", { name: question })).toBeInTheDocument();
    }
    const starters = chat
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter((text) => Object.values(BY_TOOL).includes(text ?? ""));
    expect(starters.slice(0, 3)).toEqual([
      BY_TOOL.calculate_cost,
      BY_TOOL.check_availability,
      BY_TOOL.get_prices,
    ]);
    expect(starters).toHaveLength(5);
  });

  it("asks the recommendation question straight away, with tools on", async () => {
    const done = createLive<Progress>();
    done.done({ steps: [], reply: "Sure.", status: "done" });
    askCopper.mockResolvedValue({ progress: done.live });
    const chat = await openPanel();
    fireEvent.click(
      chat.getByRole("button", { name: BY_TOOL.recommend_setup }),
    );
    await waitFor(() => expect(askCopper).toHaveBeenCalledTimes(1));
    expect(askCopper.mock.calls[0][0]).toEqual({
      messages: [{ role: "user", content: BY_TOOL.recommend_setup }],
      useTools: true,
    });
  });
});
