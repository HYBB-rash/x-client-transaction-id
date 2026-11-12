import { afterEach, expect, mock, spyOn, test } from "bun:test";
import {
  ClientTransaction,
  ClientTransactionInitializationError,
  ClientTransactionNotInitializedError,
  decodeBase64,
  encodeBase64,
  OnDemandFileFetchError,
  SiteVerificationKeyNotFoundError,
} from "../src/index.ts";
import {
  createDocument,
  LIVE_PAGE_ANIMATION_KEY,
  LIVE_PAGE_KEY,
  LIVE_PAGE_ON_DEMAND_SOURCE,
  loadLivePage,
} from "./fixture.ts";

// A runtime snippet the ondemand.s URL can be resolved from
const RUNTIME_SCRIPT = `<script>1:"ondemand.s",foo})[e]||e)+"."+({1:"abc123_"}</script>`;

afterEach(() => {
  mock.restore();
});

test("generateTransactionId reproduces reference IDs for the captured page", async () => {
  // Produced by the implementation that predates the move to Bun, with
  // Math.random() fixed at 0.5
  spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(LIVE_PAGE_ON_DEMAND_SOURCE),
  );
  spyOn(Math, "random").mockReturnValue(0.5);
  const transaction = await ClientTransaction.create(await loadLivePage());

  expect(
    await transaction.generateTransactionId(
      "GET",
      "/i/api/graphql/abc/UserByScreenName",
      undefined,
      undefined,
      undefined,
      123456789,
    ),
  ).toBe(
    "gIybSOfM8ELFF+idR2Y8IQ1fdV80xY5JmzC278Y+HJvLAtkAHUaTL7OF/GhExtR+5pVN24elPZCct5ujO2lBVvrPTDecgw",
  );
  expect(
    await transaction.generateTransactionId(
      "POST",
      "/1.1/jot/client_event.json",
      undefined,
      undefined,
      undefined,
      98765432,
    ),
  ).toBe(
    "gIybSOfM8ELFF+idR2Y8IQ1fdV80xY5JmzC278Y+HJvLAtkAHUaTL7OF/GhExtR+5viKY4XfkO81y2F6yffUbiKONGRtgw",
  );
});

test("generateTransactionId uses the key and animation key it is given", async () => {
  spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(LIVE_PAGE_ON_DEMAND_SOURCE),
  );
  // A zero random byte leaves the other bytes unmasked
  spyOn(Math, "random").mockReturnValue(0);
  const transaction = await ClientTransaction.create(await loadLivePage());
  const generate = (key?: string, animationKey?: string) =>
    transaction.generateTransactionId(
      "GET",
      "/x",
      undefined,
      key,
      animationKey,
      1,
    );

  const defaultId = await generate();
  expect(await generate(LIVE_PAGE_KEY, LIVE_PAGE_ANIMATION_KEY)).toBe(
    defaultId,
  );
  expect(await generate(undefined, "0")).not.toBe(defaultId);
  const bytes = decodeBase64(
    await generate(encodeBase64(new Uint8Array([1, 2, 3]))),
  );
  expect(Array.from(bytes.slice(0, 4))).toEqual([0, 1, 2, 3]);
});

test("initialize runs once", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(LIVE_PAGE_ON_DEMAND_SOURCE),
  );
  const transaction = new ClientTransaction(await loadLivePage());

  await transaction.initialize();
  await transaction.initialize();
  expect(fetchSpy).toHaveBeenCalledTimes(1);
});

test("generateTransactionId requires initialization", async () => {
  const transaction = new ClientTransaction(
    createDocument("<html><head></head><body></body></html>"),
  );

  const error = await transaction
    .generateTransactionId("GET", "/graphql/test")
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ClientTransactionNotInitializedError);
  expect((error as Error).message).toContain(
    "ClientTransaction has not been initialized",
  );
});

test("initialize throws a typed error when the verification key is missing", async () => {
  const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("(a[1], 16)(b[2], 16)"),
  );
  const transaction = new ClientTransaction(
    createDocument(`<html><body>${RUNTIME_SCRIPT}</body></html>`),
  );

  const error = await transaction.initialize().catch((e: unknown) => e);
  expect(error).toBeInstanceOf(SiteVerificationKeyNotFoundError);
  expect((error as Error).message).toContain(
    "twitter-site-verification meta tag",
  );
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("initialize surfaces ondemand fetch failures as typed errors", async () => {
  spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("missing", {
      status: 503,
      statusText: "Service Unavailable",
    }),
  );
  const transaction = new ClientTransaction(
    createDocument(
      `<html><head><meta name="twitter-site-verification" content="AQIDBAUGBwg="/></head><body>${RUNTIME_SCRIPT}</body></html>`,
    ),
  );

  const error = await transaction.initialize().catch((e: unknown) => e);
  expect(error).toBeInstanceOf(OnDemandFileFetchError);
  expect((error as OnDemandFileFetchError).message).toContain(
    "Unable to fetch the X ondemand chunk",
  );
  expect((error as OnDemandFileFetchError).status).toBe(503);
});

