/**
 * Generation of the x-client-transaction-id header value.
 */
import { getAnimationKey } from "./animation.ts";
import { decodeBase64, encodeBase64 } from "./base64.ts";
import {
  ClientTransactionInitializationError,
  ClientTransactionNotInitializedError,
} from "./errors.ts";
import {
  fetchKeyByteIndices,
  getAnimationFrameRows,
  getVerificationKey,
} from "./home-page.ts";

// Constants X's script mixes into every transaction ID
const KEYWORD = "obfiowerehiring";
const ADDITIONAL_RANDOM_NUMBER = 3;
// Transaction ID timestamps count seconds from 2023-05-01T07:00:00Z
const EPOCH_SECONDS = 1682924400;

/**
 * The two values derived from a document that later requests need.
 *
 * Both are plain strings, so a caller can store them anywhere, including a
 * cache shared between processes, and rebuild a {@link ClientTransaction}
 * from them with {@link ClientTransaction.fromKeys}.
 */
export interface ClientTransactionKeys {
  /** Base64 verification key from the `twitter-site-verification` meta tag */
  key: string;
  /** Animation key derived from the document and the ondemand chunk */
  animationKey: string;
}

interface TransactionState extends ClientTransactionKeys {
  keyBytes: number[];
}

/**
 * Main class responsible for generating client transaction IDs
 * used in authenticated API requests to X
 */
export class ClientTransaction {
  private readonly homePageDocument: Document | null;
  private state: TransactionState | null = null;
  // Mirrors writes to `isInitialized`, so callers that restored the flag
  // themselves keep reading the value they set
  private initializedFlag = false;

  /**
   * Creates a new ClientTransaction instance. Call {@link initialize}
   * before generating transaction IDs, or use
   * {@link ClientTransaction.create} to do both.
   * @param homePageDocument DOM Document object from X's responsive web app.
   *        May be omitted when the keys are supplied with
   *        {@link ClientTransaction.fromKeys} or on each
   *        {@link generateTransactionId} call.
   */
  constructor(homePageDocument: Document | null = null) {
    this.homePageDocument = homePageDocument;
  }

  /**
   * Base64 verification key read from the document, or `null` before the
   * keys are available. Kept for callers written against earlier versions;
   * {@link getKeys} is the supported way to read both values at once.
   */
  get key(): string | null {
    return this.state?.key ?? null;
  }

  /**
   * Decoded bytes of {@link key}, or `null` before the keys are available.
   * Returns a copy, so mutating it cannot corrupt the instance.
   */
  get keyBytes(): number[] | null {
    return this.state ? [...this.state.keyBytes] : null;
  }

  /**
   * Animation key derived for the document, or `null` before the keys are
   * available. Kept for callers written against earlier versions;
   * {@link getKeys} is the supported way to read both values at once.
   */
  get animationKey(): string | null {
    return this.state?.animationKey ?? null;
  }

  /**
   * Whether the instance can generate transaction IDs without being given
   * keys on each call, either from {@link initialize},
   * {@link ClientTransaction.fromKeys}, or a caller that restored the flag.
   */
  get isInitialized(): boolean {
    return this.state !== null || this.initializedFlag;
  }

  set isInitialized(value: boolean) {
    this.initializedFlag = value;
  }

  /**
   * Returns the two values a later request needs, or `null` before they are
   * available.
   *
   * Store the result and feed it back through
   * {@link ClientTransaction.fromKeys} to generate transaction IDs without
   * fetching a document again.
   */
  getKeys(): ClientTransactionKeys | null {
    if (!this.state) {
      return null;
    }
    return { key: this.state.key, animationKey: this.state.animationKey };
  }

