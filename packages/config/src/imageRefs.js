const SHA256_REF = /@sha256:[a-f0-9]{64}$/;

export function selectOwnedImageRef(image, repoDigests) {
  const normalizedImage = String(image || "").trim().toLowerCase();
  if (!normalizedImage || normalizedImage.includes("@") || normalizedImage.includes(" ")) {
    throw new Error("image must be a normalized repository name without a digest");
  }
  if (!Array.isArray(repoDigests)) throw new Error("repoDigests must be an array");

  const prefix = `${normalizedImage}@`;
  const matches = repoDigests
    .map((value) => String(value || "").trim().toLowerCase())
    .filter((value) => value.startsWith(prefix) && SHA256_REF.test(value));

  if (matches.length !== 1) {
    throw new Error(`expected exactly one owned digest for ${normalizedImage}, found ${matches.length}`);
  }
  return matches[0];
}