test("exposes the keys consumers cache and replay", async () => {
  spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(LIVE_PAGE_ON_DEMAND_SOURCE),
  );
  const transaction = await ClientTransaction.create(await loadLivePage());

  expect(transaction.key).toBe(LIVE_PAGE_KEY);
  expect(transaction.animationKey).toBe(LIVE_PAGE_ANIMATION_KEY);
  expect(transaction.keyBytes).toEqual(Array.from(decodeBase64(LIVE_PAGE_KEY)));
  expect(transaction.isInitialized).toBe(true);
});

test("reports uninitialized state through the public getters", () => {
  const transaction = new ClientTransaction(
    createDocument("<html><head></head><body></body></html>"),
  );

  expect(transaction.isInitialized).toBe(false);
  expect(transaction.key).toBeNull();
  expect(transaction.animationKey).toBeNull();
  expect(transaction.keyBytes).toBeNull();
});

test("generates from replayable keys on an instance that was never initialized", async () => {
  // The pattern a consumer uses after caching the keys: build an object from
  // the prototype, restore the flag, and pass the keys back in on each call
  spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(LIVE_PAGE_ON_DEMAND_SOURCE),
  );
  spyOn(Math, "random").mockReturnValue(0.5);
  const initialized = await ClientTransaction.create(await loadLivePage());
  const expected = await initialized.generateTransactionId(
    "GET",
    "/i/api/graphql/abc/UserByScreenName",
    undefined,
    undefined,
    undefined,
    123456789,
  );

  const restored = Object.assign(Object.create(ClientTransaction.prototype), {
    isInitialized: true,
  }) as ClientTransaction;
  expect(restored.isInitialized).toBe(true);
  expect(restored.key).toBeNull();
  expect(restored.animationKey).toBeNull();
  expect(
    await restored.generateTransactionId(
      "GET",
      "/i/api/graphql/abc/UserByScreenName",
      undefined,
      LIVE_PAGE_KEY,
      LIVE_PAGE_ANIMATION_KEY,
      123456789,
    ),
  ).toBe(expected);
});

test("generateTransactionId throws when the replayed keys are incomplete", async () => {
  const restored = Object.create(
    ClientTransaction.prototype,
  ) as ClientTransaction;

  const error = await restored
    .generateTransactionId("GET", "/x", undefined, LIVE_PAGE_KEY)
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ClientTransactionNotInitializedError);
});

test("getKeys returns a serialisable pair and fromKeys rebuilds the instance", async () => {
  spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(LIVE_PAGE_ON_DEMAND_SOURCE),
  );
  spyOn(Math, "random").mockReturnValue(0.5);
  const original = await ClientTransaction.create(await loadLivePage());
  const keys = original.getKeys();
  expect(keys).toEqual({
    key: LIVE_PAGE_KEY,
    animationKey: LIVE_PAGE_ANIMATION_KEY,
  });

  // Cross-process caching round trip
  const restored = ClientTransaction.fromKeys(JSON.parse(JSON.stringify(keys)));
  expect(restored.getKeys()).toEqual(keys);
  expect(restored.isInitialized).toBe(true);
  expect(
    await restored.generateTransactionId(
      "GET",
      "/i/api/graphql/abc/UserByScreenName",
      undefined,
      undefined,
      undefined,
      123456789,
    ),
  ).toBe(
    await original.generateTransactionId(
      "GET",
      "/i/api/graphql/abc/UserByScreenName",
      undefined,
      undefined,
      undefined,
      123456789,
    ),
  );
});

test("fromKeys rejects incomplete or malformed keys", () => {
  const cases: unknown[] = [
    undefined,
    null,
    {},
    { key: LIVE_PAGE_KEY },
    { animationKey: LIVE_PAGE_ANIMATION_KEY },
    { key: "", animationKey: LIVE_PAGE_ANIMATION_KEY },
    { key: LIVE_PAGE_KEY, animationKey: "" },
    { key: "!!!not base64!!!", animationKey: LIVE_PAGE_ANIMATION_KEY },
    { key: btoa(""), animationKey: LIVE_PAGE_ANIMATION_KEY },
  ];

  for (const keys of cases) {
    expect(() =>
      ClientTransaction.fromKeys(keys as { key: string; animationKey: string }),
    ).toThrow(ClientTransactionInitializationError);
  }
});

test("getKeys is null before initialization", () => {
  expect(new ClientTransaction().getKeys()).toBeNull();
});

test("initialize without a document throws a typed error", async () => {
  const error = await new ClientTransaction()
    .initialize()
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ClientTransactionInitializationError);
});