  /**
   * Builds an instance from keys obtained earlier, without a document.
   *
   * @param keys Keys returned by {@link getKeys}, possibly deserialised from
   *        a cache
   * @returns An initialized instance
   * @throws {ClientTransactionInitializationError} If a key is missing or the
   *         verification key is not valid base64
   */
  static fromKeys(keys: ClientTransactionKeys): ClientTransaction {
    const { key, animationKey } = keys ?? {};
    if (typeof key !== "string" || key.length === 0) {
      throw new ClientTransactionInitializationError(
        "ClientTransaction.fromKeys requires a non-empty base64 verification key.",
        { code: "INVALID_CLIENT_TRANSACTION_KEYS" },
      );
    }
    if (typeof animationKey !== "string" || animationKey.length === 0) {
      throw new ClientTransactionInitializationError(
        "ClientTransaction.fromKeys requires a non-empty animation key.",
        { code: "INVALID_CLIENT_TRANSACTION_KEYS" },
      );
    }

    let keyBytes: number[];
    try {
      keyBytes = Array.from(decodeBase64(key));
    } catch (cause) {
      throw new ClientTransactionInitializationError(
        "ClientTransaction.fromKeys received a verification key that is not valid base64.",
        { code: "INVALID_CLIENT_TRANSACTION_KEYS", cause },
      );
    }
    if (keyBytes.length === 0) {
      throw new ClientTransactionInitializationError(
        "ClientTransaction.fromKeys received a verification key that decodes to no bytes.",
        { code: "INVALID_CLIENT_TRANSACTION_KEYS" },
      );
    }

    const instance = new ClientTransaction(null);
    instance.state = { key, keyBytes, animationKey };
    return instance;
  }

  /**
   * Static factory method that creates and initializes a ClientTransaction instance
   * @param homePageDocument DOM Document object from X's responsive web app
   * @returns Initialized ClientTransaction instance
   */
  static async create(homePageDocument: Document): Promise<ClientTransaction> {
    const instance = new ClientTransaction(homePageDocument);
    await instance.initialize();
    return instance;
  }

  /**
   * Reads the verification key and animation from the document, fetching
   * the ondemand chunk they depend on. Does nothing once it has succeeded.
   * @throws {ClientTransactionInitializationError} If no document was given,
   *         or the document or the ondemand chunk lacks the expected data.
   */
  async initialize(): Promise<void> {
    if (this.state) {
      return;
    }
    const document = this.homePageDocument;
    if (!document) {
      throw new ClientTransactionInitializationError(
        "ClientTransaction has no document to initialize from. Pass one to the constructor or use ClientTransaction.fromKeys.",
        { code: "CLIENT_TRANSACTION_DOCUMENT_MISSING" },
      );
    }
    const key = getVerificationKey(document);
    const keyBytes = Array.from(decodeBase64(key));
    const indices = await fetchKeyByteIndices(document);
    const frameRows = getAnimationFrameRows(document, keyBytes);
    this.state = {
      key,
      keyBytes,
      animationKey: getAnimationKey(keyBytes, indices, frameRows),
    };
  }

  /**
   * Generates a transaction ID for X API requests
   * @param method HTTP method (GET, POST, etc.)
   * @param path API endpoint path
   * @param _response Unused; the document passed to the constructor is
   *                  always used. Kept for backward compatibility.
   * @param key Base64 verification key to use instead of the instance's
   * @param animationKey Animation key to use instead of the instance's
   * @param timeNow Seconds since 2023-05-01T07:00:00Z (defaults to now)
   * @returns Base64 encoded transaction ID with padding removed
   * @throws {ClientTransactionNotInitializedError} If neither this instance
   *         nor the `key`/`animationKey` arguments provide both keys.
   */
  async generateTransactionId(
    method: string,
    path: string,
    _response?: Document,
    key?: string,
    animationKey?: string,
    timeNow?: number,
  ): Promise<string> {
    const keyBytes = key ? Array.from(decodeBase64(key)) : this.state?.keyBytes;
    const animationKeyToUse = animationKey || this.state?.animationKey;
    if (!keyBytes || !animationKeyToUse) {
      throw new ClientTransactionNotInitializedError();
    }

    const time =
      timeNow ?? Math.floor((Date.now() - EPOCH_SECONDS * 1000) / 1000);
    const data = `${method}!${path}!${time}${KEYWORD}${animationKeyToUse}`;
    const hash = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data)),
    );

    const randomByte = Math.floor(Math.random() * 256);
    const bytes = [
      ...keyBytes,
      ...[0, 8, 16, 24].map((shift) => (time >> shift) & 0xff),
      ...hash.slice(0, 16),
      ADDITIONAL_RANDOM_NUMBER,
    ];
    const out = Uint8Array.from([
      randomByte,
      ...bytes.map((byte) => byte ^ randomByte),
    ]);
    return encodeBase64(out).replace(/=/g, "");
  }
}
