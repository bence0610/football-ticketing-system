import { HttpErrorResponse } from "@angular/common/http";
import { extractApiErrorMessage, NETWORK_ERROR_MESSAGE } from "./api-error";

const URL = "http://localhost:3000/api/season-passes/purchase";

function http(status: number, body: unknown): HttpErrorResponse {
  return new HttpErrorResponse({
    status,
    statusText: "x",
    url: URL,
    error: body,
  });
}

describe("extractApiErrorMessage", () => {
  it("returns the server's message for a 409, never Angular's technical string", () => {
    const err = http(409, {
      statusCode: 409,
      message: "Erre a szezonra már van bérleted.",
    });
    expect(err.message).toContain("Http failure response"); // what the UI used to show
    expect(extractApiErrorMessage(err, "fallback")).toBe(
      "Erre a szezonra már van bérleted.",
    );
  });

  it("joins class-validator message lists", () => {
    expect(
      extractApiErrorMessage(http(400, { message: ["a hiba", "b hiba"] }), "f"),
    ).toBe("a hiba, b hiba");
  });

  it("uses the fallback — not the technical string — when the body has no message", () => {
    const msg = extractApiErrorMessage(http(500, null), "Valami elromlott.");
    expect(msg).toBe("Valami elromlott.");
    expect(msg).not.toContain("Http failure");
  });

  it("reports a network failure (status 0) in Hungarian", () => {
    expect(extractApiErrorMessage(http(0, null), "f")).toBe(
      NETWORK_ERROR_MESSAGE,
    );
  });

  it("keeps the message of a plain Error (e.g. from Stripe)", () => {
    expect(extractApiErrorMessage(new Error("A kártya elutasítva."), "f")).toBe(
      "A kártya elutasítva.",
    );
  });
});
