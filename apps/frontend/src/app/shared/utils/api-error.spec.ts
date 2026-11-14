import { HttpErrorResponse } from "@angular/common/http";
import {
  apiErrorCode,
  apiErrorMessage,
  extractApiErrorMessage,
  NETWORK_ERROR_MESSAGE,
  splitFieldErrors,
} from "./api-error";

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

describe("apiErrorCode / apiErrorMessage", () => {
  it("reads the code and the first message of the global error body", () => {
    const err = http(400, { statusCode: 400, code: "email_taken", message: "Foglalt." });
    expect(apiErrorCode(err)).toBe("email_taken");
    expect(apiErrorMessage(err)).toBe("Foglalt.");
    expect(apiErrorMessage(http(400, { message: ["a", "b"] }))).toBe("a");
  });

  it("is null for a body without them and for non-HTTP errors", () => {
    expect(apiErrorCode(http(500, null))).toBeNull();
    expect(apiErrorMessage(http(500, { message: "" }))).toBeNull();
    expect(apiErrorCode(new Error("x"))).toBeNull();
  });
});

describe("splitFieldErrors", () => {
  const matchers = { firstName: /keresztn/i, phoneNumber: /telefon/i } as const;

  it("puts each message on the field it names (own wording or property name), the rest aside", () => {
    const err = http(400, {
      message: [
        "A keresztnév legfeljebb 100 karakter lehet.",
        "phoneNumber must be shorter than or equal to 32 characters",
        "A keresztnév szöveg típusú érték legyen.",
        "Ismeretlen mező.",
      ],
    });
    const { fields, rest } = splitFieldErrors(err, matchers);
    expect(fields).toEqual({
      firstName: "A keresztnév legfeljebb 100 karakter lehet.",
      phoneNumber: "phoneNumber must be shorter than or equal to 32 characters",
    });
    expect(rest).toEqual(["Ismeretlen mező."]);
  });

  it("gives nothing for a body without messages", () => {
    expect(splitFieldErrors(http(400, null), matchers)).toEqual({ fields: {}, rest: [] });
  });
});
