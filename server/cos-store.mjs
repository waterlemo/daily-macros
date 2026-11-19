import COS from "cos-nodejs-sdk-v5";

const firstNumber = 999999999999;
const dataPrefix = path => `nutrition/${path}/`;
const objectKey = (path, number) => dataPrefix(path) + String(number).padStart(12, "0") + ".json";

export function createCosStore(env) {
  const { COS_BUCKET: Bucket, COS_REGION: Region, TENCENTCLOUD_SECRETID: SecretId,
    TENCENTCLOUD_SECRETKEY: SecretKey, TENCENTCLOUD_SESSIONTOKEN: SecurityToken } = env;
  if (!/^[a-z0-9-]+-\d+$/.test(Bucket || "") || !/^ap-[a-z0-9-]+$/.test(Region || "") ||
      !SecretId || !SecretKey || !SecurityToken) throw new Error("COS is not configured");

  const cos = new COS({ SecretId, SecretKey, SecurityToken, Protocol: "https:", Timeout: 5000 });
  const call = (method, args) => new Promise((resolve, reject) => {
    cos[method]({ Bucket, Region, ...args }, (error, result) => error ? reject(error) : resolve(result));
  });

  async function readRevision(path, number) {
    try {
      const { Body } = await call("getObject", { Key: objectKey(path, number) });
      return { number, value: JSON.parse(Body) };
    } catch (error) {
      if (error.statusCode !== 404) throw error;
      return null;
    }
  }

  async function latest(path, fallback) {
    const prefix = dataPrefix(path);
    const list = await call("getBucket", { Prefix: prefix, MaxKeys: 1 });
    const key = list.Contents?.[0]?.Key;
    let current = { number: firstNumber + 1, value: fallback };
    if (key) {
      const suffix = key.slice(prefix.length);
      if (!/^\d{12}\.json$/.test(suffix)) throw new Error("Invalid COS data key");
      current = await readRevision(path, Number(suffix.slice(0, 12)));
      if (!current) throw new Error("Listed COS revision is missing");
    }
    // COS listings may lag behind a completed write. Probe newer immutable keys directly.
    for (let probe = 0; probe < 5 && current.number > 0; probe++) {
      const next = await readRevision(path, current.number - 1);
      if (!next) break;
      current = next;
    }
    return current;
  }

  return {
    async read(path, fallback) {
      return (await latest(path, fallback)).value;
    },
    async change(path, fallback, apply) {
      // Newer revisions sort first. Create-only writes decide which concurrent edit won.
      let current = await latest(path, fallback);
      for (let attempt = 0; attempt < 5; attempt++) {
        const { number, value } = current;
        const previous = JSON.stringify(value);
        const next = apply(value);
        const body = JSON.stringify(next);
        if (body === previous) return { value: next };
        if (number === 0) throw new Error("COS revision range exhausted");
        const key = objectKey(path, number - 1);
        try {
          await call("putObject", { Key: key, Body: body, ContentType: "application/json",
            Headers: { "x-cos-forbid-overwrite": "true", "x-cos-server-side-encryption": "AES256" } });
          return { value: next };
        } catch (error) {
          if (error.code !== "FileAlreadyExists") throw error;
          const winner = await readRevision(path, number - 1);
          if (winner) current = winner;
          else await new Promise(resolve => setTimeout(resolve, 50 * (attempt + 1)));
        }
      }
      return null;
    }
  };
}
