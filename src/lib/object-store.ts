import "server-only";
import type { S3Client } from "@aws-sdk/client-s3";

export type ObjectStore = {
  get: (key: string, options?: { type: "text" }) => Promise<string | null>;
  setJSON: (key: string, value: unknown) => Promise<unknown>;
  delete: (key: string) => Promise<void>;
  list: (options: { prefix: string }) => Promise<{ blobs: { key: string }[] }>;
};

const BUCKET = process.env.ARENA_S3_BUCKET;

/**
 * Whether games live in a shared store rather than a file on this machine.
 * A laptop opts in with ARENA_STORE=s3, and should point ARENA_S3_PREFIX
 * somewhere other than the live games when it does.
 */
export const REMOTE =
  process.env.ARENA_STORE === "s3" ||
  !!(
    process.env.NETLIFY ||
    process.env.VERCEL ||
    process.env.AWS_LAMBDA_FUNCTION_NAME ||
    process.env.LAMBDA_TASK_ROOT
  );

export const BACKEND = BUCKET ? "s3" : "netlify-blobs";

let s3: Promise<{ client: S3Client; sdk: typeof import("@aws-sdk/client-s3") }> | null = null;

function s3Client() {
  s3 ??= import("@aws-sdk/client-s3").then((sdk) => {
    const accessKeyId = process.env.ARENA_S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.ARENA_S3_SECRET_ACCESS_KEY;
    const client = new sdk.S3Client({
      region: process.env.ARENA_S3_REGION || "us-east-2",
      ignoreConfiguredEndpointUrls: true,
      // The host reserves AWS_* for its own functions, so the keys travel under
      // their own names. Without them the SDK's default chain still applies.
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    });
    return { client, sdk };
  });
  return s3;
}

const missing = (err: unknown) => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NoSuchKey" || e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404;
};

/** Keys are laid out as the Netlify Blobs stores were: one folder per store. */
function s3Store(name: string): ObjectStore {
  const root = `${process.env.ARENA_S3_PREFIX ?? ""}${name}/`;
  return {
    async get(key) {
      const { client, sdk } = await s3Client();
      try {
        const out = await client.send(new sdk.GetObjectCommand({ Bucket: BUCKET, Key: root + key }));
        return (await out.Body?.transformToString("utf8")) ?? null;
      } catch (err) {
        if (missing(err)) return null;
        throw err;
      }
    },
    async setJSON(key, value) {
      const { client, sdk } = await s3Client();
      return client.send(
        new sdk.PutObjectCommand({
          Bucket: BUCKET,
          Key: root + key,
          Body: JSON.stringify(value),
          ContentType: "application/json",
        }),
      );
    },
    async delete(key) {
      const { client, sdk } = await s3Client();
      await client.send(new sdk.DeleteObjectCommand({ Bucket: BUCKET, Key: root + key }));
    },
    async list({ prefix }) {
      const { client, sdk } = await s3Client();
      const blobs: { key: string }[] = [];
      let token: string | undefined;
      do {
        const out = await client.send(
          new sdk.ListObjectsV2Command({ Bucket: BUCKET, Prefix: root + prefix, ContinuationToken: token }),
        );
        for (const o of out.Contents ?? []) if (o.Key) blobs.push({ key: o.Key.slice(root.length) });
        token = out.IsTruncated ? out.NextContinuationToken : undefined;
      } while (token);
      return { blobs };
    },
  };
}

type MakeStore = (opts: { name: string; consistency: string }) => ObjectStore;
let makeBlobStore: MakeStore | null = null;

/**
 * Null when there is no shared store to open. A Netlify Blobs client is built
 * fresh every time: the host hands each invocation short-lived credentials,
 * and a client kept across invocations holds a token past its expiry.
 */
export async function openStore(name: string): Promise<ObjectStore | null> {
  if (!REMOTE) return null;
  if (BUCKET) return s3Store(name);
  try {
    makeBlobStore ??= (await import("@netlify/blobs")).getStore as unknown as MakeStore;
    return makeBlobStore({ name, consistency: "strong" });
  } catch {
    return null;
  }
}
